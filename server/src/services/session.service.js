import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import {
  ParkingSession,
  VehicleType,
  MonthlyPass,
  Reservation,
  Payment,
  Incident,
} from '../models/index.js';
import { AppError } from '../utils/helpers.js';
import { generateQrToken } from '../utils/qr.js';
import { suggestSlot, lockSlotOccupied, releaseSlot } from '../utils/slotSuggest.js';
import { calculateParkingFee, calculateFeeForMinutes, getEffectivePricingRule } from '../utils/feeCalc.js';
import { billableMinutesUnderPass, isWithinPassWindow } from '../utils/passWindow.js';
import { logSuggestion } from './aiLog.service.js';
import {
  validateAndNormalizePlateVN,
  plateMatchesVehicleType,
  MOTORBIKE_TYPE_CODES,
} from '../utils/plateVN.js';
import { assertBuildingOpenForCheckIn } from '../utils/buildingHours.js';
import { resolveFloorGate } from '../utils/gateResolve.js';
import { getMaxParkingHours, getLostTicketFee, getOverstayFee } from '../utils/settings.js';
import {
  assertSessionActive,
  assertReservationTransition,
  buildRevokedQrToken,
} from '../utils/stateGuards.js';
import { createIncident } from './incident.service.js';
import { logAdminAction } from '../utils/auditLog.js';
import { parsePagination, paginatedResult } from '../utils/pagination.js';

const sessionIncludes = [
  { association: 'slot', include: [{ association: 'zone', include: [{ association: 'floor' }] }] },
  { association: 'gate', include: [{ association: 'floor' }] },
  { association: 'vehicleType' },
  { association: 'monthlyPass' },
  { association: 'reservation', attributes: ['reservation_id', 'status', 'start_time', 'end_time'] },
  { association: 'checkInStaff', attributes: ['user_id', 'full_name', 'username'] },
  { association: 'checkOutStaff', attributes: ['user_id', 'full_name', 'username'] },
];

const normalizePlate = (plate, preferCategory = null) => {
  const result = validateAndNormalizePlateVN(plate, preferCategory);
  if (!result.valid) throw new AppError(result.error, 400, 'VALIDATION_ERROR');
  return result.normalized;
};

/**
 * Loại xe caller đã chọn → nhóm biển, để gỡ nhập nhằng "gõ liền không dấu" (51A12345 đọc được
 * cả ô tô lẫn xe máy). Phải khớp với cách FE gỡ, không thì hai bên ra hai biển khác nhau.
 */
const preferCategoryOf = async (vehicleTypeId) => {
  if (!vehicleTypeId) return null;
  const vt = await VehicleType.findByPk(vehicleTypeId);
  if (!vt) return null;
  return MOTORBIKE_TYPE_CODES.includes(vt.type_code) ? 'motorbike' : 'car';
};

export const listActiveSessions = async (query = {}) => {
  const pagination = parsePagination(query);
  const limit = Math.min(200, Math.max(pagination.limit, Number(query.limit) || 200));
  const total = await ParkingSession.count({ where: { status: 'active' } });
  const rows = await ParkingSession.findAll({
    where: { status: 'active' },
    include: sessionIncludes,
    order: [['time_in', 'DESC']],
    limit,
    offset: pagination.offset,
  });
  const items = await Promise.all(rows.map(enrichActiveSessionForStaff));
  return paginatedResult(items, total, pagination.page, limit);
};

/** Gắn cảnh báo cho staff: LỐ GIỜ (đỗ quá ngưỡng) + booking confirmed chưa liên kết */
const enrichActiveSessionForStaff = async (session) => {
  const row = session.toJSON();

  // Cảnh báo LỐ GIỜ. Walk-in: vượt ngưỡng chung max_parking_hours (Manager set).
  // Đặt chỗ: vượt end_time của ĐƠN (ngưỡng riêng từng đơn). Vé tháng: khung riêng, monthly lo.
  const maxHours = getMaxParkingHours();
  const isWalkIn = ['walk_in', 'auto_registered'].includes(row.session_type);
  row.overstay = false;
  row.overstayHours = 0;
  row.overstayReason = null;

  if (maxHours != null && isWalkIn && row.time_in) {
    const parkedHours = (Date.now() - new Date(row.time_in).getTime()) / (1000 * 60 * 60);
    if (parkedHours > maxHours) {
      row.overstay = true;
      row.overstayHours = Math.floor(parkedHours - maxHours);
      row.overstayReason = 'walk_in_max_hours';
    }
  } else if (row.reservation_id) {
    const resv = await detectReservationOverstay(session, new Date());
    if (resv.overstay) {
      row.overstay = true;
      row.overstayHours = resv.overstayHours;
      row.overstayReason = 'reservation_window';
    }
  } else if (row.pass_id && row.monthlyPass && row.time_in) {
    // Vé tháng cũng lố được: đỗ sang phần giờ ngoài khung ghi trên vé. Cảnh báo ngay ở bảng
    // để staff gọi khách ra lấy xe trước khi phát sinh tiền, chứ không đợi tới lúc thu.
    const billable = billableMinutesUnderPass(row.monthlyPass, row.time_in, new Date());
    if (billable > 0) {
      row.overstay = true;
      row.overstayHours = Math.floor(billable / 60);
      row.overstayReason = 'pass_window';
    }
  }

  if (row.reservation_id || row.reservation?.status) return row;
  if (!['walk_in', 'auto_registered'].includes(row.session_type)) return row;

  const openBooking = await Reservation.findOne({
    where: {
      plate_number: row.plate_number,
      status: 'confirmed',
    },
    attributes: ['reservation_id', 'status', 'start_time', 'end_time'],
    order: [['start_time', 'ASC']],
  });
  if (openBooking) {
    row.unlinkedReservation = openBooking.toJSON();
  }
  return row;
};

/**
 * Staff — quét MÃ QR của khách ở quầy CHECK-IN, trả về thông tin để điền sẵn ô nhập.
 *
 * Khách mua đặt chỗ / vé tháng online gần như luôn cầm sẵn mã QR trên điện thoại, nên bắt
 * họ đọc biển số cho nhân viên gõ là bước thừa và dễ gõ sai. Quét xong FE điền sẵn biển số,
 * loại xe, tầng — nhân viên chỉ việc bấm Check-in, rồi đi tiếp ĐÚNG luồng check-in chung
 * (tự nhận diện diện khách + mở màn nhập ảnh).
 *
 * KHÔNG tự check-in luôn ở đây: nhân viên cần nhìn thấy thông tin để đối chiếu với chiếc xe
 * trước mặt trước khi xác nhận.
 */
export const resolveCheckinQr = async (qrToken) => {
  const token = String(qrToken || '').trim();
  if (!token || token.startsWith('revoked-')) {
    throw new AppError('Mã QR không hợp lệ hoặc đã bị thu hồi', 400, 'VALIDATION_ERROR');
  }

  // Đơn đặt chỗ — chỉ nhận đơn đã thanh toán và đang trong khung giờ.
  const reservation = await Reservation.findOne({ where: { qr_token: token } });
  if (reservation) {
    // Mỗi trạng thái là một tình huống ở quầy khác hẳn nhau và cách xử lý cũng khác. In tên
    // trạng thái thô ra ('checked_in', 'no_show') thì nhân viên không biết phải làm gì tiếp.
    if (reservation.status !== 'confirmed') {
      const why = {
        pending: 'Đơn này chưa thanh toán — khách cần trả phí giữ chỗ trên app trước.',
        checked_in: 'Xe của đơn này ĐÃ vào bãi rồi. Nếu là xe khác thì kiểm tra lại mã QR; nếu khách muốn ra thì dùng tab "Thu tiền mặt xe ra".',
        completed: 'Đơn này đã dùng xong (xe đã vào và ra khỏi bãi). Khách muốn gửi tiếp thì đặt đơn mới, hoặc cho vào diện khách vãng lai.',
        cancelled: 'Đơn này đã bị hủy nên không dùng để vào bãi được.',
        no_show: 'Đơn này đã quá giờ giữ chỗ và bị hủy tự động (khách không tới). Cho vào diện khách vãng lai nếu bãi còn chỗ.',
      }[reservation.status] || `Đơn đặt chỗ không dùng được (trạng thái: ${reservation.status}).`;
      throw new AppError(why, 409, 'CONFLICT');
    }
    return {
      kind: 'reservation',
      label: 'Đặt chỗ qua app',
      plateNumber: reservation.plate_number,
      vehicleTypeId: reservation.vehicle_type_id,
      floorId: reservation.floor_id,
      window: { startTime: reservation.start_time, endTime: reservation.end_time },
    };
  }

  // Vé tháng — chỉ nhận vé còn hiệu lực.
  const { MonthlyPass } = await import('../models/index.js');
  const pass = await MonthlyPass.findOne({ where: { qr_token: token } });
  if (pass) {
    if (pass.status !== 'active') {
      throw new AppError(`Vé tháng không còn hiệu lực (${pass.status})`, 409, 'CONFLICT');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (today < String(pass.start_date) || today > String(pass.end_date)) {
      throw new AppError('Vé tháng ngoài thời hạn sử dụng', 409, 'CONFLICT');
    }
    return {
      kind: 'pass',
      label: 'Vé tháng',
      plateNumber: pass.plate_number,
      vehicleTypeId: pass.vehicle_type_id,
      floorId: pass.floor_id,
      window: { startDate: pass.start_date, endDate: pass.end_date },
    };
  }

  throw new AppError(
    'Không tìm thấy đặt chỗ hay vé tháng nào theo mã QR này. Nếu là khách vãng lai, nhập biển số.',
    404,
    'NOT_FOUND',
  );
};

/**
 * Staff GÕ TAY biển số ở quầy — nhận diện xem biển đó có đặt chỗ / vé tháng không.
 *
 * Cùng hình dạng trả về với resolveCheckinQr để màn check-in dùng chung một khối hiển thị.
 * Vì sao cần: quét QR thì form tự điền tầng và loại xe, còn gõ tay thì form IM LẶNG — nhân
 * viên phải tự nhớ vé tháng của xe đó nằm tầng nào. Nhớ sai là check-in fail. Máy đã biết sẵn
 * thì phải nói ra trước khi bấm, chứ không để bấm xong mới báo lỗi.
 *
 * KHÔNG ném lỗi khi không khớp gì: biển lạ = khách vãng lai, đó là trường hợp bình thường
 * nhất chứ không phải sự cố. Trả null để FE giữ nguyên ô chọn tầng cho nhân viên tự điền.
 */
export const identifyPlateForCheckin = async (plateNumber) => {
  const normalized = normalizePlate(plateNumber);
  const now = new Date();

  const reservation = await findConfirmedReservationForPlate(normalized, now);
  if (reservation) {
    return {
      kind: 'reservation',
      label: 'Đặt chỗ qua app',
      plateNumber: reservation.plate_number,
      vehicleTypeId: reservation.vehicle_type_id,
      floorId: reservation.floor_id,
      window: { startTime: reservation.start_time, endTime: reservation.end_time },
    };
  }

  const { findActivePassByPlate } = await import('./monthlyPass.service.js');
  const pass = await findActivePassByPlate(normalized);
  if (pass) {
    return {
      kind: 'pass',
      label: 'Vé tháng',
      plateNumber: pass.plate_number,
      vehicleTypeId: pass.vehicle_type_id,
      floorId: pass.floor_id,
      window: { startDate: pass.start_date, endDate: pass.end_date },
    };
  }

  return null;
};

/** Staff — tra cứu phiên active từ QR ra cổng */
export const staffLookupSessionByQr = async (qrToken) => {
  const token = String(qrToken || '').trim();
  if (!token || token.startsWith('revoked-')) {
    throw new AppError('Mã QR không hợp lệ hoặc đã vô hiệu', 400, 'VALIDATION_ERROR');
  }
  const session = await ParkingSession.findOne({
    where: { qr_token: token, status: 'active' },
    include: sessionIncludes,
  });
  if (!session) {
    throw new AppError('Không tìm thấy phiên đang gửi với mã QR này', 404, 'NOT_FOUND');
  }
  return session;
};

export const listMyActiveSessions = async (userId) => {
  const sessions = await ParkingSession.findAll({
    where: { user_id: userId, status: 'active' },
    include: sessionIncludes,
    order: [['time_in', 'DESC']],
  });

  return Promise.all(
    sessions.map(async (session) => {
      const base = session.toJSON();
      try {
        const preview = await previewCheckoutFee({ sessionId: session.session_id });
        return {
          ...base,
          estimatedFee: preview.fee,
          passCovered: preview.passCovered,
          pricingRule: preview.pricingRule,
          overstay: preview.overstay,
        };
      } catch {
        return {
          ...base,
          estimatedFee: null,
          passCovered: false,
          pricingRule: null,
          overstay: false,
        };
      }
    }),
  );
};

export const getSession = async (id) => {
  const session = await ParkingSession.findByPk(id, { include: sessionIncludes });
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
  return session;
};

const findActiveByPlate = async (plateNumber) =>
  ParkingSession.findOne({
    where: { plate_number: normalizePlate(plateNumber), status: 'active' },
  });

/** Kết thúc phiên active (hủy đặt chỗ / đồng bộ trạng thái) — không thu phí */
export const voidActiveSession = async (session, transaction) => {
  if (!session || session.status !== 'active') return false;

  const locked = await ParkingSession.findByPk(session.session_id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!locked || locked.status !== 'active') return false;

  await releaseSlot(locked.slot_id, transaction);
  await locked.update(
    {
      time_out: new Date(),
      status: 'exception',
      calculated_fee: 0,
      qr_token: buildRevokedQrToken('session', locked.session_id),
    },
    { transaction },
  );
  return true;
};

/**
 * Hủy phiên CHƯA VÀO BÃI (staff) — lối thoát cho "phiên ma".
 *
 * Vì sao cần: check-in ở booth tạo phiên + chiếm slot NGAY, nhưng xe chỉ thực sự vào khi
 * qua cổng tòa. Nếu khâu sau đó hỏng (chụp ảnh lỗi, khách đổi ý, nhập nhầm biển) thì phiên
 * nằm lại mãi: slot bị giữ, biển số bị khóa (check-in lại báo "xe đã có trong bãi"), và
 * trước đây KHÔNG có cách nào gỡ ngoài sửa thẳng DB.
 *
 * CHỈ cho hủy khi gate_stage='checked_in' — tức xe chưa qua cổng tòa, chưa hề vào bãi.
 * Đã vào rồi thì phải cho ra bằng luồng checkout bình thường, không được xóa dấu vết.
 */
export const cancelEntryBeforeGate = async (staffUserId, sessionId, reason) => {
  const session = await ParkingSession.findByPk(Number(sessionId));
  if (!session) throw new AppError('Không tìm thấy phiên', 404, 'NOT_FOUND');
  if (session.status !== 'active') {
    throw new AppError('Phiên không còn mở — không cần hủy', 409, 'CONFLICT');
  }
  if (session.gate_stage !== 'checked_in') {
    throw new AppError(
      'Xe đã qua cổng vào bãi — phải cho ra bằng luồng xe ra, không hủy được.',
      409,
      'ALREADY_PARKED',
    );
  }

  const plate = session.plate_number;
  await sequelize.transaction(async (transaction) => {
    await voidActiveSession(session, transaction);

    // Trả ĐƠN ĐẶT CHỖ về 'confirmed' để khách dùng lại được.
    //
    // Hủy phiên chỉ nhả chỗ đỗ và đóng phiên; đơn thì vẫn nằm ở 'checked_in' = "đã dùng rồi".
    // Hậu quả: QR của khách báo "đơn không dùng được", gõ biển số thì ra khách VÃNG LAI —
    // khách trả tiền giữ chỗ xong mất suất và bị tính tiền như người không đặt. Xe chưa hề
    // qua cổng (hàm này chỉ chạy khi gate_stage='checked_in') nên đơn coi như chưa dùng.
    if (session.reservation_id) {
      const reservation = await Reservation.findByPk(session.reservation_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (reservation?.status === 'checked_in') {
        assertReservationTransition(reservation.status, 'confirmed');
        // slot_id chỉ được gán lúc check-in (mô hình sức chứa) → nhả luôn cho lần sau gán mới.
        await reservation.update({ status: 'confirmed', slot_id: null }, { transaction });
      }
    }
  });

  // Ghi nhật ký admin thay vì tạo sự cố: hủy phiên là thao tác nghiệp vụ có chủ ý
  // (khách đổi ý, chụp ảnh hỏng...), không phải sự cố cần quản lý ở trang Sự cố.
  // → Xuất hiện ở trang Nhật ký Admin bên Admin.
  await logAdminAction(staffUserId, 'cancel_entry', {
    sessionId: session.session_id,
    plate: plate,
    slotId: session.slot_id,
    reason: reason || 'không ghi',
    detail: `Hủy phiên chưa vào bãi — biển ${plate}. Lý do: ${reason || 'không ghi'}`,
  });

  return getSession(session.session_id);
};

/**
 * Chặn cho xe RA khi xe CHƯA TỪNG VÀO BÃI.
 *
 * Phiên còn ở 'checked_in' nghĩa là nhân viên mới ghi nhận ở quầy, xe vẫn đứng ngoài, chưa
 * qua cổng vào tòa. Cho "xe ra" ở trạng thái này là sai hai chuyện cùng lúc:
 *   1. THU TIỀN của khách chưa hề gửi xe;
 *   2. gate_stage nhảy thẳng 'checked_in' -> 'exited', bỏ qua cả máy trạng thái, nên số liệu
 *      lưu lượng và mốc chốt phí đều vô nghĩa.
 *
 * Cổng kiosk đã chặn đúng từ đầu (buildingExit ném NOT_IN_BUILDING), nhưng đường thu tiền ở
 * QUẦY thì trước đây không kiểm — thành một lối tắt vòng qua toàn bộ máy trạng thái.
 * Việc đúng trong tình huống này là HỦY PHIÊN (không thu tiền), không phải cho xe ra.
 */
export const assertVehicleHasEntered = (session) => {
  if (session?.gate_stage === 'checked_in') {
    throw new AppError(
      'Xe chưa qua cổng vào bãi nên không thu tiền được. '
        + 'Nếu khách đổi ý không gửi nữa, dùng "Hủy phiên" để trả lại chỗ đỗ.',
      409,
      'NOT_IN_BUILDING',
    );
  }
};

export const hasActiveSessionForPlate = async (plateNumber) => {
  const session = await findActiveByPlate(plateNumber);
  return Boolean(session);
};

// Ân hạn VÀO SỚM đã BỎ (=0): đơn chỉ nhận check-in từ ĐÚNG start_time (khớp lúc job khóa-đầu-ca).
// Khách đến sớm hơn vẫn bị WALKIN_BLOCK_BEFORE_RESERVATION_MS chặn walk-in (hướng sang tab "Đặt chỗ vào").
// (SRS BR-31 để 15' — đây là LỆCH SRS có chủ đích, cần cập nhật tài liệu.)
const CHECKIN_EARLY_GRACE_MS = 0;
// Đơn confirmed bắt đầu trong vòng ngưỡng này → coi khách là "đến sớm cho đơn", chặn walk-in.
const WALKIN_BLOCK_BEFORE_RESERVATION_MS = 60 * 60 * 1000;

const findConfirmedReservationForPlate = async (plateNumber, at = new Date()) =>
  Reservation.findOne({
    where: {
      plate_number: plateNumber,
      status: 'confirmed',
      start_time: { [Op.lte]: new Date(at.getTime() + CHECKIN_EARLY_GRACE_MS) },
      end_time: { [Op.gte]: at },
    },
    order: [['start_time', 'ASC']],
  });

export const checkin = async (staffUserId, data) => {
  const plateNumber = normalizePlate(data.plateNumber, await preferCategoryOf(data.vehicleTypeId));

  const existing = await findActiveByPlate(plateNumber);
  if (existing) {
    throw new AppError('Vehicle already has an active session', 409, 'CONFLICT');
  }

  const now = new Date();
  const matchingReservation = await findConfirmedReservationForPlate(plateNumber, now);
  if (matchingReservation) {
    // TẦNG và LOẠI XE đã nằm sẵn trong đơn đặt chỗ — lấy thẳng từ đó, không bắt nhân viên
    // chọn lại cho khớp. Bắt chọn lại là bắt nhớ thứ hệ thống đã biết: chọn lệch một cái là
    // check-in fail, trong khi đơn của khách vẫn ghi rõ ràng tầng nào.
    const { checkinReservation } = await import('./reservation.service.js');
    const result = await checkinReservation(staffUserId, {
      reservationId: matchingReservation.reservation_id,
      // Cổng nhân viên chọn gắn với tầng nhân viên chọn. Khác tầng đơn thì bỏ, để hệ tự suy
      // cổng vào của đúng tầng đã đặt (gửi cổng lệch tầng sẽ bị chặn + ghi sự cố sai tầng).
      gateId: matchingReservation.floor_id === data.floorId ? data.gateId : undefined,
    });
    return getSession(result.session.session_id);
  }

  // Chỉ chặn khi đơn confirmed SẮP tới giờ (trong vòng 60'): khách này là khách đến sớm
  // cho đơn của họ → hướng sang tab "Đặt chỗ vào" (mở sớm tối đa 15'). Đơn còn XA hơn thì
  // cho gửi walk-in bình thường — trước đây chặn MỌI đơn tương lai, khách có đơn tuần sau
  // hôm nay không gửi xe được.
  const nearConfirmed = await Reservation.findOne({
    where: {
      plate_number: plateNumber,
      status: 'confirmed',
      start_time: {
        [Op.gt]: now,
        [Op.lte]: new Date(now.getTime() + WALKIN_BLOCK_BEFORE_RESERVATION_MS),
      },
    },
    order: [['start_time', 'ASC']],
  });
  if (nearConfirmed) {
    throw new AppError(
      `Biển ${plateNumber} có đặt chỗ lúc ${new Date(nearConfirmed.start_time).toLocaleString('vi-VN')} — dùng tab "Đặt chỗ vào" (sớm tối đa 15 phút)`,
      409,
      'RESERVATION_NOT_OPEN',
    );
  }

  // === Vé tháng: nếu biển số có pass active → check-in dạng monthly_pass (calculated_fee = 0) ===
  const { findActivePassByPlate } = await import('./monthlyPass.service.js');
  let activePass = null;
  const passForPlate = await findActivePassByPlate(plateNumber);

  // Vé tháng ghi rõ tầng và loại xe. Chọn lệch thì BÁO cho nhân viên biết lệch ở đâu, KHÔNG
  // âm thầm ghi đè lựa chọn của họ — ghi đè thì nhân viên chọn B1 mà xe vào F1, không hiểu
  // vì sao. Nhanh nhất vẫn là dùng ô quét QR: nó điền sẵn đúng tầng, khỏi phải nhớ.
  //
  // KHÔNG lập phiếu sự cố "sai tầng" ở đây: đây là nhân viên bấm nhầm ô trong lúc khách còn
  // đứng ở quầy, không phải khách lái lạc tầng. Đi lạc thật thì cổng tầng bên kiosk vẫn bắt.
  if (passForPlate) {
    if (passForPlate.floor_id !== data.floorId) {
      const floorLabel = passForPlate.floor?.floor_code || passForPlate.floor?.name || passForPlate.floor_id;
      throw new AppError(
        `Xe ${plateNumber} có vé tháng ở tầng ${floorLabel} — chọn đúng tầng đó, hoặc quét mã QR của khách để hệ thống tự điền.`,
        409,
        'PASS_WRONG_FLOOR',
      );
    }
    if (passForPlate.vehicle_type_id !== data.vehicleTypeId) {
      throw new AppError(
        `Vé tháng của xe ${plateNumber} đăng ký loại xe khác — chọn đúng loại xe ghi trên vé.`,
        409,
        'PASS_VEHICLE_MISMATCH',
      );
    }
    // Trong khung giờ pass → miễn phí; ngoài khung giờ → bỏ qua, xử lý như walk-in (tính phí).
    if (isWithinPassWindow(passForPlate, now)) {
      activePass = passForPlate;
    }
  }

  // Cổng IN: nếu staff không gửi gateId, tự suy cổng vào duy nhất của tầng.
  const gate = await resolveFloorGate({
    floorId: data.floorId,
    direction: 'in',
    gateId: data.gateId,
    vehicleTypeId: data.vehicleTypeId,
  });

  const vehicleType = await VehicleType.findByPk(data.vehicleTypeId);
  if (!vehicleType) throw new AppError('Vehicle type not found', 404, 'NOT_FOUND');

  // DV-01b — walk-in: biển phải ĐÚNG LOẠI XE đã chọn (biển xe máy không check-in ô tô & ngược lại).
  // Nhánh đặt-chỗ/vé-tháng đã return sớm ở trên và khớp loại xe từ lúc đặt/mua, nên chỉ walk-in
  // (và pass ngoài khung giờ rơi xuống đây) mới cần chặn.
  const { category: plateCategory } = validateAndNormalizePlateVN(plateNumber);
  if (!plateMatchesVehicleType(plateCategory, vehicleType.type_code)) {
    throw new AppError(
      `Biển ${plateNumber} là biển ${plateCategory === 'motorbike' ? 'xe máy' : 'ô tô'} nhưng bạn chọn loại xe "${vehicleType.type_name}" — chọn đúng loại xe.`,
      400,
      'PLATE_VEHICLE_MISMATCH',
    );
  }

  assertBuildingOpenForCheckIn(now);
  const timeIn = now;

  const { slot: suggestedSlot, meta: suggestMeta } = await suggestSlot({
    floorId: data.floorId,
    vehicleTypeId: data.vehicleTypeId,
    zoneId: data.zoneId,
    // Người CÓ VÉ THÁNG vào qua quầy: miễn lớp giữ-chỗ-cho-đơn-đặt (cam kết vé đi trước);
    // walk-in thường vẫn phải chừa chỗ cho đơn sắp tới.
    skipReservationHoldback: Boolean(activePass),
    // ...và miễn luôn lớp giữ-chỗ-cho-vé-tháng. Lớp đó sinh ra để chặn WALK-IN ăn vào phần
    // để dành cho vé tháng; áp lên chính chủ vé là khóa đúng người nó phải phục vụ (OR-03).
    // Cổng kiosk đã miễn từ đầu (checkinWithPass), nhưng đường QUẦY thì chưa — mà từ khi bãi
    // bắt buộc ảnh, khách vé tháng BUỘC phải vào bằng đường quầy.
    skipPassCapacity: Boolean(activePass),
  });

  const qrToken = generateQrToken();
  const sessionType = activePass
    ? 'monthly_pass'
    : data.sessionType === 'auto_registered'
      ? 'auto_registered'
      : 'walk_in';

  const session = await sequelize.transaction(async (transaction) => {
    await lockSlotOccupied(suggestedSlot.slot_id, transaction);

    return ParkingSession.create(
      {
        user_id: activePass ? activePass.user_id : data.userId || null,
        pass_id: activePass ? activePass.pass_id : null,
        gate_id: gate.gate_id,
        slot_id: suggestedSlot.slot_id,
        vehicle_type_id: data.vehicleTypeId,
        plate_number: plateNumber,
        time_in: timeIn,
        qr_token: qrToken,
        check_in_by: staffUserId,
        session_type: sessionType,
        status: 'active',
        calculated_fee: activePass ? 0 : null,
      },
      { transaction }
    );
  });

  await logSuggestion({
    ...suggestMeta,
    sessionId: session.session_id,
    context: activePass ? 'monthly' : 'walk_in',
  });

  return getSession(session.session_id);
};

// 2 hàm dưới chỉ là CỬA sang payment.service, không chứa logic. `await import()` động là cố ý:
// payment.service import ngược lại file này → import tĩnh 2 chiều tạo vòng lặp, một bên thấy undefined.
export const checkout = async (staffUserId, data) => {
  const { initiateSessionCheckout } = await import('./payment.service.js');
  return initiateSessionCheckout(staffUserId, data);
};

export const cashCheckout = async (staffUserId, data) => {
  const { settleCashCheckout } = await import('./payment.service.js');
  return settleCashCheckout(staffUserId, data);
};

// Ân hạn lấy xe sau khi hết khung giờ đã đặt. Chủ module chốt BỎ (=0): quá end_time là tính phụ thu
// ngay từ phút đầu (đối xứng với việc bỏ ân hạn check-in sớm). No-show (job) cũng đã bỏ ân hạn qua
// booking_no_show_grace_minutes=0 — 2 núm giờ khai riêng nhưng cùng chốt = 0.
const RESERVATION_OVERSTAY_GRACE_MS = 0;

/**
 * Lố giờ của ĐẶT CHỖ — khác walk-in: ngưỡng là `end_time` của ĐƠN, không phải max_parking_hours.
 * Ở quá khung đã đặt là giữ mất chỗ của người đặt ca kế tiếp → thu phụ thu như walk-in lố giờ.
 * (Không dùng import từ reservation.service để tránh vòng lặp import — file đó đã import file này.)
 */
const detectReservationOverstay = async (session, feeEnd) => {
  const none = { overstay: false, overstayHours: 0 };
  if (!session?.reservation_id) return none;

  const reservation = await Reservation.findByPk(session.reservation_id);
  if (!reservation?.end_time) return none;

  const endTime = new Date(reservation.end_time);
  const overMs = feeEnd.getTime() - endTime.getTime();
  if (overMs <= RESERVATION_OVERSTAY_GRACE_MS) return none;

  // Số giờ tính TỪ end_time (không trừ ân hạn) — ân hạn chỉ để quyết định CÓ thu hay không.
  return { overstay: true, overstayHours: Math.floor(overMs / (1000 * 60 * 60)) };
};

/**
 * KHÁCH ĐÃ TRẢ TRƯỚC KHOẢN NÀO — để quầy thu tiền nói được ngay "cái này đã trả rồi, cái kia thì chưa".
 *
 * Hai loại khách trả trước hai thứ KHÁC HẲN nhau và rất dễ nhầm:
 *  - Đặt chỗ  : trả PHÍ GIỮ CHỖ. Là tiền giữ suất, KHÔNG phải tiền gửi xe, không trừ vào phí gửi.
 *  - Vé tháng : trả TIỀN GỬI XE cả tháng, nhưng chỉ bao phần giờ nằm trong khung ghi trên vé.
 * Không nói ra thì khách (và cả nhân viên mới) sẽ tưởng đang bị thu tiền hai lần.
 */
const describePrepaid = async (session) => {
  if (session.reservation_id) {
    const paid = await Payment.findAll({
      where: { reservation_id: session.reservation_id, status: 'success' },
      attributes: ['amount'],
    });
    const amount = paid.reduce((sum, p) => sum + Number(p.amount), 0);
    // Không có khoản nào 'success' = đơn này chưa từng trả phí giữ chỗ (đơn tạo tay, hoặc
    // thanh toán treo). Hiện "đã trả 0đ" thì đọc như bãi quên thu tiền — nói thẳng là chưa có.
    if (amount <= 0) {
      return {
        kind: 'reservation',
        state: 'missing',
        amount: null,
        label: 'Phí giữ chỗ',
        note: 'Chưa ghi nhận khoản giữ chỗ nào cho đơn này. Tiền gửi xe bên dưới vẫn thu bình thường.',
      };
    }
    return {
      kind: 'reservation',
      state: 'paid',
      amount,
      label: 'Phí giữ chỗ đã trả',
      note: 'Khoản riêng để giữ suất, không trừ vào tiền gửi xe.',
    };
  }

  if (session.pass_id) {
    const pass = await MonthlyPass.findByPk(session.pass_id);
    if (!pass) return null;
    const hhmm = (t) => String(t || '').slice(0, 5);
    const from = hhmm(pass.valid_from_time);
    const to = hhmm(pass.valid_to_time);

    // Khung giờ của vé = ảnh chụp GIỜ MỞ CỬA của bãi lúc mua. Bãi đang mở 24/7 thì khung là
    // 00:00–23:59, tức chẳng có phút nào nằm ngoài — nói "chỉ phần ngoài khung mới tính tiền"
    // lúc đó là câu đúng nhưng rỗng, chỉ tổ làm người đọc đi tìm một trường hợp không tồn tại.
    const coversWholeDay = from === '00:00' && to >= '23:59';
    return {
      kind: 'monthly_pass',
      state: 'covered',
      amount: null,
      label: 'Vé tháng đã trả trước',
      window: { from, to },
      note: coversWholeDay
        ? `Vé bao trọn ngày (bãi mở 24/7), còn hạn tới ${pass.end_date}. Hết hạn thì tính như khách vãng lai.`
        : `Vé bao khung ${from}–${to}; phần giờ đỗ ngoài khung đó mới tính tiền.`,
    };
  }

  return null;
};

/**
 * KHÔNG TÌM THẤY XE ĐANG GỬI — nói cho nhân viên biết VÌ SAO, đừng chỉ báo "không thấy".
 *
 * Ba tình huống nhìn giống hệt nhau ở quầy nhưng cách xử lý khác hẳn:
 *   1. Xe đã ra khỏi bãi rồi  → khách quay lại đòi trả tiền lần nữa, hoặc nhân viên tra nhầm.
 *   2. Vé tháng/đặt chỗ còn hiệu lực nhưng xe CHƯA vào bãi → giấy tờ hợp lệ không có nghĩa là
 *      xe đang nằm trong bãi. Nhân viên hay nhầm chỗ này nhất vì tab "Tra cứu vé tháng" hiện
 *      rõ "Đang hiệu lực".
 *   3. Gõ sai biển số.
 */
const explainNoActiveSession = async ({ plateNumber, qrToken }) => {
  if (plateNumber) {
    const normalized = normalizePlate(plateNumber);

    // Chỉ nhắc lượt vừa ra GẦN ĐÂY. Xe vé tháng ngày nào cũng gửi, lôi lượt của tuần trước ra
    // nói "đã ra rồi" thì đúng chữ nhưng sai ý — cái nhân viên cần biết là hôm nay xe chưa vào.
    const RECENT_EXIT_MS = 12 * 60 * 60 * 1000;
    const lastClosed = await ParkingSession.findOne({
      where: { plate_number: normalized, status: 'completed' },
      order: [['time_out', 'DESC']],
    });
    if (lastClosed?.time_out && Date.now() - new Date(lastClosed.time_out).getTime() < RECENT_EXIT_MS) {
      const when = new Date(lastClosed.time_out).toLocaleString('vi-VN');
      return `Xe ${normalized} ĐÃ RA khỏi bãi lúc ${when} và đã thanh toán xong. Không còn gì để thu.`;
    }

    const pass = await MonthlyPass.findOne({ where: { plate_number: normalized, status: 'active' } });
    if (pass) {
      return `Vé tháng của xe ${normalized} còn hiệu lực, nhưng xe KHÔNG có trong bãi (chưa check-in vào). Vé còn hạn không có nghĩa là xe đang gửi.`;
    }
    const resv = await Reservation.findOne({ where: { plate_number: normalized, status: 'confirmed' } });
    if (resv) {
      return `Xe ${normalized} có đơn đặt chỗ đã thanh toán, nhưng xe chưa check-in vào bãi nên chưa có gì để thu.`;
    }

    return `Không có xe nào đang gửi với biển số ${normalized}. Kiểm tra lại biển số, hoặc xe này chưa từng check-in.`;
  }

  if (qrToken) {
    const pass = await MonthlyPass.findOne({ where: { qr_token: qrToken } });
    if (pass) {
      return `Mã QR này là VÉ THÁNG của xe ${pass.plate_number}, nhưng xe không có trong bãi (chưa check-in vào).`;
    }
    const resv = await Reservation.findOne({ where: { qr_token: qrToken } });
    if (resv) {
      return `Mã QR này là đơn ĐẶT CHỖ của xe ${resv.plate_number} (${resv.status}), nhưng xe không có trong bãi.`;
    }
    return 'Mã QR không khớp lượt gửi nào đang mở. Kiểm tra lại mã, hoặc tra bằng biển số xe.';
  }

  return 'Không tìm thấy lượt gửi nào đang mở.';
};

/**
 * Xem trước phí — tính tiền nhưng KHÔNG thu, không đụng phiên. Phải khớp con số lúc chốt thật nên
 * cùng dùng feeCalc + cùng lấy mốc left_floor_at như `completeSessionAfterPayment`.
 */
export const previewCheckoutFee = async (data) => {
  let session;

  // 3 kiểu QR khách có thể chìa ra ở chốt: vãng lai cầm QR PHIÊN, đặt chỗ cầm QR ĐƠN ĐẶT,
  // vé tháng cầm QR VÉ. Cả ba đều phải quy về đúng lượt gửi đang mở — thiếu nhánh nào thì
  // khách loại đó cầm QR ra chốt sẽ bị báo "không tìm thấy" dù xe đang nằm trong bãi.
  if (data.sessionId) {
    session = await ParkingSession.findByPk(data.sessionId);
  } else if (data.qrToken) {
    session = await ParkingSession.findOne({ where: { qr_token: data.qrToken } });
    if (!session) {
      const resv = await Reservation.findOne({ where: { qr_token: data.qrToken } });
      if (resv) {
        session = await ParkingSession.findOne({
          where: { reservation_id: resv.reservation_id, status: 'active' },
        });
      }
    }
    if (!session) {
      const pass = await MonthlyPass.findOne({ where: { qr_token: data.qrToken } });
      if (pass) {
        session = await ParkingSession.findOne({
          where: { pass_id: pass.pass_id, status: 'active' },
        });
      }
    }
  } else if (data.plateNumber) {
    session = await findActiveByPlate(data.plateNumber);
  } else {
    throw new AppError('Provide sessionId, qrToken, or plateNumber', 400, 'VALIDATION_ERROR');
  }

  if (!session || session.status !== 'active') {
    throw new AppError(await explainNoActiveSession(data), 404, 'NOT_FOUND');
  }

  const now = new Date();
  // Mốc CHỐT phí: nếu xe đã rời tầng (quét cổng tầng OUT) thì tính phí tới mốc đó,
  // không tính thời gian đi từ tầng ra cổng tòa. Chưa rời tầng → tính tới hiện tại.
  const feeEnd = session.left_floor_at ? new Date(session.left_floor_at) : now;

  // VÉ THÁNG — vé đã bao phần giờ NẰM TRONG khung, nên chỉ tính tiền phần nằm ngoài.
  // KHÔNG return sớm ở đây: khách vé tháng vẫn có thể báo mất vé (phí mất vé) và vẫn có thể
  // đỗ lố khung (phụ thu). Return sớm với fee=0 là bỏ sót sạch cả hai khoản đó.
  let pass = null;
  let passBillableMinutes = null;
  if (session.pass_id && session.session_type === 'monthly_pass') {
    pass = await MonthlyPass.findByPk(session.pass_id);
    if (pass) passBillableMinutes = billableMinutesUnderPass(pass, session.time_in, feeEnd);
  }
  const passCovered = passBillableMinutes === 0;

  const pricingRule = await getEffectivePricingRule(session.vehicle_type_id, feeEnd);
  let fee = passBillableMinutes != null
    ? calculateFeeForMinutes(passBillableMinutes, pricingRule)
    : calculateParkingFee(session.time_in, feeEnd, pricingRule);

  const activeLostIncident = await Incident.findOne({
    where: {
      session_id: session.session_id,
      type: 'lost_ticket',
      status: ['open', 'investigating'],
    },
  });
  const lostTicket = Boolean(data.lostTicket) || Boolean(activeLostIncident) || Boolean(session.lost_ticket);
  const lostTicketFee = lostTicket
    ? Number(data.lostTicketFee ?? getLostTicketFee())
    : 0;
  if (lostTicket) fee += lostTicketFee;

  // LỐ GIỜ — phát hiện theo CHÍNH phiên (tra bằng QR/biển số → time_in), chỉ walk-in, so ngưỡng
  // max_parking_hours (Manager set). Đã lố giờ thì BẮT BUỘC thu 100% — enforce server-side:
  // staff bỏ tick vẫn bị cộng phụ thu (overstay_fee Manager set) để không nhầm/quên/bỏ sót.
  // Ngoài ra staff vẫn có thể chủ động tick khi chưa cấu hình ngưỡng. Đặt chỗ / vé tháng lo khung riêng.
  const maxHours = getMaxParkingHours();
  const isWalkIn = ['walk_in', 'auto_registered'].includes(session.session_type);
  const parkedHours = (feeEnd.getTime() - new Date(session.time_in).getTime()) / (1000 * 60 * 60);
  const walkInOverstay = maxHours != null && isWalkIn && parkedHours > maxHours;

  // ĐẶT CHỖ lố giờ: "ngưỡng" không phải max_parking_hours mà là end_time của ĐƠN — ở quá khung
  // đã đặt là chiếm chỗ của người đặt ca sau. Ân hạn 15 phút cho khách lấy xe (đối xứng với
  // ân hạn check-in sớm 15 phút bên reservation.service).
  const resvOverstay = await detectReservationOverstay(session, feeEnd);

  // VÉ THÁNG lố khung: ngưỡng là khung giờ ghi trên vé. Có phút nào nằm ngoài khung là lố.
  // Vẫn thu phụ thu dù tiền giờ đã tính riêng — nếu không, đỗ lố chỉ bằng giá vãng lai thì
  // chẳng ai buồn lấy xe đúng giờ.
  const passOverstay = passBillableMinutes != null && passBillableMinutes > 0;

  const activeOverstayIncident = await Incident.findOne({
    where: {
      session_id: session.session_id,
      type: 'overstay',
      status: ['open', 'investigating'],
    },
  });
  const overstay = walkInOverstay || resvOverstay.overstay || passOverstay || Boolean(activeOverstayIncident);
  const overstayHours = walkInOverstay
    ? Math.floor(parkedHours - maxHours)
    : passOverstay
      ? Math.floor(passBillableMinutes / 60)
      : resvOverstay.overstayHours || 0;
  const overstayReason = walkInOverstay
    ? 'walk_in_max_hours'
    : passOverstay
      ? 'pass_window'
      : resvOverstay.overstay
        ? 'reservation_window'
        : Boolean(activeOverstayIncident)
          ? 'reported_overstay'
          : null;

  // enforced = hệ thống bắt buộc thu (đã phát hiện lố giờ). charge = thực tế có cộng phụ thu.
  const overstayEnforced = overstay;
  const overstayCharge = overstayEnforced || Boolean(data.overstayCharge) || Boolean(session.overstay_charge);
  const overstayFee = overstayCharge ? getOverstayFee() : 0;
  if (overstayCharge) fee += overstayFee;

  const fullSession = await getSession(session.session_id);
  const prepaid = await describePrepaid(session);

  return {
    session: fullSession,
    fee,
    pricingRule: { unit: pricingRule.unit, baseRate: pricingRule.base_rate },
    passCovered, // vé tháng bao TRỌN lượt này (0 phút ngoài khung)
    passBillableMinutes, // null = không phải vé tháng; >0 = số phút ngoài khung phải trả
    prepaid, // khoản khách đã trả trước, để quầy giải thích tại chỗ
    overstay, // đã phát hiện lố giờ (theo phiên/QR/biển số)
    overstayHours,
    overstayReason, // 'walk_in_max_hours' | 'reservation_window' | 'pass_window' | null — để staff/FE nói đúng lý do
    overstayEnforced, // true = bắt buộc thu, staff không bỏ được
    overstayCharge, // thực tế có cộng phụ thu lố giờ
    overstayFee, // mức phụ thu đã cộng (0 nếu không thu)
    lostTicket,
    lostTicketFee: lostTicket ? lostTicketFee : 0,
  };
};

export const correctSessionPlate = async (staffUserId, sessionId, plateNumber) => {
  const session = await ParkingSession.findByPk(sessionId);
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
  assertSessionActive(session);

  const normalized = normalizePlate(plateNumber);
  if (normalized === session.plate_number) {
    return getSession(sessionId);
  }

  const duplicate = await ParkingSession.findOne({
    where: { plate_number: normalized, status: 'active' },
  });
  if (duplicate && duplicate.session_id !== session.session_id) {
    throw new AppError('Plate already has an active session', 409, 'PLATE_DUPLICATE_ACTIVE');
  }

  const oldPlate = session.plate_number;
  await session.update({ plate_number: normalized });

  await createIncident(staffUserId, {
    type: 'wrong_info',
    description: `Corrected plate: ${oldPlate} → ${normalized}`,
    sessionId: session.session_id,
    slotId: session.slot_id,
    userId: session.user_id,
  });

  return getSession(sessionId);
};

export const updateCheckoutOptions = async (sessionId, { lostTicket, overstayCharge }) => {
  const session = await ParkingSession.findByPk(sessionId);
  if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
  assertSessionActive(session);

  const updates = {};
  if (lostTicket !== undefined) updates.lost_ticket = Boolean(lostTicket);
  if (overstayCharge !== undefined) updates.overstay_charge = Boolean(overstayCharge);

  await session.update(updates);
  return getSession(sessionId);
};
