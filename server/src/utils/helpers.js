export class AppError extends Error {
  // `details` = dữ liệu máy đọc kèm theo lỗi (vd sessionId của phiên đang bị chặn), để màn
  // hình gọi API biết phải làm gì tiếp thay vì chỉ hiện được câu chữ. Không bắt buộc.
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  res.status(statusCode).json({ success: true, data, message });
};
