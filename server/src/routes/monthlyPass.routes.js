import { Router } from 'express';
import { query } from 'express-validator';
import * as monthlyPassController from '../controllers/monthlyPass.controller.js';
import { validate } from '../middleware/validate.js';
import { authenticated, userOnly, staffOrManager } from '../middleware/access.js';
import { purchasePassValidator, passIdParam } from '../validators/monthlyPass.validator.js';
import { bankInfoBodyValidator } from '../validators/bankInfo.validator.js';
import { PASS_STATUSES } from '../models/monthlyPass.model.js';

const router = Router();

router.post('/',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Mua vé tháng (User) — tạo đơn + link thanh toán PayOS'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { plateNumber: '51F-67890', vehicleTypeId: 1, floorId: 1, startDate: '2026-07-01' } } } }
     #swagger.description = 'Vé cố định 1 tháng; ngày kết thúc + khung giờ (theo giờ mở cửa tòa) do server tự tính.' */
  ...userOnly, purchasePassValidator, validate, monthlyPassController.purchase);

router.get('/',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Danh sách vé tháng (Staff/Manager) — lọc status/tầng/biển số'
     #swagger.parameters['status'] = { in: 'query', description: 'pending | active | expired | cancelled', schema: { type: 'string' } }
     #swagger.parameters['floorId'] = { in: 'query', schema: { type: 'integer' } }
     #swagger.parameters['plate'] = { in: 'query', description: 'Tìm gần đúng theo biển số', schema: { type: 'string' } } */
  ...staffOrManager,
  query('status').optional().isIn(PASS_STATUSES),
  query('floorId').optional().isInt({ min: 1 }),
  validate,
  monthlyPassController.list);

router.get('/mine',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Vé tháng của tôi (User)' */
  ...userOnly, monthlyPassController.listMine);

router.get('/capacity',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Sức chứa vé tháng còn lại theo tầng + loại xe'
     #swagger.parameters['floorId'] = { in: 'query', required: true, schema: { type: 'integer' } }
     #swagger.parameters['vehicleTypeId'] = { in: 'query', required: true, schema: { type: 'integer' } } */
  ...authenticated, monthlyPassController.getCapacity);

router.get('/refund-policy',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Chính sách hoàn tiền hủy vé tháng (đọc từ settings, cho modal hủy vé User)' */
  ...authenticated, monthlyPassController.getRefundPolicy);

router.post('/:id/cancel',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Hủy vé tháng (User, chủ vé) — tính % hoàn theo chính sách'
     #swagger.description = 'Trước ngày hiệu lực hoàn 100%; 3 ngày đầu 70%; tới hết nửa thời hạn 50%; quá nửa không hoàn. Còn % hoàn → BẮT BUỘC kèm tài khoản nhận hoàn: bankName, bankAccountNumber, bankAccountHolder (thiếu trả 400 BANK_INFO_REQUIRED; hồ sơ đã lưu đủ 3 trường thì được dùng lại).'
     #swagger.requestBody = { content: { 'application/json': { example: { bankName: 'Vietcombank', bankAccountNumber: '0123456789', bankAccountHolder: 'NGUYEN VAN A' } } } } */
  ...userOnly, passIdParam, bankInfoBodyValidator, validate, monthlyPassController.cancel);

router.post('/:id/repay',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Lấy lại link thanh toán cho vé pending (User, chủ vé)'
     #swagger.description = 'Link PayOS cũ còn hiệu lực thì trả lại; hết hiệu lực thì đánh dấu payment cũ failed và sinh link + payment mới. Trả về { checkoutUrl, reused }.' */
  ...userOnly, passIdParam, validate, monthlyPassController.repay);

// LƯU Ý: '/:id' (route bắt-tất) phải nằm DƯỚI mọi route chữ cụ thể như '/mine', '/capacity'.
router.get('/:id',
  /* #swagger.tags = ['Monthly Passes']
     #swagger.summary = 'Chi tiết vé tháng (chủ vé hoặc Staff)' */
  ...authenticated, passIdParam, validate, monthlyPassController.get);

export default router;
