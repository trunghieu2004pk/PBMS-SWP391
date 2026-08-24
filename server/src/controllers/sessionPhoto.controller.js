import { createReadStream } from "node:fs";
import * as photoService from "../services/sessionPhoto.service.js";
import { absolutePathOf } from "../utils/photoPipeline.js";
import { logAdminAction } from "../utils/auditLog.js";
import { asyncHandler, successResponse } from "../utils/helpers.js";

// KHỞI TẠO BỘ NHỚ TẠM ĐỂ CHỐNG SPAM LOG
// Lưu trữ dưới dạng Key-Value: "userId_sessionId" => "thời điểm xem gần nhất"
const viewLogCache = new Map();

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
    : `Đã chụp ${progress.captured}/${progress.total} — còn thiếu: ${progress.missingLabels.join(", ")}`;
  successResponse(res, result, message, 201);
});

export const list = asyncHandler(async (req, res) => {
  const result = await photoService.listSessionPhotos(req.params.id);
  successResponse(res, result);
});

export const streamFile = asyncHandler(async (req, res) => {
  const { row, intact } = await photoService.getPhotoForStream(
    req.params.id,
    req.params.photoId,
  );

  const userId = req.user.user_id;
  const sessionId = row.session_id;

  // Tạo một "chìa khóa" định danh
  const cacheKey = `${userId}_${sessionId}`;
  const now = Date.now();
  const lastViewTime = viewLogCache.get(cacheKey) || 0;

  // KIỂM TRA CHỐNG SPAM: Nếu khoảng cách với lần ghi log trước lớn hơn 10 giây
  if (now - lastViewTime > 10000) {
    // BƯỚC QUAN TRỌNG: PHẢI CHỐT CỬA NGAY LẬP TỨC (Không được có chữ await ở dòng này)
    // Các request thứ 2, 3, 4, 5 lao tới mili-giây tiếp theo sẽ bị kẹt lại vì key này đã tồn tại
    viewLogCache.set(cacheKey, now);

    // Ghi log 1 lần duy nhất đại diện cho việc "Đang xem bộ ảnh"
    await logAdminAction(userId, "SESSION_PHOTO_VIEW", {
      sessionId: sessionId,
      phase: "tổng hợp",
      kind: "nhiều góc",
      intact: intact,
    });

    // Dọn dẹp bộ nhớ tạm sau 10 giây để tránh làm nặng RAM
    setTimeout(() => viewLogCache.delete(cacheKey), 10000);
  }

  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Photo-Intact", intact ? "true" : "false");
  createReadStream(absolutePathOf(row.file_path)).pipe(res);
});
