import { Op } from 'sequelize';
import { SessionPhoto, ParkingSession } from '../models/index.js';
import { PHOTO_KIND_LABELS } from '../models/sessionPhoto.model.js';
import { AppError } from '../utils/helpers.js';
import { assertSessionActive } from '../utils/stateGuards.js';
import {
  processAndStorePhoto,
  removeStoredPhoto,
  verifyStoredPhoto,
  sha256,
  hammingDistance,
} from '../utils/photoPipeline.js';
import {
  getPhotoRequiredKinds,
  getPhotoSimilarityThreshold,
  isEntryPhotoRequired,
  isExitPhotoRequired,
} from '../utils/settings.js';

const labelOf = (kind) => PHOTO_KIND_LABELS[kind] || kind;

const toPublicPhoto = (row) => {
  const p = row.toJSON ? row.toJSON() : row;
  return {
    photoId: p.photo_id,
    sessionId: p.session_id,
    phase: p.phase,
    kind: p.kind,
    kindLabel: labelOf(p.kind),
    source: p.source,
    mime: p.mime,
    bytes: p.bytes,
    width: p.width,
    height: p.height,
    capturedAt: p.captured_at,
    capturedBy: p.captured_by,
    sha256Stored: p.sha256_stored,
    // KHÔNG trả file_path thật ra ngoài — tránh lộ cấu trúc thư mục server.
    url: `/api/sessions/${p.session_id}/photos/${p.photo_id}/file`,
  };
};

const loadActiveSession = async (sessionId) => {
  const session = await ParkingSession.findByPk(Number(sessionId));
  if (!session) throw new AppError('Không tìm thấy phiên gửi xe', 404, 'NOT_FOUND');
  return session;
};

/** Còn thiếu những góc nào cho 1 phase — dùng chung cho cả API tiến độ lẫn chặn barie. */
export const getPhotoProgress = async (sessionId, phase) => {
  const required = getPhotoRequiredKinds();
  const rows = await SessionPhoto.findAll({
    where: { session_id: Number(sessionId), phase },
    attributes: ['kind'],
  });
  const have = new Set(rows.map((r) => r.kind));
  const missing = required.filter((k) => !have.has(k));
  return {
    phase,
    required,
    captured: required.filter((k) => have.has(k)).length,
    total: required.length,
    missing,
    missingLabels: missing.map(labelOf),
    complete: missing.length === 0,
  };
};

/**
 * Chặn barie khi chưa đủ ảnh. Gọi ở cổng VÀO tòa và lúc checkout.
 * Setting tắt ⇒ trả về ngay, luồng cũ không đổi hành vi một chút nào.
 */
export const assertPhotoComplete = async (sessionId, phase) => {
  const required = phase === 'entry' ? isEntryPhotoRequired() : isExitPhotoRequired();
  if (!required) return null;

  const progress = await getPhotoProgress(sessionId, phase);
  if (!progress.complete) {
    throw new AppError(
      `Chưa đủ ảnh hiện trạng (${progress.captured}/${progress.total}) — còn thiếu: ${progress.missingLabels.join(', ')}. Barrier không mở.`,
      400,
      'PHOTO_REQUIRED',
      // Kèm sessionId để màn kiosk cổng RA biết phải theo dõi phiên nào. Không có nó, khách
      // bị chặn vì thiếu ảnh sẽ đứng trước màn hình trống: nhân viên chụp ảnh + thu tiền xong
      // ở quầy mà kiosk chẳng biết gì để báo "barie mở".
      { sessionId: Number(sessionId), phase, captured: progress.captured, total: progress.total },
    );
  }
  return progress;
};

/**
 * Nhận 1 ảnh, chạy pipeline, ghi DB. Chụp lại cùng góc ⇒ GHI ĐÈ dòng cũ (unique
 * session+phase+kind) — không thể lách bằng cách nộp nhiều tấm cho một góc.
 */
export const storeSessionPhoto = async (actorId, sessionId, payload, file) => {
  if (!file?.buffer?.length) {
    throw new AppError('Thiếu file ảnh', 400, 'VALIDATION_ERROR');
  }

  const session = await loadActiveSession(sessionId);
  assertSessionActive(session);

  const phase = payload.phase;
  const kind = payload.kind;
  const receivedAt = new Date();

  // Ảnh VÀO chốt lại khi đã bắt đầu chụp ảnh RA — chống bổ sung ảnh vào ngược sau khi thấy hư hại.
  if (phase === 'entry') {
    const exitCount = await SessionPhoto.count({
      where: { session_id: session.session_id, phase: 'exit' },
    });
    if (exitCount > 0) {
      throw new AppError(
        'Phiên đã bắt đầu chụp ảnh RA — không thể thêm/sửa ảnh VÀO nữa.',
        409,
        'CONFLICT',
      );
    }
  }

  const capturedAt = payload.capturedAt ? new Date(payload.capturedAt) : receivedAt;
  if (Number.isNaN(capturedAt.getTime())) {
    throw new AppError('capturedAt không hợp lệ', 400, 'VALIDATION_ERROR');
  }
  // sha256_raw vẫn được TÍNH VÀ LƯU (phục vụ truy vết: tra ra một tấm ảnh còn được dùng ở
  // đâu nữa). KHÔNG dùng để chặn: ảnh nhập từ tệp trùng nhau giữa các lượt gửi là chuyện
  // bình thường (bãi dùng lại bộ ảnh tham chiếu, hoặc đang chạy thử) — chặn là tắc nghiệp vụ.
  const rawHash = sha256(file.buffer);

  const stored = await processAndStorePhoto({
    buffer: file.buffer,
    sessionId: session.session_id,
    phase,
    kind,
    plateNumber: session.plate_number,
    // Đóng dấu bằng giờ MÁY CHỦ, không lấy capturedAt của máy trạm — đồng hồ máy quầy
    // chỉnh được, mà mốc thời gian trên ảnh là bằng chứng.
    stampedAt: receivedAt,
  });

  // Chống chĩa máy vào MỘT chỗ bấm đủ số lần. sha256 không bắt được vì mỗi lần bấm ra byte
  // khác nhau; dHash so nội dung nhìn thấy nên bắt được. Áp cho CẢ ảnh mô phỏng (chọn cùng
  // một ảnh cho 2 góc cũng là gian).
  const simThreshold = getPhotoSimilarityThreshold();
  if (simThreshold > 0 && stored.pHash) {
    const siblings = await SessionPhoto.findAll({
      where: {
        session_id: session.session_id,
        phase,
        kind: { [Op.ne]: kind },
      },
      attributes: ['kind', 'phash'],
    });
    const twin = siblings.find(
      (s) => s.phash && hammingDistance(stored.pHash, s.phash) <= simThreshold,
    );
    if (twin) {
      await removeStoredPhoto(stored.filePath); // đã ghi ra đĩa rồi, không giữ file rác
      throw new AppError(
        `Ảnh "${labelOf(kind)}" trông giống hệt ảnh "${labelOf(twin.kind)}" đã chụp — ` +
          'phải chụp đúng góc, không chụp lại cùng một chỗ.',
        409,
        'PHOTO_TOO_SIMILAR',
      );
    }
  }

  // Chụp lại cùng góc: xóa file cũ trên đĩa rồi ghi đè dòng DB (đường dẫn trùng nhau nên
  // file đã bị writeFile ghi đè; xóa ở đây chỉ để dọn khi đổi ngày/đổi tên file).
  const existing = await SessionPhoto.findOne({
    where: { session_id: session.session_id, phase, kind },
  });
  if (existing && existing.file_path !== stored.filePath) {
    await removeStoredPhoto(existing.file_path);
  }

  const values = {
    session_id: session.session_id,
    phase,
    kind,
    file_path: stored.filePath,
    sha256_raw: stored.sha256Raw,
    sha256_stored: stored.sha256Stored,
    phash: stored.pHash,
    source: 'upload',
    mime: stored.mime,
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height,
    captured_at: capturedAt,
    received_at: receivedAt,
    captured_by: actorId ?? null,
  };

  const row = existing ? await existing.update(values) : await SessionPhoto.create(values);
  const progress = await getPhotoProgress(session.session_id, phase);

  return { photo: toPublicPhoto(row), progress };
};

/** Metadata ảnh của 1 phiên, nhóm theo phase — KHÔNG trả binary. */
/**
 * Tra xem từng tấm ảnh của lượt gửi này còn được dùng ở lượt gửi NÀO KHÁC không.
 *
 * Cách nhận biết: `sha256_raw` là vân tay của ĐÚNG tệp gốc nhân viên nhập vào (tính TRƯỚC khi
 * đóng dấu — xem photoPipeline). Cùng một tệp nhập cho 2 lượt gửi ⇒ byte y hệt ⇒ vân tay trùng.
 * Đổi tên tệp không ăn thua vì tên không nằm trong nội dung.
 *
 * KHÔNG chặn — chỉ báo. Bãi dùng lại bộ ảnh tham chiếu là chuyện có thật, chặn là tắc nghiệp vụ.
 * Nhưng người xử lý khiếu nại phải thấy được dấu hiệu này để cân nhắc giá trị đối chất.
 *
 * Giới hạn: chỉ bắt tệp GIỐNG HỆT. Nén lại / xuất lại ảnh là byte đổi ⇒ vân tay đổi ⇒ không bắt được.
 */
const findReusedPhotos = async (sessionId, rows) => {
  const hashes = [...new Set(rows.map((r) => r.sha256_raw).filter(Boolean))];
  if (!hashes.length) return new Map();

  const clashes = await SessionPhoto.findAll({
    where: {
      sha256_raw: { [Op.in]: hashes },
      session_id: { [Op.ne]: sessionId },
    },
    attributes: ['sha256_raw', 'session_id'],
    raw: true,
  });

  const byHash = new Map();
  for (const c of clashes) {
    const list = byHash.get(c.sha256_raw) || new Set();
    list.add(c.session_id);
    byHash.set(c.sha256_raw, list);
  }
  return byHash;
};

export const listSessionPhotos = async (sessionId) => {
  const session = await loadActiveSession(sessionId);
  const rows = await SessionPhoto.findAll({
    where: { session_id: session.session_id },
    order: [
      ['phase', 'ASC'],
      ['kind', 'ASC'],
    ],
  });

  const reuseMap = await findReusedPhotos(session.session_id, rows);
  const all = rows.map((row) => {
    const pub = toPublicPhoto(row);
    const others = reuseMap.get(row.sha256_raw);
    pub.reusedInSessions = others ? [...others].sort((a, b) => a - b) : [];
    return pub;
  });
  return {
    sessionId: session.session_id,
    plateNumber: session.plate_number,
    // Staff KHÔNG đọc được GET /settings/system (Manager-only) nhưng vẫn cần biết những
    // góc nào đang bắt buộc → trả kèm ở đây.
    entryRequired: isEntryPhotoRequired(),
    exitRequired: isExitPhotoRequired(),
    entry: all.filter((p) => p.phase === 'entry'),
    exit: all.filter((p) => p.phase === 'exit'),
    entryProgress: await getPhotoProgress(session.session_id, 'entry'),
    exitProgress: await getPhotoProgress(session.session_id, 'exit'),
  };
};

/** Lấy 1 ảnh để stream. Trả kèm kết quả đối chiếu hash (ảnh có bị sửa sau khi lưu không). */
export const getPhotoForStream = async (sessionId, photoId) => {
  const row = await SessionPhoto.findOne({
    where: { photo_id: Number(photoId), session_id: Number(sessionId) },
  });
  if (!row) throw new AppError('Không tìm thấy ảnh', 404, 'NOT_FOUND');
  const intact = await verifyStoredPhoto(row.file_path, row.sha256_stored);
  return { row, intact };
};
