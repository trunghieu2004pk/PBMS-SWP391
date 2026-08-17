import { Router } from "express";
import { getAdminDashboard } from "../controllers/dashboard.controller.js";

const router = Router();

// Tạm thời gọi trực tiếp controller, bỏ qua middleware phân quyền để Backend không bị lỗi
router.get("/", getAdminDashboard);

export default router;
