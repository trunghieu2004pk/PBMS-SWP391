import api from './axios';

// Ảnh hiện trạng xe + người lái (bằng chứng đối chiếu khi khách khiếu nại hư hại).
//
// BẮT BUỘC ghi đè Content-Type khi upload. Instance axios đặt mặc định 'application/json'
// (api/axios.js), mà transformRequest của axios v1 gặp FormData + Content-Type JSON sẽ
// CHUYỂN FormData THÀNH JSON (formDataToJSON) — Blob bị vứt, server nhận req.file rỗng và
// báo "Thiếu file ảnh". Đặt 'multipart/form-data' để nó đi thẳng; adapter xhr sau đó tự
// bỏ header này và để trình duyệt gắn boundary chuẩn.
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };
export const sessionPhotosApi = {
  // Toàn bộ ảnh của 1 phiên, kèm tiến độ từng phase: { entry, exit, entryProgress, exitProgress }
  list: (sessionId) => api.get(`/sessions/${sessionId}/photos`),

  /**
   * Tải 1 ảnh. `blob` lấy từ canvas sau khi nhân viên chọn tệp.
   * capturedAt = thời điểm nhân viên nhập tệp vào hệ thống (đóng lên watermark).
   */
  upload: (sessionId, { blob, phase, kind }) => {
    const form = new FormData();
    form.append('photo', blob, `${phase}-${kind}.jpg`);
    form.append('phase', phase);
    form.append('kind', kind);
    form.append('capturedAt', new Date().toISOString());
    return api.post(`/sessions/${sessionId}/photos`, form, MULTIPART);
  },

  // URL xem file — cần token nên dùng qua fetchBlobUrl() bên dưới, không nhét thẳng vào <img src>.
  fileUrl: (sessionId, photoId) => `/sessions/${sessionId}/photos/${photoId}/file`,
};

/**
 * Tải file ảnh về dạng blob URL để hiển thị.
 * Route ảnh yêu cầu Authorization nên KHÔNG thể gán thẳng vào <img src> — trình duyệt
 * gọi trần không kèm token sẽ nhận 401. Nhớ revokeObjectURL khi gỡ ảnh khỏi DOM.
 */
export const fetchPhotoBlobUrl = async (sessionId, photoId) => {
  const res = await api.get(sessionPhotosApi.fileUrl(sessionId, photoId), {
    responseType: 'blob',
  });
  return {
    url: URL.createObjectURL(res.data),
    // BE gắn cờ này khi hash file trên đĩa lệch với hash đã lưu ⇒ ảnh đã bị sửa.
    intact: res.headers['x-photo-intact'] !== 'false',
  };
};
