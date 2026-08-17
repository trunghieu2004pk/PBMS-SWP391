import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const PHOTO_PHASES = ['entry', 'exit'];

// 4 góc xe + ảnh NGƯỜI LÁI.
export const PHOTO_KINDS = ['front', 'left', 'rear', 'right', 'driver'];

/**
 * Nguồn ảnh. Hiện hệ thống CHỈ dùng 'upload' — nhân viên nhập tệp ảnh từ máy.
 * Hai giá trị còn lại giữ trong ENUM để dữ liệu cũ không hỏng; không đường nào tạo mới chúng.
 */
export const PHOTO_SOURCES = ['camera', 'upload', 'simulated'];

// Nhãn tiếng Việt dùng chung cho FE + thông báo lỗi BE ("thiếu ảnh: bên trái, người lái").
export const PHOTO_KIND_LABELS = {
  front: 'đầu xe',
  left: 'bên trái',
  rear: 'đuôi xe',
  right: 'bên phải',
  driver: 'người lái',
};

const SessionPhoto = sequelize.define(
  'session_photo',
  {
    photo_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    session_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    phase: {
      type: DataTypes.ENUM(...PHOTO_PHASES),
      allowNull: false,
      comment: 'Chụp lúc VÀO hay lúc RA',
    },
    kind: {
      type: DataTypes.ENUM(...PHOTO_KINDS),
      allowNull: false,
    },
    file_path: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Tương đối trong uploads/ — KHÔNG lưu base64 vào DB',
    },
    sha256_raw: {
      type: DataTypes.CHAR(64),
      allowNull: false,
      comment:
        'Hash file GỐC (trước resize/watermark). Dùng phát hiện dùng lại ảnh cũ ở phiên khác. ' +
        'Chỉ so trùng khi source=camera — ảnh mô phỏng dùng lại là chuyện bình thường.',
    },
    sha256_stored: {
      type: DataTypes.CHAR(64),
      allowNull: false,
      comment: 'Hash file ĐÃ LƯU — đối chiếu để chứng minh ảnh chưa bị sửa sau khi lưu',
    },
    phash: {
      type: DataTypes.CHAR(16),
      allowNull: true,
      comment:
        'dHash 64-bit của NỘI DUNG nhìn thấy. sha256 chỉ bắt được file y hệt; cái này bắt ' +
        'được trò chụp CÙNG MỘT CẢNH rồi nộp cho nhiều góc khác nhau (byte khác, ảnh giống).',
    },
    source: {
      type: DataTypes.ENUM(...PHOTO_SOURCES),
      allowNull: false,
      defaultValue: 'camera',
    },
    mime: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    bytes: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    width: {
      type: DataTypes.SMALLINT,
      allowNull: true,
    },
    height: {
      type: DataTypes.SMALLINT,
      allowNull: true,
    },
    captured_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Giờ client báo đã chụp',
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Giờ server nhận — lệch quá nhiều so với captured_at ⇒ ảnh cũ, từ chối',
    },
    captured_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Staff chụp; NULL nếu khách tự chụp ở kiosk',
    },
  },
  {
    tableName: 'session_photo',
    timestamps: true,
    indexes: [
      {
        // Mỗi lượt gửi chỉ có ĐÚNG 1 ảnh cho mỗi (giai đoạn, góc). Nhập lại là GHI ĐÈ,
        // không thêm dòng — nên không thể nộp nhiều tấm cho một góc rồi báo "đủ 5 ảnh".
        fields: ['session_id', 'phase', 'kind'],
        unique: true,
        name: 'uq_photo_session_phase_kind',
      },
      { fields: ['session_id'], name: 'idx_photo_session' },
      { fields: ['sha256_raw'], name: 'idx_photo_raw_hash' },
    ],
  },
);

export default SessionPhoto;
