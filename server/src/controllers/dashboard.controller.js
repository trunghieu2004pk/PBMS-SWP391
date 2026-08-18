import { asyncHandler, successResponse } from "../utils/helpers.js";
import * as dashboardService from "../services/dashboard.service.js";

export const getAdminDashboard = asyncHandler(async (req, res) => {
  // Lấy các tham số lọc từ query
  const { startDate, endDate } = req.query;

  // Gọi service và truyền dữ liệu lọc
  const analyticsData = await dashboardService.getDashboardAnalytics({
    startDate,
    endDate,
  });

  successResponse(res, analyticsData, "Tải dữ liệu Dashboard thành công");
});
