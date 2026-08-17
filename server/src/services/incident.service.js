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

const LINK_REQUIRED_TYPES = ['lost_ticket', 'wrong_info', 'overstay', 'wrong_zone'];

const incidentIncludes = [
  // time_out để tính CỬA SỔ KHIẾU NẠI (phiếu lập trước hay sau khi xe rời bãi).
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
 * Ghi sự cố "nền" — KHÔNG BAO GIỜ ném lỗi (catch nuốt, trả null). Đây là ghi vết phụ, hỏng nó
 * không được phép làm hỏng nghiệp vụ chính đang gọi nó (quét cổng, thu tiền...).
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

export const createIncident = async (reporterId, data, file) => {
  if (!INCIDENT_TYPES.includes(data.type)) {
    throw new AppError("Invalid incident type", 400, "INCIDENT_INVALID");
  }

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

  let imagePath = null;
  if (file) {
    const fileExt = path.extname(file.originalname) || '.jpg';
    const relativePath = path.posix.join(
      'incidents',
      `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${fileExt}`
    );
    const absolutePath = path.join(UPLOAD_ROOT, relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);
    imagePath = relativePath;
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
    status: 'open',
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

/**
 * LỐ GIỜ — tự ghi sự cố khi checkout có thu phụ thu lố giờ.
 */
export const reportOverstayCharge = async (
  reporterId,
  { sessionId, userId, hours, fee },
) => {
  if (!sessionId) return null;
  const existing = await Incident.findOne({
    where: {
      session_id: sessionId,
      type: "overstay",
      status: { [Op.ne]: "resolved" },
    },
  });
  if (existing) return existing; // đã có báo cáo lố giờ đang mở → không tạo trùng
  const hrPart = hours > 0 ? ` (~${hours}h)` : "";
  return recordIncident({
    type: "overstay",
    description: `Lố giờ khi xe ra${hrPart} — phụ thu ${fee} VND`,
    sessionId,
    userId: userId || null,
    reportedBy: reporterId,
  });
};

export const createUserFeedback = async (userId, data) => {
  if (!FEEDBACK_CATEGORIES.includes(data.category)) {
    throw new AppError("Invalid feedback category", 400, "FEEDBACK_INVALID");
  }

  const incident = await Incident.create({
    session_id: data.sessionId || null,
    slot_id: null,
    user_id: userId,
    reported_by: null,
    type: "feedback",
    category: data.category,
    description: data.description.trim(),
    status: "open",
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

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
  if (roleName === ROLES.STAFF && reporterId) {
    where.reported_by = reporterId;
  }
  // Lọc theo user gửi phản hồi (dùng cho /incidents/mine của User)
  if (userId) where.user_id = userId;
  if (date) {
    where[Op.and] = [
      sequelize.where(sequelize.fn('DATE', sequelize.col('incident.created_at')), date)
    ];
  }

  const pagination = parsePagination({ page, limit });
  const result = await findAndPaginate(Incident, {
    where,
    include: incidentIncludes,
    order: [["created_at", "DESC"]],
    ...pagination,
  });

  return paginatedResult(
    result.items.map(enrichIncident),
    result.total,
    result.page,
    result.limit,
  );
};

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
    // ĐÓNG PHIẾU PHẢI CÓ KẾT LUẬN. Với khiếu nại hư hại xe, "đã xử lý" mà không nói xử lý
    // ra sao là vô giá trị — khách khiếu nại lần hai thì không còn căn cứ nào để đối chiếu.
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
    patch.resolution = text.slice(0, 500);
  } else {
    patch.resolved_by = null;
    patch.resolved_at = null;
    patch.resolution = null; // mở lại phiếu ⇒ kết luận cũ không còn hiệu lực
  }
  await incident.update(patch);
  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

export const recordPassWindowViolation = async ({
  passId,
  userId,
  plateNumber,
  gateId,
}) => {
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

export const createCustomerIncident = async (
  userId,
  { description, type, sessionId, file },
) => {
  if (type && !INCIDENT_TYPES.includes(type)) {
    throw new AppError("Loại sự cố không hợp lệ", 400, "INCIDENT_INVALID");
  }

  let imagePath = null;
  if (file) {
    const fileExt = path.extname(file.originalname) || ".jpg";
    const relativePath = path.posix.join(
      "incidents",
      `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${fileExt}`,
    );
    const absolutePath = path.join(UPLOAD_ROOT, relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);
    imagePath = relativePath;
  } else {
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
    image_path: imagePath,
    status: "open",
  });

  return enrichIncident(await incident.reload({ include: incidentIncludes }));
};

export const getIncidentById = async (id) => {
  return await Incident.findByPk(id);
};
