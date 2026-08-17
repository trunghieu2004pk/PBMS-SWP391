import { body, param, query } from 'express-validator';
import { requiredPlateNumber, optionalPlateNumber } from './plate.validator.js';

export const checkinValidator = [
  requiredPlateNumber('plateNumber'),
  body('vehicleTypeId').isInt({ min: 1 }).withMessage('vehicleTypeId is required'),
  body('floorId').isInt({ min: 1 }).withMessage('floorId is required'),
  // Optional: nếu bỏ trống, BE tự suy cổng IN duy nhất của tầng.
  body('gateId').optional().isInt({ min: 1 }),
  body('zoneId').optional().isInt({ min: 1 }),
  body('userId').optional().isInt({ min: 1 }),
];

// Preview phí: chỉ cần định danh phiên (chưa cần cổng ra)
export const previewFeeValidator = [
  body('sessionId').optional().isInt({ min: 1 }),
  body('qrToken').optional().isString().notEmpty(),
  optionalPlateNumber('plateNumber'),
  body().custom((_value, { req }) => {
    if (!req.body.sessionId && !req.body.qrToken && !req.body.plateNumber) {
      throw new Error('Provide sessionId, qrToken, or plateNumber');
    }
    return true;
  }),
  body('lostTicket').optional().isBoolean().toBoolean(),
  body('lostTicketFee').optional().isInt({ min: 0 }),
  body('overstayCharge').optional().isBoolean().toBoolean(),
];

// Check-out: cần thêm cổng RA (OUT) để kiểm tra đúng tầng + ghi exit_gate_id
export const checkoutValidator = [
  ...previewFeeValidator,
  // Optional: nếu bỏ trống, BE tự suy cổng OUT duy nhất của tầng xe đang đỗ.
  body('gateId').optional().isInt({ min: 1 }),
  // Cho xe ra khi khách KHÔNG có mã QR = bỏ qua thứ duy nhất chứng minh "người này đúng là
  // người gửi xe". Bắt buộc ghi lại giấy tờ đã đối chiếu, để nếu sau này mất xe thì còn biết
  // đã giao xe cho AI. Không có dòng này thì "báo mất thẻ" thành lối đi thẳng cho kẻ trộm.
  body('lostTicketNote')
    // .toBoolean() ở previewFeeValidator đã đổi lostTicket thành boolean thật, nên so bằng
    // .equals('true') sẽ trượt — kiểm cả hai dạng cho chắc.
    .if((_v, { req }) => req.body.lostTicket === true || req.body.lostTicket === 'true')
    .isString()
    .trim()
    .isLength({ min: 8 })
    .withMessage('Phải ghi giấy tờ đã đối chiếu (loại giấy tờ, số, tên người nhận xe)'),
];

export const sessionIdParam = [param('id').isInt({ min: 1 }).withMessage('Invalid session id')];

export const correctPlateValidator = [
  ...sessionIdParam,
  requiredPlateNumber('plateNumber'),
];

export const identifyPlateValidator = [
  query('plateNumber').isString().trim().notEmpty().withMessage('Thiếu biển số'),
];

export const staffQrLookupValidator = [
  query('qrToken').isString().trim().notEmpty().isLength({ min: 16 }),
];

// === Ảnh hiện trạng xe + người lái (migration 010) ===
// Chạy SAU middleware multer: multipart nên các field text nằm ở req.body dạng chuỗi.
export const photoUploadValidator = [
  ...sessionIdParam,
  body('phase').isIn(['entry', 'exit']).withMessage('phase phải là entry hoặc exit'),
  body('kind')
    .isIn(['front', 'left', 'rear', 'right', 'driver'])
    .withMessage('kind không hợp lệ'),
  body('capturedAt').isISO8601().withMessage('capturedAt phải là ISO8601'),
  // Nguồn ảnh do máy chủ tự đặt ('upload') — không nhận từ client, tránh giả mạo nguồn gốc.
];

export const cancelEntryValidator = [
  ...sessionIdParam,
  body('reason').optional({ nullable: true }).isString().isLength({ max: 200 }),
];

export const photoIdParam = [
  ...sessionIdParam,
  param('photoId').isInt({ min: 1 }).withMessage('Invalid photo id'),
];
