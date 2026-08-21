import { Router } from "express";
import * as incidentController from "../controllers/incident.controller.js";
import { validate } from "../middleware/validate.js";
import {
  staffOnly,
  staffOrAdmin,
  adminOnly,
  userOnly,
  staffOrManagerOrAdmin,
  authenticated,
} from "../middleware/access.js";
import { singlePhoto, multiplePhotos } from "../middleware/photoUpload.js";
import {
  incidentListValidator,
  incidentCreateValidator,
  incidentStatusValidator,
} from "../validators/incident.validator.js";

const router = Router();

router.get(
  "/",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Danh sách sự cố — Staff chỉ thấy của mình, Admin thấy tất cả'
     #swagger.parameters['status'] = { in: 'query', description: 'open | investigating | resolved', schema: { type: 'string' } }
     #swagger.parameters['type'] = { in: 'query', description: 'Lọc theo loại sự cố', schema: { type: 'string' } }
     #swagger.parameters['page'] = { in: 'query', description: 'Trang (mặc định 1)', schema: { type: 'integer' } }
     #swagger.parameters['limit'] = { in: 'query', description: 'Số dòng/trang (tối đa 200)', schema: { type: 'integer' } } */
  ...staffOrManagerOrAdmin,
  incidentListValidator,
  validate,
  incidentController.list,
);

router.post(
  "/",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Tạo sự cố (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { type: 'wrong_info', description: 'Khách báo sai biển số', sessionId: 1 } } } } */
  ...staffOnly,
  multiplePhotos("photos", 5),
  incidentCreateValidator,
  validate,
  incidentController.create,
);

router.patch(
  "/:id/status",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Cập nhật trạng thái sự cố (Admin) — mọi sự cố dồn về Admin xử lý'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { status: 'resolved' } } } } */
  ...adminOnly,
  incidentStatusValidator,
  validate,
  incidentController.updateStatus,
);

router.post(
  "/customer",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Khách hàng gửi báo cáo sự cố kèm ảnh' */
  ...userOnly,
  multiplePhotos("photos", 5),
  incidentController.createCustomerIncident,
);

router.get(
  "/:id/photo",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Stream ảnh sự cố của khách hàng' */
  ...authenticated,
  incidentController.streamIncidentPhoto,
);

// === Phản hồi khách hàng (User) ===
// POST /incidents/feedback — khách hàng gửi phản hồi / khiếu nại kèm ảnh
router.post(
  "/feedback",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Khách hàng gửi phản hồi / khiếu nại (có ảnh đính kèm tùy chọn)' */
  ...userOnly,
  multiplePhotos("photos", 5),
  incidentController.submitFeedback,
);

// GET /incidents/mine — lịch sử phản hồi của chính người dùng
router.get(
  "/mine",
  /* #swagger.tags = ['Incidents']
     #swagger.summary = 'Lịch sử phản hồi / sự cố do chính người dùng gửi' */
  ...userOnly,
  incidentController.listMine,
);

export default router;
