import * as incidentService from "../services/incident.service.js";
import { asyncHandler, successResponse, AppError } from "../utils/helpers.js";
import { createReadStream } from "node:fs";
import { absolutePathOf } from "../utils/photoPipeline.js";
import { ROLES } from "../middleware/rbac.js";

export const list = asyncHandler(async (req, res) => {
  const roleName = req.user.role?.role_name;
  const incidents = await incidentService.listIncidents({
    status: req.query.status,
    type: req.query.type,
    category: req.query.category,
    date: req.query.date,
    limit: req.query.limit,
    page: req.query.page,
    roleName,
    // Staff chỉ thấy sự cố do chính mình báo; Admin thấy tất cả (Manager không còn xử lý sự cố)
    reporterId: roleName === ROLES.STAFF ? req.user.user_id : null,
  });
  successResponse(res, incidents);
});

export const create = asyncHandler(async (req, res) => {
  const incident = await incidentService.createIncident(req.user.user_id, req.body, req.file);
  successResponse(res, incident, 'Incident recorded', 201);
});

export const updateStatus = asyncHandler(async (req, res) => {
  const incident = await incidentService.updateIncidentStatus(
    req.params.id,
    req.body.status,
    req.user.user_id,
    req.body.resolution,
  );
  successResponse(res, incident, "Incident status updated");
});

export const createCustomerIncident = asyncHandler(async (req, res) => {
  const { description, type, sessionId } = req.body;
  if (!description || !description.trim()) {
    throw new AppError("Mô tả sự cố là bắt buộc", 400, "VALIDATION_ERROR");
  }

  const incident = await incidentService.createCustomerIncident(
    req.user.user_id,
    {
      description: description.trim(),
      type: type || "other",
      sessionId: sessionId ? Number(sessionId) : null,
      file: req.file,
    },
  );

  successResponse(res, incident, "Đã gửi báo cáo sự cố thành công", 201);
});

export const streamIncidentPhoto = asyncHandler(async (req, res) => {
  const incident = await incidentService.getIncidentById(req.params.id);
  if (!incident) {
    throw new AppError("Không tìm thấy báo cáo sự cố", 404, "NOT_FOUND");
  }
  if (!incident.image_path) {
    throw new AppError("Báo cáo sự cố không có ảnh", 404, "NOT_FOUND");
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, no-store");
  createReadStream(absolutePathOf(incident.image_path)).pipe(res);
});

// POST /incidents/feedback — khách hàng gửi phản hồi / khiếu nại kèm ảnh tùy chọn.
// Dùng createUserFeedback (type='feedback', category bắt buộc) hoặc createCustomerIncident nếu có file.
export const submitFeedback = asyncHandler(async (req, res) => {
  const { description, category, sessionId } = req.body;
  if (!description || !description.trim()) {
    throw new AppError("Mô tả phản hồi là bắt buộc", 400, "VALIDATION_ERROR");
  }

  let incident;
  if (req.file) {
    // Có ảnh → dùng createCustomerIncident (hỗ trợ lưu file)
    incident = await incidentService.createCustomerIncident(req.user.user_id, {
      description: description.trim(),
      type: category || "other",
      sessionId: sessionId ? Number(sessionId) : null,
      file: req.file,
    });
  } else {
    // Không có ảnh → dùng createUserFeedback
    incident = await incidentService.createUserFeedback(req.user.user_id, {
      description: description.trim(),
      category: category || "other",
      sessionId: sessionId ? Number(sessionId) : null,
    });
  }

  successResponse(res, incident, "Đã gửi phản hồi thành công", 201);
});

// GET /incidents/mine — lịch sử phản hồi của chính người dùng đang đăng nhập.
export const listMine = asyncHandler(async (req, res) => {
  const incidents = await incidentService.listIncidents({
    status: req.query.status,
    category: req.query.category,
    limit: req.query.limit || 50,
    page: req.query.page || 1,
    userId: req.user.user_id,
    type: ['feedback', 'vehicle_damage', 'other'], // Chỉ hiển thị các loại phản hồi của khách, không hiện log hệ thống
  });
  successResponse(res, incidents);
});

