import api from "./axios";

// Khu vực Quản trị (Admin-only) — backend tự kiểm role qua middleware.
export const auditApi = {
  // Nhật ký thao tác Admin/Manager — lọc (actorId, action, from, to) + phân trang (page, limit).
  list: (params) => api.get("/admin/audit-logs", { params }),
};

// Quản lý tài khoản người dùng (Admin-only).
export const usersApi = {
  list: () => api.get("/admin/users"),
  listRoles: () => api.get("/admin/users/roles"),
  create: (data) => api.post("/admin/users", data),
  update: (id, data) => api.patch(`/admin/users/${id}`, data),
};

// SỬA LẠI TỪ axiosClient THÀNH api CHO ĐÚNG VỚI INSTANCE CỦA DỰ ÁN
export const getDashboardData = async (filters = {}) => {
  const response = await api.get("/dashboard", { params: filters });
  return response.data;
};
// --- THÊM 2 HÀM AI MỚI VÀO ĐÂY ---
export const aiApi = {
  chat: (question) => api.post("/admin/ai/chat", { question }),
  scanSecurity: () => api.post("/admin/ai/scan-security"),
};
