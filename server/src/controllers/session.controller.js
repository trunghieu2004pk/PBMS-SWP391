import * as sessionService from '../services/session.service.js';
import { asyncHandler, successResponse, AppError } from '../utils/helpers.js';

export const listActive = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listActiveSessions(req.query);
  successResponse(res, sessions);
});

export const listMineActive = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listMyActiveSessions(req.user.user_id);
  successResponse(res, sessions);
});

export const staffLookupByQr = asyncHandler(async (req, res) => {
  const session = await sessionService.staffLookupSessionByQr(req.query.qrToken);
  successResponse(res, session);
});

export const get = asyncHandler(async (req, res) => {
  const session = await sessionService.getSession(req.params.id);
  const role = req.user.role?.role_name;
  const isStaff = role === 'Staff' || role === 'Manager' || role === 'Admin';
  const isOwner = session.user_id && session.user_id === req.user.user_id;
  if (!isStaff && !isOwner) {
    throw new AppError('Not allowed', 403, 'FORBIDDEN');
  }
  successResponse(res, session);
});

export const checkin = asyncHandler(async (req, res) => {
  const session = await sessionService.checkin(req.user.user_id, req.body);
  successResponse(res, session, 'Check-in successful', 201);
});

export const checkout = asyncHandler(async (req, res) => {
  const result = await sessionService.checkout(req.user.user_id, req.body);
  const message = result.barrierOpened
    ? result.passCovered
      ? 'Monthly pass checkout — barrier opened (no payment)'
      : result.freeCheckout
        ? 'Free check-out completed — barrier opened'
        : 'Check-out completed — barrier opened'
    : 'Payment required — complete payment to open barrier';
  successResponse(res, result, message);
});

export const cashCheckout = asyncHandler(async (req, res) => {
  const result = await sessionService.cashCheckout(req.user.user_id, req.body);
  successResponse(res, result, 'Cash check-out completed — barrier opened');
});

export const previewFee = asyncHandler(async (req, res) => {
  const result = await sessionService.previewCheckoutFee(req.body);
  successResponse(res, result, 'Fee preview');
});

export const resolveCheckinQr = asyncHandler(async (req, res) => {
  const info = await sessionService.resolveCheckinQr(req.query.qrToken);
  successResponse(res, info, `Nhận diện: ${info.label}`);
});

export const identifyPlate = asyncHandler(async (req, res) => {
  const info = await sessionService.identifyPlateForCheckin(req.query.plateNumber);
  successResponse(res, info, info ? `Nhận diện: ${info.label}` : 'Khách vãng lai');
});

export const cancelEntry = asyncHandler(async (req, res) => {
  const session = await sessionService.cancelEntryBeforeGate(
    req.user.user_id,
    req.params.id,
    req.body.reason,
  );
  successResponse(res, session, 'Đã hủy phiên — chỗ đỗ đã được trả lại');
});

export const correctPlate = asyncHandler(async (req, res) => {
  const session = await sessionService.correctSessionPlate(
    req.user.user_id,
    req.params.id,
    req.body.plateNumber,
  );
  successResponse(res, session, 'Plate number corrected');
});

export const updateCheckoutOptions = asyncHandler(async (req, res) => {
  const session = await sessionService.updateCheckoutOptions(req.params.id, req.body);
  successResponse(res, session, 'Checkout options updated');
});
