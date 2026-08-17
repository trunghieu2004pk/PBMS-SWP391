import multer from 'multer';
import { AppError } from '../utils/helpers.js';

/**
 * Nhận ảnh hiện trạng xe/người lái qua multipart/form-data.
 *
 * memoryStorage (không ghi thẳng ra đĩa) là CỐ Ý: pipeline phải hash buffer GỐC rồi mới
 * resize + đóng dấu, nên cần cả file trong RAM. Giới hạn 3MB nên không lo phình bộ nhớ.
 *
 * LƯU Ý: express.json({ limit: '1mb' }) ở middleware/security.js KHÔNG ảnh hưởng ở đây —
 * multipart đi đường khác. Đừng nới giới hạn JSON vì tưởng liên quan.
 */
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      cb(new AppError('Chỉ nhận ảnh JPEG/PNG/WebP', 400, 'VALIDATION_ERROR'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Bọc multer để lỗi của nó thành AppError đúng chuẩn dự án (errorHandler mới bắt được).
 * Không bọc thì file quá cỡ trả 500 kèm stack thay vì 400 có thông báo tiếng Việt.
 */
export const singlePhoto = (fieldName = 'photo') => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Ảnh vượt quá 3MB — giảm chất lượng trước khi gửi'
          : err.code === 'LIMIT_FILE_COUNT'
            ? 'Chỉ gửi được 1 ảnh mỗi lần'
            : `Lỗi tải ảnh: ${err.message}`;
      next(new AppError(message, 400, 'VALIDATION_ERROR'));
      return;
    }
    next(err);
  });
};

export default singlePhoto;
