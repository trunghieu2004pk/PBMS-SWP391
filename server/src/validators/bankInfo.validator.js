import { body } from 'express-validator';
import {
  ACCOUNT_NUMBER_PATTERN,
  ACCOUNT_HOLDER_PATTERN,
  BANK_NAME_PATTERN,
  BANK_NAME_MIN,
  BANK_NAME_MAX,
  sanitizeBankName,
  sanitizeBankAccountNumber,
  sanitizeBankAccountHolder,
} from '../utils/bankInfo.js';
import { isValidBankName } from '../utils/vietnamBanks.js';

/**
 * 3 trường tài khoản nhận hoàn tiền — dùng chung cho cập nhật hồ sơ (PATCH /auth/me) và
 * form hủy có hoàn tiền (POST /reservations/:id/cancel, /monthly-passes/:id/cancel).
 *
 * Ở tầng route mọi field đều OPTIONAL: "bắt buộc hay không" phụ thuộc lần hủy này có phát sinh
 * hoàn tiền hay không — chỉ service mới biết (xem utils/bankInfo.js resolveRefundBankInfo).
 * Tầng này chỉ lo ĐỊNH DẠNG để lỗi gõ sai hiện ngay, không phải đợi xuống service.
 */
export const bankInfoBodyValidator = [
  body('bankName').optional({ nullable: true })
    .customSanitizer((v) => (v == null || v === '' ? null : sanitizeBankName(v)))
    .custom((v) => v === null || (BANK_NAME_PATTERN.test(v) && isValidBankName(v)))
    .withMessage('Tên ngân hàng không tồn tại trong hệ thống ngân hàng Việt Nam'),
  body('bankAccountNumber').optional({ nullable: true })
    .customSanitizer((v) => (v == null || v === '' ? null : sanitizeBankAccountNumber(v)))
    .custom((v) => v === null || ACCOUNT_NUMBER_PATTERN.test(v))
    .withMessage('Số tài khoản không hợp lệ (6-19 chữ số)'),
  body('bankAccountHolder').optional({ nullable: true })
    .customSanitizer((v) => (v == null || v === '' ? null : sanitizeBankAccountHolder(v)))
    .custom((v) => v === null || ACCOUNT_HOLDER_PATTERN.test(v))
    .withMessage('Tên chủ tài khoản phải là chữ cái không dấu, từ 2 đến 50 ký tự'),
];

