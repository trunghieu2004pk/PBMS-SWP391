import { validateAndNormalizePlateVN } from './plate.js';
import { isValidBankName } from './vietnamBanks.js';

/** Gộp nhiều object lỗi { field: message } thành một. */
export function mergeErrors(...maps) {
  return Object.assign({}, ...maps.filter(Boolean));
}

/** Trả lỗi nếu chuỗi rỗng sau khi trim. */
export function validateRequiredText(value, field, label) {
  const trimmed = (value || '').trim();
  if (!trimmed) return { [field]: `Vui lòng nhập ${label}` };
  return {};
}

/** Trả lỗi nếu giá trị rỗng (dùng cho select/dropdown). */
export function validateRequired(value, field, label) {
  if (value === '' || value === null || value === undefined) {
    return { [field]: `Vui lòng chọn ${label}` };
  }
  return {};
}

/** Số không âm; required=false thì cho phép bỏ trống. */
export function validateNonNegativeNumber(value, field, { required = true } = {}) {
  if (value === '' || value === null || value === undefined) {
    return required ? { [field]: 'Vui lòng nhập số' } : {};
  }
  const n = Number(value);
  if (Number.isNaN(n)) return { [field]: 'Phải là số hợp lệ' };
  if (n < 0) return { [field]: 'Không được âm' };
  return {};
}

/**
 * Biển số xe: bắt buộc + đúng định dạng VN (mirror plate.validator.js của BE).
 * Chặn tại chỗ để khách không gửi form rồi mới nhận lỗi định dạng từ server.
 */
export function validatePlateNumber(value, field = 'plateNumber') {
  const result = validateAndNormalizePlateVN(value);
  return result.valid ? {} : { [field]: result.error };
}

/**
 * Validate form tầng: bắt buộc mã tầng, tên hiển thị, cấp tầng.
 * Chế độ single (1 loại xe cho cả tầng) bắt buộc thêm loại xe + diện tích tầng > 0.
 * requireVehicleType=false khi đang ĐỔI chế độ zoned→single: BE tự lấy loại xe của khu duy nhất.
 */
export function validateFloorForm(form, { requireVehicleType = true } = {}) {
  const errors = mergeErrors(
    validateRequiredText(form.floorCode, 'floorCode', 'mã tầng'),
    validateRequiredText(form.label, 'label', 'tên hiển thị'),
  );
  if (form.floorLevel === '' || form.floorLevel == null) {
    errors.floorLevel = 'Vui lòng nhập cấp tầng';
  }
  if (form.layoutMode === 'single') {
    if (requireVehicleType && !form.vehicleTypeId) {
      errors.vehicleTypeId = 'Tầng 1 loại xe cần chọn loại xe';
    }
    const area = Number(form.areaM2);
    if (form.areaM2 === '' || form.areaM2 == null || Number.isNaN(area) || area <= 0) {
      errors.areaM2 = 'Tầng 1 loại xe cần diện tích tầng (m²) > 0';
    }
  }
  return errors;
}

/** Validate quy tắc giá: loại xe, đơn vị (phút), đơn giá, thời điểm hiệu lực. */
export function validatePricingRuleForm(form) {
  const errors = mergeErrors(
    validateRequired(form.vehicleTypeId, 'vehicleTypeId', 'loại xe'),
    validateNonNegativeNumber(form.unit, 'unit'),
    validateNonNegativeNumber(form.baseRate, 'baseRate'),
  );
  if (!form.effectiveFrom) errors.effectiveFrom = 'Vui lòng chọn thời điểm bắt đầu';
  if (form.effectiveFrom && form.effectiveTo && new Date(form.effectiveFrom) > new Date(form.effectiveTo)) {
    errors.effectiveTo = 'Thời điểm kết thúc phải sau bắt đầu';
  }
  return errors;
}

/** Validate form loại xe: bắt buộc tên + mã, diện tích 1 chỗ (m²) số ≥ 0 tùy chọn. */
export function validateVehicleTypeForm(form) {
  return mergeErrors(
    validateRequiredText(form.typeName, 'typeName', 'tên loại xe'),
    validateRequiredText(form.typeCode, 'typeCode', 'mã loại xe'),
    validateNonNegativeNumber(form.slotAreaM2, 'slotAreaM2', { required: false }),
  );
}

/**
 * Validate form chỗ đỗ (parking_slot): khu (bắt buộc). Mã chỗ do BE tự sinh nên không validate.
 * Khoảng cách tới cổng (tùy chọn, số ≥ 0).
 */
export function validateSlotForm(form) {
  return mergeErrors(
    validateRequired(form.zoneId, 'zoneId', 'khu vực'),
    form.distanceToGate !== '' && form.distanceToGate != null
      ? validateNonNegativeNumber(form.distanceToGate, 'distanceToGate', { required: false })
      : {},
  );
}

/** Validate form khu vực (zone): tầng, loại xe, tên, số slot. Mã khu do BE tự sinh nên không validate. */
export function validateZoneForm(form) {
  return mergeErrors(
    validateRequired(form.floorId, 'floorId', 'tầng'),
    validateRequired(form.vehicleTypeId, 'vehicleTypeId', 'loại xe'),
    validateRequiredText(form.label, 'label', 'tên khu'),
    validateNonNegativeNumber(form.totalSlots, 'totalSlots'),
    form.monthlyPassCapacity !== '' && form.monthlyPassCapacity != null
      ? validateNonNegativeNumber(form.monthlyPassCapacity, 'monthlyPassCapacity', { required: false })
      : {},
  );
}

/**
 * Validate form cổng (gate): phạm vi + hướng bắt buộc. Mã cổng do FE tự sinh từ
 * mã tầng/hướng/loại xe (lib/gateCode.js) nên chỉ kiểm nó dựng được và không trùng —
 * `codeConflict` là câu báo trùng do trang truyền vào sau khi đối chiếu danh sách cổng.
 */
export function validateGateForm(form, { codeConflict = '' } = {}) {
  const errors = mergeErrors(
    validateRequired(form.floorId, 'floorId', 'phạm vi (tầng hoặc cấp tòa nhà)'),
    validateRequired(form.direction, 'direction', 'hướng cổng'),
  );
  if (!errors.floorId && !errors.direction) {
    if (!form.gateCode) errors.gateCode = 'Chưa dựng được mã cổng — kiểm tra lại phạm vi và hướng';
    else if (codeConflict) errors.gateCode = codeConflict;
  }
  return errors;
}

/** Validate form check-in (Staff): biển số, loại xe, tầng. Cổng do BE tự suy (optional). */
export function validateCheckinForm(form) {
  return mergeErrors(
    validatePlateNumber(form.plateNumber),
    validateRequired(form.vehicleTypeId, 'vehicleTypeId', 'loại xe'),
    validateRequired(form.floorId, 'floorId', 'tầng'),
  );
}

/**
 * Tài khoản nhận hoàn tiền ở form HỦY có hoàn (đặt chỗ đã trả phí / vé tháng còn % hoàn).
 * Mirror server/src/utils/bankInfo.js — lệch luật là FE chặn oan hoặc cho gửi rồi BE mới báo lỗi.
 */
export const BANK_ACCOUNT_NUMBER_PATTERN = /^\d{6,19}$/;
export const BANK_ACCOUNT_HOLDER_PATTERN = /^[A-Z\s]{2,50}$/;
export const BANK_NAME_PATTERN = /^[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ\s]{2,50}$/u;

export function removeVietnameseTones(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function sanitizeBankName(val) {
  if (val == null) return '';
  return String(val)
    .toUpperCase()
    .replace(/[^A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeBankAccountNumber(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').slice(0, 19);
}

export function sanitizeBankAccountHolder(val) {
  if (val == null) return '';
  const noTones = removeVietnameseTones(String(val)).toUpperCase();
  return noTones
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateBankInfo(form) {
  const errors = {};
  const bankName = sanitizeBankName(form.bankName);
  const number = sanitizeBankAccountNumber(form.bankAccountNumber);
  const holder = sanitizeBankAccountHolder(form.bankAccountHolder);

  if (!bankName) errors.bankName = 'Vui lòng nhập tên ngân hàng';
  else if (!BANK_NAME_PATTERN.test(bankName) || !isValidBankName(bankName)) {
    errors.bankName = 'Tên ngân hàng không tồn tại trong hệ thống ngân hàng Việt Nam. Vui lòng chọn từ danh sách gợi ý.';
  }

  if (!number) errors.bankAccountNumber = 'Vui lòng nhập số tài khoản';
  else if (!BANK_ACCOUNT_NUMBER_PATTERN.test(number)) {
    errors.bankAccountNumber = 'Số tài khoản không hợp lệ (6-19 chữ số)';
  }

  if (!holder) errors.bankAccountHolder = 'Vui lòng nhập tên chủ tài khoản';
  else if (!BANK_ACCOUNT_HOLDER_PATTERN.test(holder)) {
    errors.bankAccountHolder = 'Tên chủ tài khoản phải là chữ cái không dấu, từ 2 đến 50 ký tự';
  }

  return errors;
}

