import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

export const INCIDENT_TYPES = [
  "wrong_floor",
  "duplicate_session",
  "window_violation",
  "slot_conflict",
  "lost_ticket",
  "wrong_info",
  "overstay",
  "wrong_zone",
  "feedback",
  // Khách khiếu nại xe bị hư hại trong lúc gửi (mất gương, xước…). Đối chứng bằng bộ ảnh
  // hiện trạng VÀO/RA của phiên — xem session_photo (migration 010).
  "vehicle_damage",
  "other",
];

export const INCIDENT_STATUSES = ["open", "investigating", "resolved"];

export const FEEDBACK_CATEGORIES = [
  "lost_card",
  "wrong_fee",
  "hard_to_find",
  "slot_taken",
  "other",
];

const Incident = sequelize.define(
  "incident",
  {
    incident_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    session_id: { type: DataTypes.INTEGER, allowNull: true },
    slot_id: { type: DataTypes.INTEGER, allowNull: true },
    user_id: { type: DataTypes.INTEGER, allowNull: true },
    reservation_id: { type: DataTypes.INTEGER, allowNull: true },
    pass_id: { type: DataTypes.INTEGER, allowNull: true },
    reported_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Staff/Admin who reported the incident",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...INCIDENT_TYPES),
      allowNull: false,
      defaultValue: "other",
    },
    category: {
      type: DataTypes.ENUM(...FEEDBACK_CATEGORIES),
      allowNull: true,
      comment: "Feedback category when type=feedback",
    },
    status: {
      type: DataTypes.ENUM(...INCIDENT_STATUSES),
      allowNull: false,
      defaultValue: "open",
    },
    resolved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Manager/Admin who resolved the incident",
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When the incident was marked resolved",
    },
    // Bắt buộc khi đóng phiếu. Đây là thứ trả lời "vì sao kết luận như vậy" khi khách
    // khiếu nại lần hai hoặc khi rà soát lại về sau.
    resolution: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Kết luận xử lý — bắt buộc khi chuyển sang resolved",
    },
    image_path: {
      type: DataTypes.STRING(1000),
      allowNull: true,
      comment: "Ảnh liên quan đến sự cố",
    },
  },
  { tableName: "incident", timestamps: true },
);

export default Incident;
