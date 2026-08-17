/**
 * Tạo dữ liệu test cho luồng QUÉT QR: 3 vé tháng + 3 đặt chỗ, BỎ QUA khâu thanh toán PayOS.
 * Chạy: npm run seed:qr --prefix server
 *
 * Vì sao cần: đặt chỗ và vé tháng bình thường phải trả tiền qua PayOS mới thành 'confirmed' /
 * 'active'. Khi test luồng check-in bằng QR thì khâu đó chỉ tổ mất thời gian, nên script này
 * ghi thẳng bản ghi ở trạng thái ĐÃ THANH TOÁN.
 *
 * Chạy lại nhiều lần được: mỗi lần tự xoá bộ cũ (nhận diện theo dải biển số riêng) rồi tạo mới.
 * Đặt chỗ luôn có khung giờ bao quanh hiện tại nên check-in được ngay.
 */
import sequelize from '../src/config/db.js';
import {
  MonthlyPass,
  Reservation,
  ParkingSession,
  ParkingSlot,
  Payment,
  Floor,
  Zone,
  VehicleType,
  UserAccount,
} from '../src/models/index.js';
import { generateQrToken } from '../src/utils/qr.js';
import { validateAndNormalizePlateVN } from '../src/utils/plateVN.js';
import { getBookingFee } from '../src/utils/settings.js';

// Dải biển riêng để lần chạy sau nhận ra và dọn sạch, không đụng dữ liệu seed gốc.
const PASS_PLATES = ['88A-100.01', '88A-100.02', '88A-100.03'];
const RESV_PLATES = ['88B-200.01', '88B-200.02', '88B-200.03'];

const iso = (d) => d.toISOString().slice(0, 10);
const line = (n = 76) => '─'.repeat(n);

const run = async () => {
  await sequelize.authenticate();

  // ── Dọn bộ cũ ────────────────────────────────────────────────────────────
  const allPlates = [...PASS_PLATES, ...RESV_PLATES];
  const { Op } = await import('sequelize');
  // ...IfOccupied chứ không phải releaseSlot: xe đã quét CỔNG RA TẦNG thì chỗ đỗ đã được nhả
  // rồi (phiên vẫn 'active' tới khi trả tiền ở cổng tòa). Nhả lần nữa là ném lỗi và cả lệnh
  // seed chết giữa chừng.
  const { releaseSlotIfOccupied } = await import('../src/utils/slotSuggest.js');

  const stale = await ParkingSession.findAll({
    where: { plate_number: { [Op.in]: allPlates }, status: 'active' },
  });
  for (const s of stale) {
    // eslint-disable-next-line no-await-in-loop
    await sequelize.transaction(async (t) => {
      await releaseSlotIfOccupied(s.slot_id, t);
      await s.update({ status: 'exception', time_out: new Date(), calculated_fee: 0 }, { transaction: t });
    });
  }
  // Xoá bản ghi thanh toán của bộ cũ trước, không thì đơn bị xoá còn để lại payment mồ côi.
  const oldResv = await Reservation.findAll({
    where: { plate_number: { [Op.in]: RESV_PLATES } },
    attributes: ['reservation_id'],
  });
  if (oldResv.length) {
    await Payment.destroy({
      where: { reservation_id: { [Op.in]: oldResv.map((r) => r.reservation_id) } },
    });
  }
  await MonthlyPass.destroy({ where: { plate_number: { [Op.in]: PASS_PLATES } } });

  // Đơn nào ĐÃ có lượt gửi trỏ tới thì KHÔNG xoá — khoá ngoại là ON DELETE SET NULL, xoá đơn
  // là cắt đứt liên kết của những lượt đó: phiên vẫn ghi session_type='reservation' nhưng
  // reservation_id thành null, mất luôn đường tra "khách này đã trả phí giữ chỗ chưa" và
  // "có lố khung giờ đã đặt không". Chỉ hủy đơn (đủ để nó không nhận check-in nữa).
  const usedIds = (await ParkingSession.findAll({
    where: { plate_number: { [Op.in]: RESV_PLATES } },
    attributes: ['reservation_id'],
  })).map((s) => s.reservation_id).filter(Boolean);

  if (usedIds.length) {
    await Reservation.update(
      { status: 'cancelled' },
      { where: { reservation_id: { [Op.in]: usedIds } } },
    );
  }
  await Reservation.destroy({
    where: {
      plate_number: { [Op.in]: RESV_PLATES },
      ...(usedIds.length ? { reservation_id: { [Op.notIn]: usedIds } } : {}),
    },
  });

  // Đơn tới ca được job "khóa đầu ca" giữ sẵn 1 ô ở trạng thái 'reserved'. Hệ thống có đường
  // nhả ô đó khi đơn bị hủy / no-show, nhưng script này XOÁ THẲNG đơn nên không đi qua đường
  // ấy — ô bị kẹt 'reserved' vĩnh viễn và bãi cứ đầy dần dù chẳng có xe nào.
  // Ô 'reserved' mà không đơn nào trỏ tới thì theo định nghĩa là ô rò rỉ → trả về bãi.
  const reservedSlots = await ParkingSlot.findAll({ where: { status: 'reserved' } });
  if (reservedSlots.length) {
    const held = await Reservation.findAll({
      where: { slot_id: { [Op.in]: reservedSlots.map((s) => s.slot_id) } },
      attributes: ['slot_id'],
    });
    const heldIds = new Set(held.map((r) => r.slot_id));
    const orphans = reservedSlots.filter((s) => !heldIds.has(s.slot_id));
    if (orphans.length) {
      await ParkingSlot.update(
        { status: 'available' },
        { where: { slot_id: { [Op.in]: orphans.map((s) => s.slot_id) } } },
      );
      console.log(`Đã trả lại bãi ${orphans.length} chỗ bị kẹt "đang giữ" nhưng không đơn nào dùng.`);
    }
  }

  if (stale.length) console.log(`Đã dọn ${stale.length} phiên còn mở của bộ test cũ.\n`);

  // ── Dữ liệu nền ──────────────────────────────────────────────────────────
  const vt = await VehicleType.findOne();
  const floors = await Floor.findAll({ order: [['floor_id', 'ASC']] });
  const owner = await UserAccount.findOne({ where: { username: 'user' } });
  if (!vt || !floors.length || !owner) {
    throw new Error('Thiếu dữ liệu nền (loại xe / tầng / tài khoản user). Chạy npm run seed trước.');
  }

  // Vé tháng bị giới hạn suất mỗi khu -> chỉ đặt vào tầng còn suất, tránh tạo ra vé không dùng được.
  const zones = await Zone.findAll({ where: { vehicle_type_id: vt.vehicle_type_id } });
  const floorQuota = new Map();
  for (const z of zones) {
    const used = await MonthlyPass.count({
      where: { floor_id: z.floor_id, vehicle_type_id: vt.vehicle_type_id, status: 'active' },
    });
    floorQuota.set(z.floor_id, Math.max(0, (z.monthly_pass_capacity ?? 0) - used));
  }

  const bookingFee = getBookingFee();
  const today = new Date();
  const endDate = new Date(today.getTime() + 30 * 86400000);

  // ── 3 VÉ THÁNG ───────────────────────────────────────────────────────────
  const passes = [];
  for (const plate of PASS_PLATES) {
    const floorId = [...floorQuota.entries()].find(([, left]) => left > 0)?.[0];
    if (!floorId) {
      console.log(`⚠ Hết suất vé tháng — bỏ qua ${plate}. Manager tăng "suất vé tháng" của khu để tạo thêm.`);
      continue;
    }
    floorQuota.set(floorId, floorQuota.get(floorId) - 1);

    const p = await MonthlyPass.create({
      user_id: owner.user_id,
      vehicle_type_id: vt.vehicle_type_id,
      floor_id: floorId,
      plate_number: validateAndNormalizePlateVN(plate).normalized,
      valid_from_time: '00:00:00', // khung giờ cả ngày để test lúc nào cũng vào được
      valid_to_time: '23:59:59',
      start_date: iso(today),
      end_date: iso(endDate),
      status: 'active',
      qr_token: generateQrToken(),
    });
    passes.push({ ...p.get(), floorCode: floors.find((f) => f.floor_id === floorId)?.floor_code });
  }

  // ── 3 ĐẶT CHỖ ────────────────────────────────────────────────────────────
  // Khung giờ bắt đầu 30 phút TRƯỚC và kết thúc 4 tiếng SAU -> check-in được ngay.
  const resvs = [];
  for (let i = 0; i < RESV_PLATES.length; i += 1) {
    const floor = floors[i % floors.length];
    const r = await Reservation.create({
      user_id: owner.user_id,
      vehicle_type_id: vt.vehicle_type_id,
      floor_id: floor.floor_id,
      plate_number: validateAndNormalizePlateVN(RESV_PLATES[i]).normalized,
      start_time: new Date(Date.now() - 30 * 60000),
      end_time: new Date(Date.now() + 4 * 3600000),
      status: 'confirmed', // đã thanh toán — bỏ qua PayOS
      reservation_type: 'hourly',
      qr_token: generateQrToken(),
    });

    // Đơn thật luôn kèm một bản ghi thanh toán phí giữ chỗ (PayOS tạo lúc đặt, webhook đổi
    // sang 'success'). Bỏ qua PayOS mà quên luôn bản ghi này thì quầy thu tiền hiện "Phí giữ
    // chỗ đã trả: 0đ" — nhìn như hệ thống quên thu tiền của khách.
    await Payment.create({
      reservation_id: r.reservation_id,
      order_code: Date.now() * 1000 + i,
      amount: bookingFee,
      status: 'success',
      method: 'payos',
      paid_at: new Date(),
    });

    resvs.push({ ...r.get(), floorCode: floor.floor_code });
  }

  // ── In ra để copy ────────────────────────────────────────────────────────
  console.log(`\n${line()}`);
  console.log('VÉ THÁNG — dùng cả ngày, hạn 30 ngày');
  console.log(line());
  passes.forEach((p, i) => {
    console.log(`\n  ${i + 1}. Biển số : ${p.plate_number}   (tầng ${p.floorCode})`);
    console.log(`     Mã QR   : ${p.qr_token}`);
  });

  console.log(`\n${line()}`);
  console.log('ĐẶT CHỖ — đã thanh toán, khung giờ đang hiệu lực (còn ~4 tiếng)');
  console.log(line());
  resvs.forEach((r, i) => {
    const w = `${new Date(r.start_time).toLocaleTimeString('vi-VN')} → ${new Date(r.end_time).toLocaleTimeString('vi-VN')}`;
    console.log(`\n  ${i + 1}. Biển số : ${r.plate_number}   (tầng ${r.floorCode})`);
    console.log(`     Khung giờ: ${w}`);
    console.log(`     Mã QR   : ${r.qr_token}`);
  });

  console.log(`\n${line()}`);
  console.log('CÁCH DÙNG');
  console.log(line());
  console.log('  Quét QR ở quầy : Staff → Check-in (xe vào) → dán mã vào ô "Dán / quét mã QR"');
  console.log('  Nhập biển số   : gõ thẳng biển số vào ô Biển số — hệ thống tự nhận ra loại khách');
  console.log('  Quét ở kiosk   : /kiosk/gate, chọn cổng BLD-IN, dán mã');
  console.log('                   (nếu đang BẮT BUỘC ẢNH thì kiosk sẽ hướng khách qua quầy)');
  console.log('\n  Chạy lại lệnh này bất cứ lúc nào — bộ cũ tự bị dọn trước khi tạo mới.\n');
};

run()
  .catch((err) => {
    console.error('LỖI:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
