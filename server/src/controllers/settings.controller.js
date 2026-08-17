import { asyncHandler, successResponse } from "../utils/helpers.js";
import * as settingsService from "../services/settings.service.js";
import {
  SYSTEM_FIELD_KEYS,
  AI_FIELD_KEYS,
} from "../validators/settings.validator.js";

// --- API lấy System Settings (Cũ của bạn) ---
export const getSystem = asyncHandler(async (req, res) => {
  successResponse(
    res,
    settingsService.getSystemSettings(),
    "Cấu hình hệ thống",
  );
});

// --- API cập nhật System Settings (Cũ của bạn) ---
export const updateSystem = asyncHandler(async (req, res) => {
  const patch = {};
  for (const key of SYSTEM_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      patch[key] = req.body[key];
    }
  }
  const updated = await settingsService.updateSystemSettings(patch);
  successResponse(res, updated, "Đã cập nhật cấu hình hệ thống");
});

// --- API cập nhật AI Settings (MỚI ĐÃ SỬA) ---
export const updateAiConfig = asyncHandler(async (req, res) => {
  const patch = {};

  // Chỉ nhặt các key liên quan đến AI (whitelist)
  for (const key of AI_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      patch[key] = req.body[key];
    }
  }

  // Tái sử dụng service updateSystemSettings vì AI config cũng nằm trong cột system_config
  const updated = await settingsService.updateSystemSettings(patch);

  // Trả về response chuẩn form
  successResponse(res, updated, "Cập nhật cấu hình AI thành công");
});
