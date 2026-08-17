import api from './axios';

// Phiên gửi xe — Staff vận hành (check-in / xem phí / xe ra / sửa biển số)
// + User tự xem xe của mình đang trong bãi.
export const sessionsApi = {
  // Danh sách xe đang trong bãi (trả về dạng phân trang: { items, total, page, ... }).
  listActive: (params) => api.get('/sessions/active', { params: { limit: 200, ...params } }),
  // User — xe của tôi đang trong bãi (kèm phí tạm tính, cờ vé tháng, cảnh báo lố giờ).
  mineActive: () => api.get('/sessions/mine/active'),
  // Staff — tra cứu phiên đang đỗ bằng mã QR trên vé (preview trước khi cho xe ra). qrToken ≥ 16 ký tự.
  staffLookup: (qrToken) => api.get('/sessions/staff/lookup', { params: { qrToken } }),
  get: (id) => api.get(`/sessions/${id}`),
  // Check-in xe vào: { plateNumber, vehicleTypeId, floorId, gateId, zoneId? }
  checkin: (data) => api.post('/sessions/checkin', data),
  // Quét QR khách ở quầy check-in (đặt chỗ / vé tháng) → { kind, label, plateNumber,
  // vehicleTypeId, floorId } để điền sẵn ô nhập. KHÔNG tự check-in.
  resolveCheckinQr: (qrToken) => api.get('/sessions/staff/resolve-checkin-qr', { params: { qrToken } }),
  // Gõ TAY biển số ở quầy → nhận diện đặt chỗ / vé tháng. Trả data = null nếu là khách vãng
  // lai (không phải lỗi) — cùng hình dạng với resolveCheckinQr để màn check-in dùng chung.
  identifyPlate: (plateNumber) => api.get('/sessions/staff/identify-plate', { params: { plateNumber } }),
  // Xem trước phí: cần 1 trong { sessionId | plateNumber | qrToken }, kèm lostTicket?
  previewFee: (data) => api.post('/sessions/preview-fee', data),
  // Xe ra (check-out): { sessionId | plateNumber, gateId (cổng OUT), lostTicket? }
  // Trả về { fee, barrierOpened, freeCheckout?, passCovered?, payment? }
  checkout: (data) => api.post('/sessions/checkout', data),
  // Sửa biển số phiên đang mở
  correctPlate: (id, plateNumber) => api.patch(`/sessions/${id}/plate`, { plateNumber }),
  // Hủy phiên CHƯA qua cổng vào (chụp ảnh hỏng / khách đổi ý) — trả lại chỗ + mở khóa biển số.
  // Xe đã vào bãi rồi thì BE chặn, phải cho ra bằng luồng xe ra.
  cancelEntry: (id, reason) => api.post(`/sessions/${id}/cancel-entry`, { reason }),
  // Tất toán TIỀN MẶT tại booth (cần token Staff): { qrToken | sessionId, gateId?, lostTicket? }
  // Trả về { barrierOpened, fee, method: 'cash', session, payment }
  cashCheckout: (data) => api.post('/sessions/cash-checkout', data),
  // Cập nhật tùy chọn checkout lố giờ/mất thẻ
  updateCheckoutOptions: (id, data) => api.patch(`/sessions/${id}/checkout-options`, data),
};
