/**
 * Tài khoản nhận hoàn tiền — dùng chung cho 2 luồng hủy CÓ hoàn tiền
 * (hủy đặt chỗ đã trả phí giữ chỗ, hủy vé tháng còn % hoàn).
 *
 * Vì sao bắt nhập NGAY lúc hủy: trước đây user hủy xong mới được nhắc "vào hồ sơ cập nhật STK",
 * ai quên thì yêu cầu nằm pending tới khi job expireStaleRefunds cho hết hạn — tiền không bao giờ
 * tới tay khách mà cũng không ai thấy. Chốt STK ngay tại bước hủy thì mọi RefundRequest sinh ra
 * đều chuyển khoản được luôn (bankInfoReady = true ngay từ đầu).
 *
 * Quy tắc phải TRÙNG với validators/bankInfo.validator.js (tầng route) và client/src/lib/validate.js.
 */
import { AppError } from './helpers.js';
import { findMatchingBank, isValidBankName } from './vietnamBanks.js';

export const ACCOUNT_NUMBER_PATTERN = /^\d{6,19}$/;
export const BANK_NAME_MIN = 2;
export const BANK_NAME_MAX = 50;
export const BANK_NAME_PATTERN = /^[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ\s]{2,50}$/u;
export const ACCOUNT_HOLDER_MIN = 2;
export const ACCOUNT_HOLDER_MAX = 50;
export const ACCOUNT_HOLDER_PATTERN = /^[A-Z\s]{2,50}$/;

/** Xóa dấu tiếng Việt */
export const removeVietnameseTones = (str) => {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
};

/**
 * 1. Tên Ngân Hàng:
 * - Chuyển thành CHỮ HOA
 * - Không cho phép chữ số (0-9) và ký tự đặc biệt — CHỈ GIỮ LẠI CHỮ CÁI & KHỎANG TRẮNG
 * - Rút gọn khoảng trắng thừa
 */
export const sanitizeBankName = (val) => {
  if (val == null) return '';
  return String(val)
    .toUpperCase()
    .replace(/[^A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * 2. Số Tài Khoản:
 * - Lọc bỏ tất cả ký tự không phải số (chữ cái, dấu chấm, dấu gạch ngang, khoảng trắng)
 * - Tối đa 19 chữ số
 */
export const sanitizeBankAccountNumber = (val) => {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').slice(0, 19);
};

/**
 * 3. Tên Chủ Tài Khoản:
 * - Xóa dấu tiếng Việt + Chuyển thành CHỮ HOA
 * - Lọc bỏ số và ký tự đặc biệt (chỉ giữ lại chữ cái A-Z và khoảng trắng)
 * - Rút gọn khoảng trắng thừa
 */
export const sanitizeBankAccountHolder = (val) => {
  if (val == null) return '';
  const noTones = removeVietnameseTones(String(val)).toUpperCase();
  return noTones
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Chốt STK dùng cho lần hoàn này.
 * - User nhập ở form hủy → validate rồi dùng (và báo service lưu lại vào hồ sơ).
 * - Không nhập mà hồ sơ đã có ĐỦ 3 trường → dùng lại, khỏi bắt gõ lại.
 * - Cả hai đều thiếu → chặn hủy (400 BANK_INFO_REQUIRED) để FE bật form nhập.
 *
 * @returns {{ values: {bank_name, bank_account_number, bank_account_holder}, shouldPersist: boolean }}
 */
export const resolveRefundBankInfo = (user, input = {}) => {
  const hasInput = Boolean(
    (input.bankName != null && String(input.bankName).trim()) ||
    (input.bankAccountNumber != null && String(input.bankAccountNumber).trim()) ||
    (input.bankAccountHolder != null && String(input.bankAccountHolder).trim())
  );

  const provided = {
    bank_name: sanitizeBankName(input.bankName),
    bank_account_number: sanitizeBankAccountNumber(input.bankAccountNumber),
    bank_account_holder: sanitizeBankAccountHolder(input.bankAccountHolder),
  };

  if (hasInput) {
    if (!provided.bank_name) {
      throw new AppError('Vui lòng nhập tên ngân hàng', 400, 'VALIDATION_ERROR');
    }
    const matchedBank = findMatchingBank(provided.bank_name);
    if (!matchedBank) {
      throw new AppError('Tên ngân hàng không tồn tại trong hệ thống ngân hàng Việt Nam', 400, 'VALIDATION_ERROR');
    }
    // Chuẩn hóa về tên viết tắt chính thức (VD: VCB -> VIETCOMBANK)
    provided.bank_name = matchedBank.shortName;

    if (!provided.bank_account_number || !ACCOUNT_NUMBER_PATTERN.test(provided.bank_account_number)) {
      throw new AppError('Số tài khoản không hợp lệ (6-19 chữ số)', 400, 'VALIDATION_ERROR');
    }
    if (!provided.bank_account_holder) {
      throw new AppError('Vui lòng nhập tên chủ tài khoản', 400, 'VALIDATION_ERROR');
    }
    if (!ACCOUNT_HOLDER_PATTERN.test(provided.bank_account_holder)) {
      throw new AppError('Tên chủ tài khoản phải là chữ cái không dấu, từ 2 đến 50 ký tự', 400, 'VALIDATION_ERROR');
    }
    return { values: provided, shouldPersist: true };
  }

  const saved = {
    bank_name: sanitizeBankName(user?.bank_name),
    bank_account_number: sanitizeBankAccountNumber(user?.bank_account_number),
    bank_account_holder: sanitizeBankAccountHolder(user?.bank_account_holder),
  };

  const isSavedValid =
    saved.bank_name.length >= BANK_NAME_MIN &&
    saved.bank_name.length <= BANK_NAME_MAX &&
    ACCOUNT_NUMBER_PATTERN.test(saved.bank_account_number) &&
    ACCOUNT_HOLDER_PATTERN.test(saved.bank_account_holder);

  if (isSavedValid) {
    return { values: saved, shouldPersist: false };
  }

  throw new AppError(
    'Vui lòng nhập thông tin nhận hoàn tiền (tên ngân hàng, số tài khoản, tên chủ tài khoản)',
    400,
    'BANK_INFO_REQUIRED',
  );
};

/** STK đã lưu trong hồ sơ có đủ 3 trường hợp lệ chưa — FE seed sẵn form hủy để khỏi gõ lại. */
export const hasCompleteBankInfo = (user) => {
  const bName = sanitizeBankName(user?.bank_name);
  const bNumber = sanitizeBankAccountNumber(user?.bank_account_number);
  const bHolder = sanitizeBankAccountHolder(user?.bank_account_holder);
  return (
    bName.length >= BANK_NAME_MIN &&
    bName.length <= BANK_NAME_MAX &&
    ACCOUNT_NUMBER_PATTERN.test(bNumber) &&
    ACCOUNT_HOLDER_PATTERN.test(bHolder)
  );
};

