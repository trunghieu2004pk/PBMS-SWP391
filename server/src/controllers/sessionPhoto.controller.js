import { createReadStream } from 'node:fs';
import * as photoService from '../services/sessionPhoto.service.js';
import { absolutePathOf } from '../utils/photoPipeline.js';
import { logAdminAction } from '../utils/auditLog.js';
import { asyncHandler, successResponse } from '../utils/helpers.js';

export const upload = asyncHandler(async (req, res) => {
  const result = await photoService.storeSessionPhoto(
    req.user.user_id,
    req.params.id,
    req.body,
    req.file,
  );
  const { progress } = result;
  const message = progress.complete
    ? `Đã đủ ${progress.total}/${progress.total} ảnh`
    : `Đã chụp ${progress.captured}/${progress.total} — còn thiếu: ${progress.missingLabels.join(', ')}`;
  successResponse(res, result, message, 201);
});

export const list = asyncHandler(async (req, res) => {
  const result = await photoService.listSessionPhotos(req.params.id);
  successResponse(res, result);
});

export const streamFile = asyncHandler(async (req, res) => {
  const { row, intact } = await photoService.getPhotoForStream(req.params.id, req.params.photoId);

  // Ảnh có mặt người = dữ liệu cá nhân. Mỗi lần XEM đều ghi vết: ai xem ảnh của ai, lúc nào.
  // Đây là câu trả lời sẵn cho "nhân viên tự tiện xem ảnh khách thì sao".
  await logAdminAction(req.user.user_id, 'SESSION_PHOTO_VIEW', {
    sessionId: row.session_id,
    photoId: row.photo_id,
    phase: row.phase,
    kind: row.kind,
    intact,
  });

  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  // Ảnh lệch hash = đã bị sửa sau khi lưu. Không chặn tải (Manager cần xem để điều tra)
  // nhưng gắn cờ để FE hiện cảnh báo đỏ.
  res.setHeader('X-Photo-Intact', intact ? 'true' : 'false');
  createReadStream(absolutePathOf(row.file_path)).pipe(res);
});
