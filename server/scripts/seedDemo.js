/**
 * Seed dữ liệu DEMO cho toàn bộ các bảng và tất cả các loại xe (Ô tô & Xe máy).
 *
 * MỤC ĐÍCH: Dựng sẵn toàn bộ hạ tầng, dữ liệu mẫu, cấu hình hệ thống, phiên gửi xe,
 * đặt chỗ, vé tháng, sự cố, ảnh chụp hiện trạng, và log để chạy thử nghiệm toàn diện.
 *
 * ⚠️ PHÁ HỦY DỮ LIỆU: script DROP toàn bộ bảng (sync force) rồi tạo lại + seed.
 * Chỉ chạy trên DB local/development.
 *
 * Dùng:  npm run seed --prefix server      (hoặc: node scripts/seedDemo.js)
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import sequelize, { syncSchema } from '../src/config/db.js';
import {
  Role,
  UserAccount,
  VehicleType,
  Floor,
  Zone,
  ParkingSlot,
  Gate,
  PricingRule,
  Reservation,
  ParkingSession,
  Payment,
  MonthlyPass,
  RefundRequest,
  Incident,
  AuditLog,
  Setting,
  AiLog,
  SessionPhoto,
} from '../src/models/index.js';
import { ensureRoles } from '../src/utils/ensureRoles.js';
import { ROLES } from '../src/middleware/rbac.js';
import { generateQrToken } from '../src/utils/qr.js';
import { normalizePlateVN } from '../src/utils/plateVN.js';
import { resolveShiftWindow } from '../src/utils/shifts.js';

dotenv.config();

const SLOTS_PER_ZONE = 8;
const BOOKING_FEE = 20000;
const hash = (pw) => bcrypt.hash(pw, 10);

let seedOrderCode = Math.floor(Date.now() / 1000) * 1000;

// Helper thanh toán thành công cho đơn reservation
const paySuccess = (reservationId) =>
  Payment.create({
    reservation_id: reservationId,
    order_code: (seedOrderCode += 1),
    amount: BOOKING_FEE,
    status: 'success',
    method: 'payos',
    paid_at: new Date(),
  });

// Helper thanh toán thành công cho vé tháng
const paySuccessPass = (passId, amount) =>
  Payment.create({
    pass_id: passId,
    order_code: (seedOrderCode += 1),
    amount: amount,
    status: 'success',
    method: 'payos',
    paid_at: new Date(),
  });

const pad2 = (n) => String(n).padStart(2, '0');
const dateStrOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Phân giải ca đỗ
const shiftWindowContaining = (at) => {
  const h = at.getHours();
  const base = new Date(at);
  let shiftId;
  if (h >= 6 && h < 12) shiftId = 'morning';
  else if (h >= 12 && h < 18) shiftId = 'afternoon';
  else if (h >= 18 && h < 22) shiftId = 'evening';
  else { shiftId = 'overnight'; if (h < 6) base.setDate(base.getDate() - 1); }
  const win = resolveShiftWindow(dateStrOf(base), shiftId);
  return { shiftId, start: win.start, end: win.end };
};

const shiftWindowOn = (dayOffset, shiftId) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const win = resolveShiftWindow(dateStrOf(d), shiftId);
  return { shiftId, start: win.start, end: win.end };
};

// 1x1 JPEG Buffer tối giản để lưu file ảnh thực tế trên đĩa (tránh stream file bị lỗi)
const miniJpg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

const seedPhotoFile = (sessionId, phase, kind, date = new Date()) => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const relPath = path.posix.join('sessions', yyyy, mm, dd, String(sessionId), `${phase}-${kind}.jpg`);
  const absPath = path.join(process.cwd(), 'uploads', relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, miniJpg);
  return relPath;
};

const seedIncidentFile = (filename) => {
  const relPath = path.posix.join('incidents', filename);
  const absPath = path.join(process.cwd(), 'uploads', relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, miniJpg);
  return relPath;
};

const run = async () => {
  await sequelize.authenticate();
  console.log('• DB connected — dropping & recreating all tables…');
  await syncSchema({ fresh: true }); // sync force DROP + CREATE
  await ensureRoles();

  const roles = {};
  for (const r of await Role.findAll()) roles[r.role_name] = r.role_id;

  // --- 1. Settings ---------------------------------------------------------
  const DEFAULT_BUILDING = {
    building_name: 'Bãi đỗ PBMS',
    address: 'FPT University, Hồ Chí Minh',
    phone: '02473005588',
    is_24_7: false,
    open_time: '00:00',
    close_time: '24:00',
  };
  const DEFAULT_SYSTEM = {
    booking_fee: 20000,
    monthly_pass_price: 500000,
    lost_ticket_fee: 50000,
    overstay_fee: 30000,
    slot_suggest_strategy: 'nearest_gate',
    suggest_score_weights: { gate: 1, zone_balance: 0.5, preference: 0.25 },
    ai_logging_enabled: true,
    max_parking_hours: null,
    booking_refund_cutoff_hours: 1,
    booking_refund_percent: 100,
    booking_pending_ttl_minutes: 15,
    booking_no_show_grace_minutes: 0,
    booking_max_advance_days: 365,
    booking_max_duration_hours: 24,
    pass_refund_trial_days: 3,
    pass_refund_trial_percent: 70,
    pass_refund_half_term_percent: 50,
    pass_refund_bank_info_ttl_days: 7,
    require_entry_photo: true,
    require_exit_photo: true,
    photo_required_kinds: ['front', 'left', 'rear', 'right', 'driver'],
    photo_retention_days: 90,
    photo_max_stale_seconds: 120,
    photo_similarity_threshold: 6,
  };
  await Setting.create({
    setting_id: 1,
    building_config: JSON.stringify(DEFAULT_BUILDING),
    system_config: JSON.stringify(DEFAULT_SYSTEM),
  });
  console.log('• Setting initialized.');

  // --- 2. Users -------------------------------------------------------------
  const accounts = [
    ['admin', '123456', 'Trần Quốc Bảo', ROLES.ADMIN, 'admin@pbms.vn'],
    ['manager', '123456', 'Phạm Thị Hương', ROLES.MANAGER, 'manager@pbms.vn'],
    ['staff', '123456', 'Lê Văn Cường', ROLES.STAFF, 'staff@pbms.vn'],
    ['user', '123456', 'Nguyễn Minh An', ROLES.USER, 'minhan@pbms.vn'],
    ['user2', '123456', 'Vũ Thị Thu Hằng', ROLES.USER, 'hangvu@pbms.vn', 'Vietcombank', '0071000123456', 'VU THI THU HANG'],
    ['chuaverify', '123456', 'Đỗ Hoàng Long', ROLES.USER, 'longdo@pbms.vn', null, null, null, false],
  ];
  const users = {};
  for (const [username, pw, fullName, roleName, email, bankName, bankAcc, bankHolder, verified = true] of accounts) {
    users[username] = await UserAccount.create({
      username,
      password_hash: await hash(pw),
      full_name: fullName,
      role_id: roles[roleName],
      email,
      is_active: true,
      email_verified: verified,
      bank_name: bankName || null,
      bank_account_number: bankAcc || null,
      bank_account_holder: bankHolder || null,
    });
  }
  console.log(`• Users: ${Object.keys(users).join(', ')}`);

  const moreCustomers = [
    ['tuanbui', 'Bùi Anh Tuấn', 'tuanbui@pbms.vn'],
    ['maihoang', 'Hoàng Thị Mai', 'maihoang@pbms.vn'],
    ['thangngo', 'Ngô Đức Thắng', 'thangngo@pbms.vn'],
    ['trangdang', 'Đặng Thu Trang', 'trangdang@pbms.vn'],
    ['hoatrinh', 'Trịnh Văn Hòa', 'hoatrinh@pbms.vn'],
  ];
  const customers = [users.user, users.user2];
  for (const [username, fullName, email] of moreCustomers) {
    customers.push(
      await UserAccount.create({
        username,
        password_hash: await hash('123456'),
        full_name: fullName,
        role_id: roles[ROLES.USER],
        email,
        is_active: true,
        email_verified: true,
      }),
    );
  }

  // --- 3. Vehicle Types ----------------------------------------------------
  const car = await VehicleType.create({ type_name: 'Ô tô (≤5 chỗ)', type_code: 'CAR', slot_area_m2: 25 });
  const bike = await VehicleType.create({ type_name: 'Xe máy', type_code: 'BIKE', slot_area_m2: 3 });
  const evbike = await VehicleType.create({ type_name: 'Xe máy điện', type_code: 'EVBIKE', slot_area_m2: 3 });
  console.log('• Vehicle types: CAR, BIKE, EVBIKE');

  // --- 4. Pricing Rules ----------------------------------------------------
  const effectiveFrom = new Date('2026-01-01T00:00:00Z');
  await PricingRule.create({
    vehicle_type_id: car.vehicle_type_id,
    unit: 60,
    base_rate: 15000,
    effective_from: effectiveFrom,
    effective_to: null,
  });
  await PricingRule.create({
    vehicle_type_id: bike.vehicle_type_id,
    unit: 60,
    base_rate: 3000,
    effective_from: effectiveFrom,
    effective_to: null,
  });
  await PricingRule.create({
    vehicle_type_id: evbike.vehicle_type_id,
    unit: 60,
    base_rate: 3000,
    effective_from: effectiveFrom,
    effective_to: null,
  });
  console.log('• Pricing rules established.');

  // --- 5. Cổng cấp tòa nhà (floor_id = NULL) -------------------------------
  await Gate.create({
    floor_id: null, gate_code: 'BLD-IN', direction: 'in',
    label: 'Cổng vào tòa nhà', is_active: true,
  });
  await Gate.create({
    floor_id: null, gate_code: 'BLD-OUT', direction: 'out',
    label: 'Cổng ra tòa nhà', is_active: true,
  });

  // Helper tạo ảnh chụp hiện trạng
  const seedSessionPhotos = async (sessionId, phase, staffId, atTime) => {
    const kinds = ['front', 'left', 'rear', 'right', 'driver'];
    for (const kind of kinds) {
      const relPath = seedPhotoFile(sessionId, phase, kind, atTime);
      await SessionPhoto.create({
        session_id: sessionId,
        phase,
        kind,
        file_path: relPath,
        sha256_raw: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        sha256_stored: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        phash: '1234567890abcdef',
        source: 'camera',
        mime: 'image/jpeg',
        bytes: miniJpg.length,
        width: 1280,
        height: 720,
        captured_at: atTime,
        received_at: atTime,
        captured_by: staffId,
      });
    }
  };

  // --- 6. Tầng + Khu + Chỗ + Cổng tầng -------------------------------------
  const createZonedFloor = async ({ code, level, label, areaM2 }) => {
    const floor = await Floor.create({
      floor_code: code,
      floor_level: level,
      label,
      layout_mode: 'zoned',
      vehicle_type_id: null,
      area_m2: areaM2,
    });

    await Gate.create({
      floor_id: floor.floor_id, gate_code: `${code}-IN`, direction: 'in',
      label: `${label} - Cổng vào`, is_active: true,
    });
    await Gate.create({
      floor_id: floor.floor_id, gate_code: `${code}-OUT`, direction: 'out',
      label: `${label} - Cổng ra`, is_active: true,
    });

    const zoneList = [
      { vt: car, capacity: Math.max(1, Math.floor(SLOTS_PER_ZONE / 4)), labelSuffix: 'Khu ô tô' },
      { vt: bike, capacity: Math.max(1, Math.floor(SLOTS_PER_ZONE / 4)), labelSuffix: 'Khu xe máy' },
      { vt: evbike, capacity: Math.max(1, Math.floor(SLOTS_PER_ZONE / 4)), labelSuffix: 'Khu xe máy điện' }
    ];

    const zones = {};

    for (const z of zoneList) {
      const zone = await Zone.create({
        floor_id: floor.floor_id,
        vehicle_type_id: z.vt.vehicle_type_id,
        zone_code: `${code}-${z.vt.type_code}-01`,
        label: `${label} - ${z.labelSuffix}`,
        total_slots: SLOTS_PER_ZONE,
        monthly_pass_capacity: z.capacity,
      });
      zones[z.vt.type_code] = zone;

      for (let i = 1; i <= SLOTS_PER_ZONE; i++) {
        await ParkingSlot.create({
          zone_id: zone.zone_id,
          slot_code: `${zone.zone_code}-${pad2(i)}`,
          status: 'available',
          distance_to_gate: i * 2,
        });
      }
    }

    return { floor, zones };
  };

  const b1 = await createZonedFloor({ code: 'B1', level: -1, label: 'Hầm B1', areaM2: 400 });
  const f1 = await createZonedFloor({ code: 'F1', level: 1, label: 'Tầng 1', areaM2: 1000 });
  const f2 = await createZonedFloor({ code: 'F2', level: 2, label: 'Tầng 2', areaM2: 1000 });
  console.log('• Floors B1, F1, F2 populated with CAR, BIKE, EVBIKE zones.');

  const now = new Date();
  const parkedShift = shiftWindowContaining(now);
  const f1InGate = await Gate.findOne({ where: { gate_code: 'F1-IN' } });

  // --- 7. Đơn đặt CONFIRMED sẵn (Chỗ gán khi check-in) ----------------------
  // Ô tô
  const carResPlate = normalizePlateVN('30A-123.45');
  const carResQr = generateQrToken();
  const carReservation = await Reservation.create({
    user_id: users.user.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: f1.floor.floor_id,
    zone_id: f1.zones.CAR.zone_id,
    slot_id: null,
    plate_number: carResPlate,
    start_time: parkedShift.start,
    end_time: parkedShift.end,
    status: 'confirmed',
    reservation_type: parkedShift.shiftId,
    qr_token: carResQr,
  });
  await paySuccess(carReservation.reservation_id);

  // Xe máy
  const bikeResPlate = normalizePlateVN('29M1-999.99');
  const bikeResQr = generateQrToken();
  const bikeReservation = await Reservation.create({
    user_id: users.user.user_id,
    vehicle_type_id: bike.vehicle_type_id,
    floor_id: f1.floor.floor_id,
    zone_id: f1.zones.BIKE.zone_id,
    slot_id: null,
    plate_number: bikeResPlate,
    start_time: parkedShift.start,
    end_time: parkedShift.end,
    status: 'confirmed',
    reservation_type: parkedShift.shiftId,
    qr_token: bikeResQr,
  });
  await paySuccess(bikeReservation.reservation_id);
  console.log('• Confirmed reservations created.');

  // --- 8. Phiên CHECKED_IN hoạt động (Xe đang đỗ) ---------------------------
  // Ô tô
  const carOccSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.CAR.zone_id, status: 'available' },
    order: [['slot_id', 'ASC']],
  });
  await carOccSlot.update({ status: 'occupied' });
  const carInPlate = normalizePlateVN('51G-234.56');
  const carInRes = await Reservation.create({
    user_id: users.user.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: f1.floor.floor_id,
    zone_id: f1.zones.CAR.zone_id,
    slot_id: carOccSlot.slot_id,
    plate_number: carInPlate,
    start_time: parkedShift.start,
    end_time: parkedShift.end,
    status: 'checked_in',
    reservation_type: parkedShift.shiftId,
    qr_token: generateQrToken(),
  });
  await paySuccess(carInRes.reservation_id);

  const carInSession = await ParkingSession.create({
    user_id: users.user.user_id,
    reservation_id: carInRes.reservation_id,
    gate_id: f1InGate.gate_id,
    slot_id: carOccSlot.slot_id,
    vehicle_type_id: car.vehicle_type_id,
    plate_number: carInPlate,
    time_in: new Date(Math.max(parkedShift.start.getTime(), now.getTime() - 2 * 60 * 60 * 1000)),
    gate_stage: 'on_floor',
    qr_token: generateQrToken(),
    check_in_by: users.staff.user_id,
    session_type: 'reservation',
    status: 'active',
  });
  await seedSessionPhotos(carInSession.session_id, 'entry', users.staff.user_id, carInSession.time_in);

  // Xe máy
  const bikeOccSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.BIKE.zone_id, status: 'available' },
    order: [['slot_id', 'ASC']],
  });
  await bikeOccSlot.update({ status: 'occupied' });
  const bikeInPlate = normalizePlateVN('29H1-567.89');
  const bikeInRes = await Reservation.create({
    user_id: users.user.user_id,
    vehicle_type_id: bike.vehicle_type_id,
    floor_id: f1.floor.floor_id,
    zone_id: f1.zones.BIKE.zone_id,
    slot_id: bikeOccSlot.slot_id,
    plate_number: bikeInPlate,
    start_time: parkedShift.start,
    end_time: parkedShift.end,
    status: 'checked_in',
    reservation_type: parkedShift.shiftId,
    qr_token: generateQrToken(),
  });
  await paySuccess(bikeInRes.reservation_id);

  const bikeInSession = await ParkingSession.create({
    user_id: users.user.user_id,
    reservation_id: bikeInRes.reservation_id,
    gate_id: f1InGate.gate_id,
    slot_id: bikeOccSlot.slot_id,
    vehicle_type_id: bike.vehicle_type_id,
    plate_number: bikeInPlate,
    time_in: new Date(Math.max(parkedShift.start.getTime(), now.getTime() - 2 * 60 * 60 * 1000)),
    gate_stage: 'on_floor',
    qr_token: generateQrToken(),
    check_in_by: users.staff.user_id,
    session_type: 'reservation',
    status: 'active',
  });
  await seedSessionPhotos(bikeInSession.session_id, 'entry', users.staff.user_id, bikeInSession.time_in);
  console.log('• Active reservation sessions (parked vehicles) created.');

  // --- 9. Khách vãng lai Walk-in đỗ lâu ------------------------------------
  // Ô tô
  const carWalkSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.CAR.zone_id, status: 'available' },
    order: [['slot_id', 'DESC']],
  });
  await carWalkSlot.update({ status: 'occupied' });
  const carWalkSession = await ParkingSession.create({
    user_id: null,
    gate_id: f1InGate.gate_id,
    slot_id: carWalkSlot.slot_id,
    vehicle_type_id: car.vehicle_type_id,
    plate_number: normalizePlateVN('43A-567.89'),
    time_in: new Date(now.getTime() - 3 * 60 * 60 * 1000), // 3h trước
    gate_stage: 'on_floor',
    qr_token: generateQrToken(),
    check_in_by: users.staff.user_id,
    session_type: 'walk_in',
    status: 'active',
  });
  await seedSessionPhotos(carWalkSession.session_id, 'entry', users.staff.user_id, carWalkSession.time_in);

  // Xe máy
  const bikeWalkSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.BIKE.zone_id, status: 'available' },
    order: [['slot_id', 'DESC']],
  });
  await bikeWalkSlot.update({ status: 'occupied' });
  const bikeWalkSession = await ParkingSession.create({
    user_id: null,
    gate_id: f1InGate.gate_id,
    slot_id: bikeWalkSlot.slot_id,
    vehicle_type_id: bike.vehicle_type_id,
    plate_number: normalizePlateVN('29K1-111.11'),
    time_in: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4h trước
    gate_stage: 'on_floor',
    qr_token: generateQrToken(),
    check_in_by: users.staff.user_id,
    session_type: 'walk_in',
    status: 'active',
  });
  await seedSessionPhotos(bikeWalkSession.session_id, 'entry', users.staff.user_id, bikeWalkSession.time_in);
  console.log('• Active walk-in sessions created.');

  // --- 10. Đơn ĐĂNG KÝ VÀ KHÓA ĐẦU CA (reserved) ---------------------------
  const lockCarSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.CAR.zone_id, status: 'available' },
    order: [['slot_id', 'ASC']],
  });
  await lockCarSlot.update({ status: 'reserved' });
  const lockedResv = await Reservation.create({
    user_id: users.user.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: f1.floor.floor_id,
    zone_id: f1.zones.CAR.zone_id,
    slot_id: lockCarSlot.slot_id,
    plate_number: normalizePlateVN('51F-678.91'),
    start_time: parkedShift.start,
    end_time: parkedShift.end,
    status: 'confirmed',
    reservation_type: parkedShift.shiftId,
    qr_token: generateQrToken(),
  });
  await paySuccess(lockedResv.reservation_id);
  console.log('• Locked-at-shift-start (reserved) slot demo created.');

  // --- 11. Các luồng bổ sung: PENDING, CANCELLED, REFUND... ------------------
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const makeReservation = (fields) =>
    Reservation.create({
      user_id: users.user.user_id,
      vehicle_type_id: car.vehicle_type_id,
      floor_id: f1.floor.floor_id,
      zone_id: f1.zones.CAR.zone_id,
      reservation_type: 'standard',
      qr_token: generateQrToken(),
      ...fields,
    });

  const makePayment = (fields) =>
    Payment.create({
      order_code: (seedOrderCode += 1),
      amount: BOOKING_FEE,
      method: 'payos',
      ...fields,
    });

  // (1) Đơn PENDING + link thanh toán chưa nộp tiền
  const pendShift = shiftWindowOn(1, 'afternoon');
  const pendingResv = await makeReservation({
    plate_number: normalizePlateVN('51F-400.01'),
    start_time: pendShift.start,
    end_time: pendShift.end,
    status: 'pending',
    reservation_type: pendShift.shiftId,
  });
  await makePayment({
    reservation_id: pendingResv.reservation_id,
    status: 'pending',
    gateway_response: JSON.stringify({ checkoutUrl: 'https://pay.payos.vn/web/seed-dead-link' }),
  });

  // (2) Đơn CANCELLED trước cutoff -> refund_request PENDING (user2 có STK)
  const cancEarly = await makeReservation({
    user_id: users.user2.user_id,
    plate_number: normalizePlateVN('51F-400.02'),
    start_time: new Date(now.getTime() + 2 * DAY),
    end_time: new Date(now.getTime() + 2 * DAY + 6 * HOUR),
    status: 'cancelled',
  });
  const cancEarlyPay = await makePayment({
    reservation_id: cancEarly.reservation_id, status: 'success', paid_at: new Date(now.getTime() - 2 * HOUR),
  });
  await RefundRequest.create({
    reservation_id: cancEarly.reservation_id, payment_id: cancEarlyPay.payment_id,
    user_id: users.user2.user_id, percent: 100, amount: BOOKING_FEE,
    status: 'pending', requested_at: new Date(now.getTime() - 1 * HOUR),
  });

  // (3) Đơn CANCELLED stale -> refund_request PENDING quá hạn (user không STK)
  const cancStale = await makeReservation({
    plate_number: normalizePlateVN('51F-400.03'),
    start_time: new Date(now.getTime() - 6 * DAY),
    end_time: new Date(now.getTime() - 6 * DAY + 6 * HOUR),
    status: 'cancelled',
  });
  const cancStalePay = await makePayment({
    reservation_id: cancStale.reservation_id, status: 'success', paid_at: new Date(now.getTime() - 8 * DAY),
  });
  await RefundRequest.create({
    reservation_id: cancStale.reservation_id, payment_id: cancStalePay.payment_id,
    user_id: users.user.user_id, percent: 100, amount: BOOKING_FEE,
    status: 'pending', requested_at: new Date(now.getTime() - 8 * DAY),
  });

  // (4) Đơn CANCELLED đã hoàn tiền (lịch sử)
  const cancDone = await makeReservation({
    user_id: users.user2.user_id,
    plate_number: normalizePlateVN('51F-400.04'),
    start_time: new Date(now.getTime() - 10 * DAY),
    end_time: new Date(now.getTime() - 10 * DAY + 6 * HOUR),
    status: 'cancelled',
  });
  const cancDonePay = await makePayment({
    reservation_id: cancDone.reservation_id, status: 'refunded', paid_at: new Date(now.getTime() - 11 * DAY),
  });
  await RefundRequest.create({
    reservation_id: cancDone.reservation_id, payment_id: cancDonePay.payment_id,
    user_id: users.user2.user_id, percent: 100, amount: BOOKING_FEE,
    status: 'refunded', requested_at: new Date(now.getTime() - 11 * DAY),
    refunded_at: new Date(now.getTime() - 9 * DAY), refunded_by: users.admin.user_id,
    note: 'Chuyển khoản Vietcombank giao dịch FT260817001'
  });

  // (5) Đơn COMPLETED lịch sử
  const doneResv = await makeReservation({
    plate_number: normalizePlateVN('51F-400.05'),
    start_time: new Date(now.getTime() - 1 * DAY - 4 * HOUR),
    end_time: new Date(now.getTime() - 1 * DAY),
    status: 'completed',
  });
  await paySuccess(doneResv.reservation_id);
  const doneSession = await ParkingSession.create({
    user_id: users.user.user_id,
    reservation_id: doneResv.reservation_id,
    gate_id: f1InGate.gate_id,
    slot_id: carOccSlot.slot_id,
    vehicle_type_id: car.vehicle_type_id,
    plate_number: doneResv.plate_number,
    time_in: new Date(now.getTime() - 1 * DAY - 4 * HOUR),
    time_out: new Date(now.getTime() - 1 * DAY),
    gate_stage: 'exited',
    qr_token: `revoked-session-${Date.now()}`,
    check_in_by: users.staff.user_id,
    check_out_by: users.staff.user_id,
    session_type: 'reservation',
    status: 'completed',
    calculated_fee: 60000,
  });
  await makePayment({
    session_id: doneSession.session_id, amount: 60000, status: 'success',
    paid_at: new Date(now.getTime() - 1 * DAY),
  });
  await seedSessionPhotos(doneSession.session_id, 'entry', users.staff.user_id, doneSession.time_in);
  await seedSessionPhotos(doneSession.session_id, 'exit', users.staff.user_id, doneSession.time_out);

  // (6) Đơn NO_SHOW
  const noshowResv = await makeReservation({
    plate_number: normalizePlateVN('51F-400.06'),
    start_time: new Date(now.getTime() - 1 * DAY - 6 * HOUR),
    end_time: new Date(now.getTime() - 1 * DAY - 2 * HOUR),
    status: 'no_show',
  });
  await paySuccess(noshowResv.reservation_id);

  // (7) Đơn CHECKED_IN bị LỐ GIỜ (Phụ thu)
  const overSlot = await ParkingSlot.findOne({
    where: { zone_id: f1.zones.CAR.zone_id, status: 'available' }, order: [['slot_id', 'ASC']],
  });
  await overSlot.update({ status: 'occupied' });
  const overResv = await makeReservation({
    slot_id: overSlot.slot_id,
    plate_number: normalizePlateVN('51F-400.07'),
    start_time: new Date(now.getTime() - 6 * HOUR),
    end_time: new Date(now.getTime() - 2 * HOUR), // Hết giờ từ 2 tiếng trước
    status: 'checked_in',
  });
  await paySuccess(overResv.reservation_id);
  const overSession = await ParkingSession.create({
    user_id: users.user.user_id,
    reservation_id: overResv.reservation_id,
    gate_id: f1InGate.gate_id,
    slot_id: overSlot.slot_id,
    vehicle_type_id: car.vehicle_type_id,
    plate_number: overResv.plate_number,
    time_in: new Date(now.getTime() - 6 * HOUR),
    gate_stage: 'on_floor',
    qr_token: generateQrToken(),
    check_in_by: users.staff.user_id,
    session_type: 'reservation',
    status: 'active',
  });
  await seedSessionPhotos(overSession.session_id, 'entry', users.staff.user_id, overSession.time_in);
  console.log('• Reservation flow edge cases seeded.');

  // --- 12. Vé tháng (Active, Pending, Expired) cho Ô tô & Xe máy ------------
  const passWindow = { valid_from_time: '06:00:00', valid_to_time: '22:00:00' };

  // Vé ô tô active
  const passCarActive = await MonthlyPass.create({
    user_id: users.user.user_id, vehicle_type_id: car.vehicle_type_id, floor_id: f2.floor.floor_id,
    plate_number: normalizePlateVN('51C-501.01'), ...passWindow,
    start_date: new Date(now.getTime() - 7 * DAY), end_date: new Date(now.getTime() + 23 * DAY),
    status: 'active', qr_token: generateQrToken(),
  });
  await paySuccessPass(passCarActive.pass_id, 500000);

  // Vé xe máy active
  const passBikeActive = await MonthlyPass.create({
    user_id: users.user.user_id, vehicle_type_id: bike.vehicle_type_id, floor_id: f2.floor.floor_id,
    plate_number: normalizePlateVN('59M1-111.11'), ...passWindow,
    start_date: new Date(now.getTime() - 5 * DAY), end_date: new Date(now.getTime() + 25 * DAY),
    status: 'active', qr_token: generateQrToken(),
  });
  await paySuccessPass(passBikeActive.pass_id, 100000);

  // Vé ô tô pending (chờ thanh toán)
  const passCarPending = await MonthlyPass.create({
    user_id: users.user2.user_id, vehicle_type_id: car.vehicle_type_id, floor_id: f2.floor.floor_id,
    plate_number: normalizePlateVN('51C-502.02'), ...passWindow,
    start_date: new Date(now.getTime() + 1 * DAY), end_date: new Date(now.getTime() + 31 * DAY),
    status: 'pending', qr_token: null,
  });
  await makePayment({
    pass_id: passCarPending.pass_id, amount: 500000, status: 'pending',
    gateway_response: JSON.stringify({ checkoutUrl: 'https://pay.payos.vn/web/seed-dead-pass-link' }),
  });

  // Vé ô tô hết hạn
  const passCarExpired = await MonthlyPass.create({
    user_id: users.user.user_id, vehicle_type_id: car.vehicle_type_id, floor_id: f2.floor.floor_id,
    plate_number: normalizePlateVN('51C-503.03'), ...passWindow,
    start_date: new Date(now.getTime() - 40 * DAY), end_date: new Date(now.getTime() - 1 * DAY),
    status: 'expired', qr_token: generateQrToken(),
  });
  await paySuccessPass(passCarExpired.pass_id, 500000);
  console.log('• Monthly passes initialized.');

  // --- 13. Sự cố (Incident) -----------------------------------------------
  // 1 sự cố ĐANG MỞ (Walk-in ô tô lố giờ)
  await Incident.create({
    type: 'overstay', status: 'open',
    session_id: carWalkSession.session_id,
    slot_id: carWalkSession.slot_id,
    reported_by: users.staff.user_id,
    description: `Khách ô tô ${carWalkSession.plate_number} đỗ vượt ngưỡng quá 3 tiếng — barie cổng ra cần chặn phụ thu`,
  });

  // 1 sự cố ĐÃ XỬ LÝ (Resolved) - Có ảnh lưu trên đĩa + kết luận xử lý
  const resolvedIncidentImage = seedIncidentFile('resolved_damage_01.jpg');
  await Incident.create({
    type: 'vehicle_damage',
    status: 'resolved',
    session_id: doneSession.session_id,
    slot_id: doneSession.slot_id,
    user_id: users.user.user_id,
    reported_by: users.staff.user_id,
    resolved_by: users.admin.user_id,
    resolved_at: new Date(now.getTime() - 12 * HOUR),
    description: 'Khách hàng báo đầu xe có vết xước nhỏ sau khi đỗ tại chỗ F1-CAR-01-02.',
    resolution: 'Đã trích xuất camera hiện trạng lúc vào cho thấy vết xước đã có từ trước khi xe qua barie vào bãi. Khách hàng đã kiểm chứng và đồng ý rút khiếu nại.',
    image_path: resolvedIncidentImage,
  });
  console.log('• Incidents (1 open, 1 resolved) created.');

  // --- 14. Audit Log --------------------------------------------------------
  await AuditLog.create({
    actor_id: null,
    action: 'reservation.no_show',
    details: JSON.stringify({
      reservationId: noshowResv.reservation_id,
      plate: noshowResv.plate_number,
      userId: users.user.user_id,
      detail: `Đơn đặt chỗ ô tô ${noshowResv.plate_number} quá giờ không check-in. Hệ thống tự động hủy và nhả chỗ.`
    })
  });

  await AuditLog.create({
    actor_id: users.admin.user_id,
    action: 'setting.update',
    details: JSON.stringify({
      message: 'Cập nhật cấu hình bãi đỗ xe thành công',
      changed: ['system_config.booking_fee']
    })
  });
  console.log('• Audit logs written.');

  // --- 15. AI Recommendation Logs (AiLog) ----------------------------------
  // Ghi nhận lịch sử thuật toán AI gợi ý chỗ đỗ xe
  const allSlots = await ParkingSlot.findAll();
  for (let idx = 0; idx < Math.min(allSlots.length, 5); idx++) {
    const targetSlot = allSlots[idx];
    await AiLog.create({
      session_id: carInSession.session_id,
      algorithm_used: 'nearest_gate',
      candidates_count: 8,
      selected_slot_id: targetSlot.slot_id,
      executed_time_ms: 15 + idx * 3,
      floor_id: f1.floor.floor_id,
      vehicle_type_id: car.vehicle_type_id,
      context: 'reservation',
    });
  }
  console.log('• AI recommendation logs written.');

  // --- 16. Dữ liệu LỊCH SỬ VOLUME để vẽ đồ thị (Dashboard) -------------------
  // Cung cấp các lượt gửi đã hoàn tất trong các ca đỗ khác nhau của 7 ngày qua
  const RATE = { CAR: 15000, BIKE: 3000, EVBIKE: 3000 };
  const inGateOf = (floorId) => Gate.findOne({ where: { floor_id: floorId, direction: 'in' } });
  const firstSlotOf = (zoneId) => ParkingSlot.findOne({ where: { zone_id: zoneId }, order: [['slot_id', 'ASC']] });

  const seedCompletedVisit = async ({ customer, floor, zone, vehicleType, plate, daysAgo, shiftId, hours }) => {
    const win = shiftWindowOn(-daysAgo, shiftId);
    const p = normalizePlateVN(plate);
    const fee = hours * RATE[vehicleType.type_code];
    const resv = await Reservation.create({
      user_id: customer.user_id, vehicle_type_id: vehicleType.vehicle_type_id,
      floor_id: floor.floor_id, zone_id: zone.zone_id, slot_id: null,
      plate_number: p, start_time: win.start, end_time: win.end,
      status: 'completed', reservation_type: shiftId, qr_token: generateQrToken(),
    });
    await paySuccess(resv.reservation_id);
    const gate = await inGateOf(floor.floor_id);
    const slot = await firstSlotOf(zone.zone_id);

    const sess = await ParkingSession.create({
      user_id: customer.user_id, reservation_id: resv.reservation_id,
      gate_id: gate.gate_id, slot_id: slot.slot_id, vehicle_type_id: vehicleType.vehicle_type_id,
      plate_number: p, time_in: win.start, time_out: new Date(win.start.getTime() + hours * HOUR),
      gate_stage: 'exited', qr_token: `revoked-hist-${resv.reservation_id}`,
      check_in_by: users.staff.user_id, check_out_by: users.staff.user_id,
      session_type: 'reservation', status: 'completed', calculated_fee: fee,
    });
    await makePayment({ session_id: sess.session_id, amount: fee, status: 'success', paid_at: sess.time_out });

    // Seed ảnh check-in và check-out
    await seedSessionPhotos(sess.session_id, 'entry', users.staff.user_id, sess.time_in);
    await seedSessionPhotos(sess.session_id, 'exit', users.staff.user_id, sess.time_out);
  };

  const visits = [
    // Ô tô
    { floor: f1.floor, zone: f1.zones.CAR, vt: car, plate: '30E-678.90', daysAgo: 1, shift: 'morning', hours: 3 },
    { floor: f2.floor, zone: f2.zones.CAR, vt: car, plate: '29B-111.22', daysAgo: 1, shift: 'afternoon', hours: 2 },
    { floor: b1.floor, zone: b1.zones.CAR, vt: car, plate: '43C-334.55', daysAgo: 2, shift: 'evening', hours: 4 },
    { floor: f1.floor, zone: f1.zones.CAR, vt: car, plate: '51H-999.88', daysAgo: 2, shift: 'morning', hours: 5 },
    { floor: f2.floor, zone: f2.zones.CAR, vt: car, plate: '47B-778.99', daysAgo: 3, shift: 'afternoon', hours: 2 },
    // Xe máy
    { floor: f1.floor, zone: f1.zones.BIKE, vt: bike, plate: '29H1-888.88', daysAgo: 1, shift: 'morning', hours: 8 },
    { floor: f2.floor, zone: f2.zones.BIKE, vt: bike, plate: '30K2-222.22', daysAgo: 2, shift: 'afternoon', hours: 4 },
    { floor: b1.floor, zone: b1.zones.BIKE, vt: bike, plate: '92L3-333.33', daysAgo: 3, shift: 'evening', hours: 6 },
    { floor: f1.floor, zone: f1.zones.BIKE, vt: bike, plate: '59P1-444.44', daysAgo: 4, shift: 'morning', hours: 5 },
    { floor: f2.floor, zone: f2.zones.BIKE, vt: bike, plate: '75S2-555.55', daysAgo: 5, shift: 'afternoon', hours: 3 },
  ];

  let vIdx = 0;
  for (const v of visits) {
    await seedCompletedVisit({
      customer: customers[vIdx % customers.length],
      floor: v.floor, zone: v.zone, vehicleType: v.vt,
      plate: v.plate, daysAgo: v.daysAgo, shiftId: v.shift, hours: v.hours,
    });
    vIdx++;
  }

  // Xe đang đỗ ở các tầng khác để dashboard trực quan
  const parkNow = [
    { floor: f2.floor, zone: f2.zones.CAR, vt: car, plate: '30FG-246.80', hoursAgo: 1 },
    { floor: b1.floor, zone: b1.zones.BIKE, vt: bike, plate: '77A-112.23', hoursAgo: 2 },
  ];
  for (const pk of parkNow) {
    const slot = await ParkingSlot.findOne({
      where: { zone_id: pk.zone.zone_id, status: 'available' }, order: [['slot_id', 'ASC']],
    });
    if (!slot) continue;
    await slot.update({ status: 'occupied' });
    const gate = await inGateOf(pk.floor.floor_id);
    const session = await ParkingSession.create({
      user_id: null, gate_id: gate.gate_id, slot_id: slot.slot_id,
      vehicle_type_id: pk.vt.vehicle_type_id, plate_number: normalizePlateVN(pk.plate),
      time_in: new Date(now.getTime() - pk.hoursAgo * HOUR), gate_stage: 'on_floor',
      qr_token: generateQrToken(), check_in_by: users.staff.user_id,
      session_type: 'walk_in', status: 'active',
    });
    await seedSessionPhotos(session.session_id, 'entry', users.staff.user_id, session.time_in);
  }

  console.log(`• Volume dashboard completed visits and additional parked cars/bikes populated.`);

  console.log('\n================ SEED DONE (Ô TÔ & XE MÁY) ================');
  console.log('Tài khoản (username / password):');
  console.log('  admin   / 123456 (Quản trị viên)');
  console.log('  manager / 123456 (Quản lý bãi đỗ)');
  console.log('  staff   / 123456 (Nhân viên vận hành cổng)');
  console.log('  user    / 123456 (Khách hàng vãng lai / Đặt chỗ)');
  console.log('  user2   / 123456 (Khách hàng đã thêm tài khoản nhận hoàn tiền)');
  console.log('  chuaverify / 123456 (Tài khoản chưa xác thực email - test chặn login)');
  console.log('\nĐặt chỗ confirmed sẵn:');
  console.log(`  Ô tô:  Biển = ${carResPlate}  | QR Token = ${carResQr}`);
  console.log(`  Xe máy: Biển = ${bikeResPlate} | QR Token = ${bikeResQr}`);
  console.log('\nKhách đỗ sẵn (checked_in) - Sẵn sàng quét checkout:');
  console.log(`  Ô tô:   Biển = ${carInPlate} | Session QR = ${carInSession.qr_token} | Chỗ = ${carOccSlot.slot_code}`);
  console.log(`  Xe máy:  Biển = ${bikeInPlate} | Session QR = ${bikeInSession.qr_token} | Chỗ = ${bikeOccSlot.slot_code}`);
  console.log('===========================================================\n');
  process.exit(0);
};

run().catch((err) => {
  console.error('Seed thất bại:', err.message || err);
  process.exit(1);
});
