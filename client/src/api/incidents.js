import api from './axios';

// Sự cố (Incident) & Phản hồi (Customer Feedback).
// Staff báo + xem của mình; User gửi phản hồi + xem lịch sử; Manager/Admin xem tất cả + đổi trạng thái.
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export const incidentsApi = {
  list: (params) => api.get('/incidents', { params }),
  listMine: (params) => api.get('/incidents/mine', { params }),
  create: (data) => api.post('/incidents', data, MULTIPART),
  submitFeedback: (formData) => api.post('/incidents/feedback', formData, MULTIPART),
  // Đóng phiếu (status='resolved') BẮT BUỘC kèm resolution — BE trả RESOLUTION_REQUIRED nếu thiếu.
  updateStatus: (id, status, resolution) =>
    api.patch(`/incidents/${id}/status`, { status, resolution }),
  photoUrl: (id) => `/incidents/${id}/photo`,
};

/**
 * Tải file ảnh đính kèm của sự cố / phản hồi về dạng blob URL.
 */
export const fetchIncidentPhotoBlobUrl = async (incidentId, index = 0) => {
  const res = await api.get(`${incidentsApi.photoUrl(incidentId)}?index=${index}`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(res.data);
};

