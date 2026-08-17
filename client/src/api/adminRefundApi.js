import api from "./axios"; // axios instance của bạn

export const adminRefundApi = {
  list: (params) => api.get("/admin/refunds", { params }),
  remind: (id) => api.post(`/admin/refunds/${id}/remind`),
  process: (id) => api.post(`/admin/refunds/${id}/process`),
  complete: (id, note) => api.post(`/admin/refunds/${id}/complete`, { note }),
};
