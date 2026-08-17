import { Router } from 'express';
import * as sessionController from '../controllers/session.controller.js';
import * as sessionPhotoController from '../controllers/sessionPhoto.controller.js';
import { validate } from '../middleware/validate.js';
import { singlePhoto } from '../middleware/photoUpload.js';
import {
  staffOnly,
  staffOrManager,
  staffOrAdmin,
  authenticated,
  userOnly,
} from '../middleware/access.js';
import {
  checkinValidator,
  checkoutValidator,
  previewFeeValidator,
  sessionIdParam,
  correctPlateValidator,
  staffQrLookupValidator,
  photoUploadValidator,
  photoIdParam,
  cancelEntryValidator,
  identifyPlateValidator,
} from '../validators/session.validator.js';

const router = Router();

router.get('/active',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Xe đang trong bãi (Staff)' */
  ...staffOnly, sessionController.listActive);

router.get('/mine/active',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Phiên đang mở của tôi (User)' */
  ...userOnly, sessionController.listMineActive);

router.get(
  '/staff/lookup',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Tra cứu phiên bằng QR (Staff/Manager)'
     #swagger.parameters['qrToken'] = { in: 'query', required: true, description: 'Mã QR trên vé (≥16 ký tự)', schema: { type: 'string' } } */
  ...staffOrManager,
  staffQrLookupValidator,
  validate,
  sessionController.staffLookupByQr,
);

router.get(
  '/staff/resolve-checkin-qr',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Quét QR khách ở quầy CHECK-IN (Staff) — trả thông tin để điền sẵn ô nhập'
     #swagger.description = 'Nhận QR đặt chỗ hoặc vé tháng, trả về biển số + loại xe + tầng. KHÔNG tự check-in — nhân viên xác nhận rồi mới bấm.'
     #swagger.parameters['qrToken'] = { in: 'query', required: true, schema: { type: 'string' } } */
  ...staffOnly,
  staffQrLookupValidator,
  validate,
  sessionController.resolveCheckinQr,
);

router.get(
  '/staff/identify-plate',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Gõ tay biển số ở quầy → nhận diện đặt chỗ / vé tháng (Staff)'
     #swagger.description = 'Cùng hình dạng trả về với resolve-checkin-qr. Trả null nếu biển không khớp gì — đó là khách vãng lai, không phải lỗi.'
     #swagger.parameters['plateNumber'] = { in: 'query', required: true, schema: { type: 'string' } } */
  ...staffOnly,
  identifyPlateValidator,
  validate,
  sessionController.identifyPlate,
);

router.get('/:id',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Chi tiết phiên' */
  ...authenticated, sessionIdParam, validate, sessionController.get);

router.post('/checkin',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Check-in xe vào (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { plateNumber: '51F-12345', vehicleTypeId: 1, floorId: 1, gateId: 1, zoneId: 1 } } } } */
  ...staffOnly, checkinValidator, validate, sessionController.checkin);

router.post('/checkout',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Check-out xe ra + tính phí (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { plateNumber: '51F-12345', gateId: 2, lostTicket: false } } } } */
  ...staffOnly, checkoutValidator, validate, sessionController.checkout);

router.post('/cash-checkout',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Tất toán tiền mặt tại booth + mở barie (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { qrToken: 'xxxxxxxxxxxxxxxx', gateId: 2, lostTicket: false } } } } */
  ...staffOnly, checkoutValidator, validate, sessionController.cashCheckout);

router.post('/preview-fee',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Xem trước phí (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { plateNumber: '51F-12345', lostTicket: false } } } } */
  ...staffOnly, previewFeeValidator, validate, sessionController.previewFee);

router.patch('/:id/plate',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Sửa biển số phiên (Staff)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { plateNumber: '51F-67890' } } } } */
  ...staffOnly, correctPlateValidator, validate, sessionController.correctPlate);

router.patch('/:id/checkout-options',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Cập nhật tùy chọn checkout lố giờ/mất thẻ (Staff)' */
  ...staffOnly, sessionIdParam, validate, sessionController.updateCheckoutOptions);

router.post('/:id/cancel-entry',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Hủy phiên CHƯA qua cổng vào (Staff) — gỡ phiên kẹt, trả lại chỗ'
     #swagger.description = 'Chỉ dùng khi xe chưa vào bãi (gate_stage=checked_in), vd chụp ảnh hỏng hoặc khách đổi ý. Xe đã vào rồi thì phải cho ra bằng luồng xe ra.'
     #swagger.requestBody = { content: { 'application/json': { example: { reason: 'Chup anh loi, khach doi y' } } } } */
  ...staffOnly, cancelEntryValidator, validate, sessionController.cancelEntry);

// === Ảnh hiện trạng xe + người lái ===
// KHÔNG có route DELETE: bảng ảnh append-only, chỉ job retention được xóa. Có nút xóa
// là bằng chứng mất sạch giá trị đối chất.
router.post('/:id/photos',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Tải 1 ảnh hiện trạng xe/người lái (Staff)'
     #swagger.consumes = ['multipart/form-data']
     #swagger.description = 'Chụp lại cùng góc thì GHI ĐÈ ảnh cũ. Đủ 4 góc xe + ảnh người lái mới mở được barie.' */
  ...staffOnly, singlePhoto('photo'), photoUploadValidator, validate, sessionPhotoController.upload);

router.get('/:id/photos',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Danh sách ảnh hiện trạng của phiên (Staff/Admin)' */
  ...staffOrAdmin, sessionIdParam, validate, sessionPhotoController.list);

router.get('/:id/photos/:photoId/file',
  /* #swagger.tags = ['Sessions']
     #swagger.summary = 'Xem file ảnh (Staff/Admin) — mỗi lần xem đều ghi audit log' */
  ...staffOrAdmin, photoIdParam, validate, sessionPhotoController.streamFile);

export default router;
