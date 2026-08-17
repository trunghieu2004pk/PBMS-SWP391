import { Op } from 'sequelize';
import { SessionPhoto, Incident } from '../models/index.js';
import { removeStoredPhoto } from '../utils/photoPipeline.js';
import { getPhotoRetentionDays } from '../utils/settings.js';

/**
 * Job xóa ẢNH HIỆN TRẠNG hết hạn lưu.
 *
 * Vì sao phải có: ảnh có mặt người lái là dữ liệu cá nhân. Giữ vô thời hạn là sai — vừa
 * phình ổ đĩa, vừa không có căn cứ pháp lý để lưu mãi. Quản lý đặt số ngày ở màn Cài đặt
 * (mặc định 90), quá hạn thì hệ thống tự xóa cả tệp trên đĩa lẫn bản ghi.
 *
 * NGOẠI LỆ SỐNG CÒN: ảnh thuộc lượt gửi đang có KHIẾU NẠI CHƯA ĐÓNG (open/investigating)
 * thì KHÔNG xóa. Xóa mất là phiếu đang tranh chấp không còn bằng chứng — hỏng đúng thứ mà
 * cả tính năng này sinh ra để bảo vệ. Phiếu đóng rồi (resolved) mới cho ảnh hết hạn bình thường.
 */

// Quét mỗi 6 giờ — hết hạn tính theo NGÀY nên không cần quét dày.
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let timer = null;

/** Các lượt gửi đang có khiếu nại chưa xử lý xong — ảnh của chúng được giữ lại. */
const sessionIdsUnderDispute = async () => {
  const rows = await Incident.findAll({
    where: {
      status: { [Op.in]: ['open', 'investigating'] },
      session_id: { [Op.ne]: null },
    },
    attributes: ['session_id'],
    group: ['session_id'],
    raw: true,
  });
  return rows.map((r) => r.session_id);
};

/** Một lượt quét — gọi trực tiếp được trong test. */
export const runPhotoRetention = async () => {
  const days = getPhotoRetentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = { created_at: { [Op.lt]: cutoff } };

  const disputed = await sessionIdsUnderDispute();
  // MySQL: `NOT IN ()` là lỗi cú pháp, Sequelize sinh ra `NOT IN (NULL)` — điều kiện luôn
  // NULL nên KHÔNG khớp dòng nào, tức là không xóa được gì. Chỉ gắn mệnh đề khi có phần tử.
  if (disputed.length) {
    where.session_id = { [Op.notIn]: disputed };
  }

  const expired = await SessionPhoto.findAll({
    where,
    attributes: ['photo_id', 'file_path'],
  });
  if (!expired.length) return { deleted: 0, keptForDispute: disputed.length };

  let deleted = 0;
  for (const photo of expired) {
    // Xóa TỆP trước rồi mới xóa bản ghi: hỏng giữa chừng thì còn bản ghi trỏ tới tệp đã mất
    // (phát hiện được qua cờ toàn vẹn), còn hơn mất bản ghi mà tệp nằm lại vô chủ trên đĩa.
    // eslint-disable-next-line no-await-in-loop
    await removeStoredPhoto(photo.file_path);
    // eslint-disable-next-line no-await-in-loop
    await SessionPhoto.destroy({ where: { photo_id: photo.photo_id } });
    deleted += 1;
  }

  console.log(
    `[photo-retention] đã xóa ${deleted} ảnh quá ${days} ngày`
    + (disputed.length ? ` (giữ lại ảnh của ${disputed.length} lượt gửi đang có khiếu nại)` : ''),
  );
  return { deleted, keptForDispute: disputed.length };
};

export const startPhotoRetentionJob = () => {
  if (timer) return timer;
  const tick = () =>
    runPhotoRetention().catch((err) =>
      console.error('[photo-retention] tick failed:', err.message),
    );
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

export const stopPhotoRetentionJob = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
