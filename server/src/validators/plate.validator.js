import { body } from 'express-validator';
import { validateAndNormalizePlateVN } from '../utils/plateVN.js';

const plateCustom = (value, { req }, field) => {
  const result = validateAndNormalizePlateVN(value);
  if (!result.valid) {
    // "Gõ liền không dấu" đọc được cả ô tô lẫn xe máy (51A12345). Nếu request có kèm
    // vehicleTypeId thì KHÔNG chặn ở đây — service sẽ gỡ mơ hồ bằng chính loại xe đó
    // (nó cần tra DB để đổi id → nhóm biển, việc mà validator không nên làm).
    if (result.ambiguous && req.body?.vehicleTypeId) return true;
    throw new Error(result.error);
  }
  req.body[field] = result.normalized;
  return true;
};

export const requiredPlateNumber = (field = 'plateNumber') =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('Biển số xe không được để trống')
    .custom((value, meta) => plateCustom(value, meta, field));

export const optionalPlateNumber = (field = 'plateNumber') =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .custom((value, meta) => {
      if (!value) return true;
      return plateCustom(value, meta, field);
    });
