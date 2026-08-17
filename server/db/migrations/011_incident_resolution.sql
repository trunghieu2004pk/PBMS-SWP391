-- Migration 011 — Kết luận xử lý sự cố.
--
-- Trước đó phiếu sự cố chỉ có 3 trạng thái (open/investigating/resolved) và tên người xử lý,
-- KHÔNG có chỗ ghi ĐÃ KẾT LUẬN GÌ. Với khiếu nại hư hại xe thì đó là thiếu sót nặng: đóng
-- phiếu mà không ghi "bãi bồi thường" hay "từ chối vì ảnh lúc vào đã thiếu gương" thì sau này
-- không ai truy lại được căn cứ, và khách khiếu nại lần hai là cãi lại từ đầu.
--
-- Cột đã tồn tại thì lệnh báo lỗi → bỏ qua.
--
-- Cách chạy (ví dụ):
--   mysql -h <host> -P <port> -u <user> -p <database> < server/db/migrations/011_incident_resolution.sql

ALTER TABLE `incident`
  ADD COLUMN `resolution` VARCHAR(500) NULL
    COMMENT 'Kết luận xử lý — bắt buộc khi chuyển sang resolved'
    AFTER `resolved_at`;
