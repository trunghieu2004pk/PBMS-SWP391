import multer from "multer";
import { AppError } from "../utils/helpers.js";

/**
 * CẤU HÌNH CƠ BẢN
 */
// Đặt giới hạn dung lượng file là 3MB (3 * 1024 byte * 1024 byte)
const MAX_BYTES = 3 * 1024 * 1024;

// Chỉ cho phép người dùng tải lên 3 định dạng ảnh này.
// Nếu gửi file .pdf, .mp4 hay .gif hệ thống sẽ chặn lại.
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

/**
 * CẤU HÌNH MULTER CHO 1 FILE ẢNH
 * multer là một thư viện chuyên dùng để xử lý dữ liệu gửi lên dưới dạng 'multipart/form-data' (dùng khi upload file)
 */
const upload = multer({
  // Sử dụng memoryStorage: Lưu tạm file trong bộ nhớ RAM thay vì ghi thẳng xuống ổ cứng.
  // Lý do: Cần file nằm trong RAM để phần mềm phía sau tính toán mã Hash (chống sửa ảnh)
  // hoặc đóng dấu (watermark) rồi mới lưu ra đĩa. Vì giới hạn là 3MB nên không sợ tràn RAM.
  storage: multer.memoryStorage(),

  // Giới hạn: kích thước tối đa 3MB, số lượng file tối đa là 1.
  limits: { fileSize: MAX_BYTES, files: 1 },

  // fileFilter: Hàm lọc file, chạy trước khi nhận file vào bộ nhớ
  fileFilter: (_req, file, cb) => {
    // Nếu loại file (mimetype) không nằm trong mảng ALLOWED_MIME đã khai báo ở trên...
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      // ...thì ném ra lỗi từ chối nhận file
      cb(new AppError("Chỉ nhận ảnh JPEG/PNG/WebP", 400, "VALIDATION_ERROR"));
      return;
    }
    // Nếu hợp lệ, cho phép đi tiếp
    cb(null, true);
  },
});

/**
 * MIDDLEWARE XỬ LÝ UPLOAD 1 ẢNH (Dùng khi báo cáo sự cố 1 ảnh, cập nhật avatar...)
 * Hàm này bọc 'multer' lại để định dạng lại các lỗi vặt của multer thành AppError (chuẩn của dự án)
 */
export const singlePhoto =
  (fieldName = "photo") =>
  (req, res, next) => {
    // Thực thi multer để đón 1 file có tên trường (field name) do ta truyền vào
    upload.single(fieldName)(req, res, (err) => {
      // Nếu không có lỗi gì, chuyển tiếp request tới Controller xử lý
      if (!err) {
        next();
        return;
      }

      // Nếu bắt được lỗi do chính thư viện Multer ném ra
      if (err instanceof multer.MulterError) {
        // Dịch các mã lỗi kỹ thuật sang tiếng Việt cho thân thiện với người dùng
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "Ảnh vượt quá 3MB — giảm chất lượng trước khi gửi"
            : err.code === "LIMIT_FILE_COUNT"
              ? "Chỉ gửi được 1 ảnh mỗi lần"
              : `Lỗi tải ảnh: ${err.message}`;

        // Gọi trình xử lý lỗi (errorHandler) của hệ thống
        next(new AppError(message, 400, "VALIDATION_ERROR"));
        return;
      }

      // Lỗi mạng: Người dùng đang up ảnh dở thì tắt mạng hoặc tắt tab trình duyệt
      if (err.message === "Request aborted") {
        next(
          new AppError(
            "Tải ảnh thất bại do kết nối bị ngắt hoặc client hủy yêu cầu",
            400,
            "REQUEST_ABORTED",
          ),
        );
        return;
      }

      // Nếu là các lỗi không lường trước khác, ném nguyên lỗi đó đi
      next(err);
    });
  };

/**
 * MIDDLEWARE XỬ LÝ UPLOAD NHIỀU ẢNH CÙNG LÚC (Dùng cho khách hàng đính kèm nhiều bằng chứng sự cố)
 */
export const multiplePhotos =
  (fieldName = "photos", maxCount = 5) =>
  (req, res, next) => {
    // Cấu hình tương tự như upload 1 file, nhưng cho phép nhận nhiều file hơn (tối đa maxCount)
    const uploadMultiple = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_BYTES, files: maxCount },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          cb(
            new AppError("Chỉ nhận ảnh JPEG/PNG/WebP", 400, "VALIDATION_ERROR"),
          );
          return;
        }
        cb(null, true);
      },
    });

    // Sử dụng uploadMultiple.array() thay vì .single() để đón mảng ảnh
    uploadMultiple.array(fieldName, maxCount)(req, res, (err) => {
      // Luồng xử lý lỗi giống hệt như singlePhoto
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? "Một trong các ảnh vượt quá 3MB — giảm chất lượng trước khi gửi"
            : err.code === "LIMIT_FILE_COUNT"
              ? `Chỉ gửi được tối đa ${maxCount} ảnh` // Thông báo thay đổi linh hoạt theo số lượng tối đa
              : `Lỗi tải ảnh: ${err.message}`;
        next(new AppError(message, 400, "VALIDATION_ERROR"));
        return;
      }
      if (err.message === "Request aborted") {
        next(
          new AppError(
            "Tải ảnh thất bại do kết nối bị ngắt hoặc client hủy yêu cầu",
            400,
            "REQUEST_ABORTED",
          ),
        );
        return;
      }
      next(err);
    });
  };

export default singlePhoto;
