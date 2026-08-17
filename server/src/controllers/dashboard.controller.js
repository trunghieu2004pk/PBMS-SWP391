import { asyncHandler, successResponse } from "../utils/helpers.js";
import * as dashboardService from "../services/dashboard.service.js";

export const getAdminDashboard = asyncHandler(async (req, res) => {
  // Gọi service lấy dữ liệu tổng quan
  const analyticsData = await dashboardService.getDashboardAnalytics();

  // Trả về dữ liệu bằng helper chuẩn của hệ thống
  successResponse(res, analyticsData, "Tải dữ liệu Dashboard thành công");
});
