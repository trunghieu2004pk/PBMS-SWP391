import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_ROOT } from "../utils/photoPipeline.js";
import { Op } from "sequelize";
import sequelize from "../config/db.js";
import Incident, {
  INCIDENT_TYPES,
  FEEDBACK_CATEGORIES,
} from "../models/incident.model.js";
import { AppError } from "../utils/helpers.js";
import { ROLES } from "../middleware/rbac.js";
import {
  parsePagination,
  findAndPaginate,
  paginatedResult,
} from "../utils/pagination.js";
import { enrichIncident } from "../utils/enumLabels.js";

// Danh sách các loại sự cố BẮT BUỘC phải đính kèm với một thực thể (phiên đỗ xe, chỗ đỗ, vé...).
// VD: Không thể báo "mất vé" (lost_ticket) mà không biết là vé của xe nào.
const LINK_REQUIRED_TYPES = [
  "lost_ticket",
  "wrong_info",
  "overstay",
  "wrong_zone",
];

// Cấu hình Join bảng: Khi lấy dữ liệu sự cố, hệ thống sẽ tự động lấy thêm
// thông tin về phiên đỗ (session), chỗ đỗ (slot), người dùng (user) và nhân viên liên quan.
const incidentIncludes = [
  {
    association: "session",
    attributes: ["session_id", "plate_number", "session_type", "time_out"],
  },
  { association: "slot", attributes: ["slot_id", "slot_code"] },
  { association: "user", attributes: ["user_id", "full_name", "username"] },
  { association: "reporter", attributes: ["user_id", "full_name", "username"] },
  { association: "resolver", attributes: ["user_id", "full_name", "username"] },
];

/**
 * GHI SỰ CỐ NGẦM (Tự động từ hệ thống)
 * Bao bọc bởi try-catch và cố ý return null nếu lỗi chứ KHÔNG throw error.
 * Lý do: Việc ghi log sự cố (phụ) không được phép làm sập/chặn luồng chính (như mở cổng cho khách).
 */
export const recordIncident = async (payload) => {
  try {
    return await Incident.create({
      session_id: payload.sessionId || null,
      slot_id: payload.slotId || null,
      user_id: payload.userId || null,
      reservation_id: payload.reservationId || null,
      pass_id: payload.passId || null,
      reported_by: payload.reportedBy || null,
      type: payload.type || "other",
      category: payload.category || null,
      description: payload.description,
      status: payload.status || "open",
    });
  } catch (err) {
    console.error("[incident] Failed to write incident:", err.message);
    return null;
  }
};

/**
 * NHÂN VIÊN TẠO SỰ CỐ (Hỗ trợ upload nhiều ảnh)
 */
export const createIncident = async (reporterId, data, file) => {
  // Kiểm tra tính hợp lệ của loại sự cố
  if (!INCIDENT_TYPES.includes(data.type)) {
    throw new AppError("Invalid incident type", 400, "INCIDENT_INVALID");
  }

  // Kiểm tra ràng buộc: Nếu thuộc nhóm bắt buộc phải có đối tượng liên kết
  if (LINK_REQUIRED_TYPES.includes(data.type)) {
    const hasLink =
      data.sessionId ||
      data.slotId ||
      data.reservationId ||
      data.passId ||
      data.userId;
    if (!hasLink) {
      throw new AppError(
        "At least one linked entity (session, slot, reservation, pass, user) is required",
        400,
        "INCIDENT_INVALID",
      );
    }
  }

  // Xử lý upload ảnh (hỗ trợ lưu nhiều ảnh)
  let imagePath = null;
  // Đảm bảo file luôn là một mảng để dễ dùng vòng lặp, dù có 1 hay nhiều file
  const fileArray = Array.isArray(file) ? file : file ? [file] : [];

  if (fileArray.length > 0) {
    const paths = [];
    for (const f of fileArray) {
      const fileExt = path.extname(f.originalname) || ".jpg";
      // Tạo tên file ngẫu nhiên để không bị trùng lặp
      const relativePath = path.posix.join(
        "incidents",
        `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${fileExt}`,
      );
      const absolutePath = path.join(UPLOAD_ROOT, relativePath);

      // Tạo thư mục nếu chưa có và lưu file
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, f.buffer);
      paths.push(relativePath); // Lưu lại đường dẫn
    }
    // Gộp nhiều đường dẫn thành 1 chuỗi, cách nhau bởi dấu phẩy để lưu vào 1 cột trong DB
    imagePath = paths.join(",");
  }

  const incident = await Incident.create({
    session_id: data.sessionId || null,
    slot_id: data.slotId || null,
    user_id: data.userId || null,
    reservation_id: data.reservationId || null,
    pass_id: data.passId || null,
    reported_by: reporterId,
    type: data.type,
    category: data.category || null,
    description: data.description.trim(),
    image_path: imagePath,
    status: "open",
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

/**
 * TỰ ĐỘNG GHI SỰ CỐ: Khi xe quá giờ (overstay) và bị thu phụ phí lúc ra cổng.
 */
export const reportOverstayCharge = async (
  reporterId,
  { sessionId, userId, hours, fee },
) => {
  if (!sessionId) return null;

  // Kiểm tra xem đã có phiếu lố giờ nào chưa giải quyết cho phiên này chưa
  const existing = await Incident.findOne({
    where: {
      session_id: sessionId,
      type: "overstay",
      status: { [Op.ne]: "resolved" }, // khác 'resolved' (tức là còn đang open/investigating)
    },
  });
  if (existing) return existing;

  const hrPart = hours > 0 ? ` (~${hours}h)` : "";
  return recordIncident({
    type: "overstay",
    description: `Lố giờ khi xe ra${hrPart} — phụ thu ${fee} VND`,
    sessionId,
    userId: userId || null,
    reportedBy: reporterId,
  });
};

/**
 * TẠO PHẢN HỒI TỪ KHÁCH HÀNG (Dành cho góp ý chung, không cần ảnh)
 */
export const createUserFeedback = async (userId, data) => {
  if (!FEEDBACK_CATEGORIES.includes(data.category)) {
    throw new AppError("Invalid feedback category", 400, "FEEDBACK_INVALID");
  }

  const incident = await Incident.create({
    session_id: data.sessionId || null,
    slot_id: null,
    user_id: userId,
    reported_by: null, // Khách tự báo cáo nên reporter là null
    type: "feedback",
    category: data.category,
    description: data.description.trim(),
    status: "open",
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

/**
 * LẤY DANH SÁCH SỰ CỐ (Dùng cho Admin/Staff xem tổng quan hoặc Khách hàng xem lịch sử cá nhân)
 */
export const listIncidents = async ({
  status,
  type,
  category,
  date,
  limit,
  page,
  roleName,
  reporterId,
  userId,
}) => {
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (category) where.category = category;

  // Phân quyền: Nhân viên chỉ thấy các sự cố do mình tạo
  if (roleName === ROLES.STAFF && reporterId) {
    where.reported_by = reporterId;
  }
  // Lọc lấy sự cố của riêng một khách hàng
  if (userId) where.user_id = userId;

  // Lọc theo ngày tạo
  if (date) {
    where[Op.and] = [
      sequelize.where(
        sequelize.fn("DATE", sequelize.col("incident.created_at")),
        date,
      ),
    ];
  }

  const pagination = parsePagination({ page, limit });
  const result = await findAndPaginate(Incident, {
    where,
    include: incidentIncludes,
    order: [["created_at", "DESC"]], // Sự cố mới nhất xếp trên
    ...pagination,
  });

  return paginatedResult(
    result.items.map(enrichIncident),
    result.total,
    result.page,
    result.limit,
  );
};

/**
 * CẬP NHẬT TRẠNG THÁI SỰ CỐ (Đóng phiếu / Mở lại phiếu)
 */
export const updateIncidentStatus = async (
  id,
  status,
  resolverId = null,
  resolution = null,
) => {
  const incident = await Incident.findByPk(id);
  if (!incident) throw new AppError("Incident not found", 404, "NOT_FOUND");

  const patch = { status };
  if (status === "resolved") {
    // RÀNG BUỘC CHẶT: Phải ghi rõ kết luận (resolution) thì mới cho phép đóng phiếu.
    const text = String(resolution || "").trim();
    if (!text) {
      throw new AppError(
        "Phải ghi kết luận xử lý trước khi đóng phiếu (vd: bãi bồi thường / từ chối vì ảnh lúc vào đã có hư hại).",
        400,
        "RESOLUTION_REQUIRED",
      );
    }
    patch.resolved_by = resolverId;
    patch.resolved_at = new Date();
    patch.resolution = text.slice(0, 500); // Giới hạn 500 ký tự
  } else {
    // Nếu mở lại phiếu (reopen), phải xóa trắng các kết luận cũ
    patch.resolved_by = null;
    patch.resolved_at = null;
    patch.resolution = null;
  }

  await incident.update(patch);
  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

/**
 * TỰ ĐỘNG GHI SỰ CỐ: Xe dùng vé tháng nhưng quẹt thẻ ngoài khung giờ đăng ký.
 */
export const recordPassWindowViolation = async ({
  passId,
  userId,
  plateNumber,
  gateId,
}) => {
  // Tránh spam: Nếu lỗi này đã báo trong vòng 1 tiếng qua thì không báo lại
  const recent = await Incident.findOne({
    where: {
      pass_id: passId,
      type: "window_violation",
      status: "open",
      created_at: { [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  if (recent) return recent;

  return recordIncident({
    type: "window_violation",
    passId,
    userId,
    description: `Vé tháng ${plateNumber} quét cổng ngoài khung giờ hiệu lực${gateId ? ` (gate ${gateId})` : ""}`,
    status: "open",
  });
};

/**
 * TỰ ĐỘNG GHI SỰ CỐ: Xe vào sai tầng so với vị trí được chỉ định.
 */
export const recordWrongFloorIncident = async ({
  gateFloorId,
  expectedFloorId,
  reservationId,
  passId,
  userId,
  slotId,
}) => {
  const entity = reservationId ? "reservation" : "pass";
  return recordIncident({
    type: "wrong_floor",
    description: `Wrong floor at gate: gate on floor ${gateFloorId}, ${entity} expects floor ${expectedFloorId}`,
    reservationId,
    passId,
    userId,
    slotId,
  });
};

/**
 * KHÁCH HÀNG TỰ BÁO CÁO SỰ CỐ (Hỗ trợ upload NHIỀU ảnh, VÀ BẮT BUỘC phải có ảnh)
 */
export const createCustomerIncident = async (
  userId,
  { description, type, sessionId, files },
) => {
  if (type && !INCIDENT_TYPES.includes(type)) {
    throw new AppError("Loại sự cố không hợp lệ", 400, "INCIDENT_INVALID");
  }

  let imagePaths = [];
  // Bắt buộc phải cung cấp mảng files
  if (files && files.length > 0) {
    for (const file of files) {
      const fileExt = path.extname(file.originalname) || ".jpg";
      const relativePath = path.posix.join(
        "incidents",
        `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${fileExt}`,
      );
      const absolutePath = path.join(UPLOAD_ROOT, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.buffer);
      imagePaths.push(relativePath);
    }
  } else {
    // Không có file ảnh nào -> Ném lỗi từ chối
    throw new AppError(
      "Vui lòng upload ảnh liên quan đến sự cố",
      400,
      "PHOTO_REQUIRED",
    );
  }

  const incident = await Incident.create({
    user_id: userId,
    session_id: sessionId || null,
    reported_by: null,
    type: type || "other",
    description: description.trim(),
    image_path: imagePaths.join(","), // Gộp các đường dẫn ảnh lại bằng dấu phẩy
    status: "open",
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

export const getIncidentById = async (id) => {
  return await Incident.findByPk(id);
};
