-- Migration 010 — Ảnh hiện trạng xe + người lái (bằng chứng chống khiếu nại).
-- Bắt buộc chụp 4 góc xe (trước/trái/sau/phải) + 1 ảnh người lái lúc VÀO và lúc RA.
-- Thiếu ảnh → barie không mở. Ảnh append-only, có hash chống sửa, có watermark định danh.
--
-- sequelize.sync() TỰ TẠO được bảng này (sync tạo bảng còn thiếu, chỉ không tự thêm CỘT).
-- File này để dựng tay trên DB không chạy sync, hoặc để đọc hiểu cấu trúc.
-- Bảng đã tồn tại thì CREATE TABLE IF NOT EXISTS bỏ qua, không lỗi.
--
-- Cách chạy (ví dụ):
--   mysql -h <host> -P <port> -u <user> -p <database> < server/db/migrations/010_session_photo.sql

CREATE TABLE IF NOT EXISTS `session_photo` (
  `photo_id`      INT AUTO_INCREMENT PRIMARY KEY,
  `session_id`    INT NOT NULL,
  `phase`         ENUM('entry','exit') NOT NULL COMMENT 'Chụp lúc VÀO hay lúc RA',
  `kind`          ENUM('front','left','rear','right','driver') NOT NULL
                  COMMENT '4 góc xe + ảnh người lái',
  `file_path`     VARCHAR(255) NOT NULL COMMENT 'Đường dẫn tương đối trong uploads/',
  `sha256_raw`    CHAR(64) NOT NULL COMMENT 'Hash file GỐC trước watermark — chống dùng lại ảnh cũ',
  `sha256_stored` CHAR(64) NOT NULL COMMENT 'Hash file ĐÃ LƯU — chứng minh ảnh không bị sửa',
  `phash`         CHAR(16) NULL
                  COMMENT 'dHash 64-bit nội dung nhìn thấy — bắt trò chụp 1 cảnh nộp cho nhiều góc',
  `source`        ENUM('camera','upload','simulated') NOT NULL DEFAULT 'upload'
                  COMMENT 'Nguồn ảnh — hiện chỉ dùng upload (nhân viên nhập tệp)',
  `mime`          VARCHAR(40) NOT NULL,
  `bytes`         INT NOT NULL,
  `width`         SMALLINT NULL,
  `height`        SMALLINT NULL,
  `captured_at`   DATETIME NOT NULL COMMENT 'Giờ client báo đã chụp',
  `received_at`   DATETIME NOT NULL COMMENT 'Giờ server nhận — dùng đóng dấu lên ảnh và đặt thư mục',
  `captured_by`   INT NULL COMMENT 'Nhân viên đã nhập ảnh này',
  `created_at`    DATETIME NOT NULL,
  `updated_at`    DATETIME NOT NULL,
  UNIQUE KEY `uq_photo_session_phase_kind` (`session_id`, `phase`, `kind`),
  KEY `idx_photo_session` (`session_id`),
  KEY `idx_photo_raw_hash` (`sha256_raw`),
  CONSTRAINT `fk_photo_session` FOREIGN KEY (`session_id`)
    REFERENCES `parking_session` (`session_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
