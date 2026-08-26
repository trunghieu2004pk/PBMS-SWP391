/**
 * DỮ LIỆU DEMO ĐA DẠNG — mỗi dòng là một TÌNH HUỐNG khác nhau, có cả ca ĐƯỢC VÀO lẫn ca BỊ CHẶN.
 *
 * Mẹo mô phỏng thời gian: không ngồi đợi 30 ngày cho vé hết hạn, mà ĐẶT NGÀY HẾT HẠN VÀO HÔM QUA.
 * Với hệ thống thì hai chuyện đó không khác gì nhau — nó chỉ so ngày.
 *
 * Chạy:  node scripts/seedDemoCases.js          tạo + tự kiểm từng ca
 *        node scripts/seedDemoCases.js --clean  xoá sạch
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';
import { Op } from 'sequelize';
import {
  Reservation, MonthlyPass, VehicleType, Floor, UserAccount, ParkingSession, Payment,
} from '../src/models/index.js';
import { refreshSettingsCache, getMaxParkingHours, getBookingFee } from '../src/utils/settings.js';
import { resolveCheckinQr } from '../src/services/session.service.js';
import { generateQrToken } from '../src/utils/qr.js';
import { releaseReservedSlot } from '../src/utils/slotSuggest.js';

const R_PLATE = '88B';
const P_PLATE = '88A';
const mins = (n) => new Date(Date.now() + n * 60000);
const days = (n) => new Date(Date.now() + n * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10);
const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
const hm = (d) => new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const wipe = async () => {
  const like = { [Op.or]: [{ [Op.like]: `${R_PLATE}%` }, { [Op.like]: `${P_PLATE}%` }] };
  const ses = await ParkingSession.findAll({ where: { plate_number: like } });
  const used = new Set(ses.map((s) => s.reservation_id).filter(Boolean));
  // Đơn đã có phiên thì KHÔNG xoá được (khoá ngoại) → đánh dấu huỷ. PHẢI nhả slot đang giữ,
  // không thì mỗi lần chạy lại script là bãi mất thêm vài chỗ (huỷ bằng update thẳng thì
  // không đi qua đường nhả chỗ của nghiệp vụ).
  if (used.size) {
    const held = await Reservation.findAll({ where: { reservation_id: { [Op.in]: [...used] } } });
    for (const h of held) {
      if (h.slot_id) await releaseReservedSlot(h.slot_id).catch(() => {});
      await h.update({ status: 'cancelled', slot_id: null });
    }
  }
  const r = await Reservation.destroy({ where: { plate_number: like, reservation_id: { [Op.notIn]: [...used, 0] } } });
  const p = await MonthlyPass.destroy({ where: { plate_number: like } });
  return { r, p };
};

const run = async () => {
  sequelize.options.logging = false;
  await sequelize.authenticate();
  await refreshSettingsCache();

  if (process.argv.includes('--clean')) {
    const { r, p } = await wipe();
    console.log(`\n  Đã xoá ${r} đơn · ${p} vé demo.\n`);
    await sequelize.close(); return;
  }

  await wipe();
  const vt = await VehicleType.findOne();
  const floors = await Floor.findAll({ order: [['floor_id', 'ASC']] });
  const owner = await UserAccount.findOne({ order: [['user_id', 'ASC']] });
  const F = (i) => floors[i % floors.length];
  const horizonH = getMaxParkingHours() ?? 24;

  const base = { user_id: owner.user_id, vehicle_type_id: vt.vehicle_type_id };

  /* ── ĐẶT CHỖ ────────────────────────────────────────────────────────────── */
  const RES = [
    { n: '01', label: 'ĐANG trong ca — vào được ngay', floor: F(0),
      start: mins(-30), end: mins(240), expect: null },
    { n: '02', label: `Còn 40 PHÚT nữa tới ca (trong tầm chặn ${horizonH}h)`, floor: F(1),
      start: mins(40), end: mins(280), expect: 'RESERVATION_NOT_OPEN' },
    { n: '03', label: 'Đặt cho TUẦN SAU (ngoài tầm chặn)', floor: F(2),
      start: days(7), end: new Date(days(7).getTime() + 4 * 3600000), expect: 'RESERVATION_NOT_OPEN' },
    { n: '04', label: 'ĐÃ HẾT ca (kết thúc 2h trước)', floor: F(0),
      start: mins(-360), end: mins(-120), expect: 'RESERVATION_EXPIRED' },
  ];
  const madeR = [];
  for (const c of RES) {
    const r = await Reservation.create({
      ...base, plate_number: `${R_PLATE}-200.${c.n}`, floor_id: c.floor.floor_id,
      status: 'confirmed', start_time: c.start, end_time: c.end, qr_token: generateQrToken(),
    });
    // Có bản ghi thanh toán phí giữ chỗ → quầy không hiện "đã trả: 0đ"
    await Payment.create({
      reservation_id: r.reservation_id, order_code: Date.now() * 1000 + Number(c.n),
      amount: getBookingFee(), status: 'success', method: 'payos', paid_at: new Date(),
    }).catch(() => {});
    madeR.push({ ...c, row: r });
  }

  /* ── VÉ THÁNG ───────────────────────────────────────────────────────────── */
  const now = new Date();
  const outFrom = new Date(now.getTime() + 3 * 3600000);
  const outTo = new Date(now.getTime() + 5 * 3600000);
  const PASS = [
    { n: '01', label: 'Hiệu lực, khung CẢ NGÀY — miễn phí trong khung', floor: F(0),
      from: '00:00:00', to: '23:59:00', sd: ymd(now), ed: ymd(days(30)), expect: null },
    { n: '02', label: `Hiệu lực nhưng NGOÀI khung giờ (khung ${clock(outFrom)}–${clock(outTo)})`, floor: F(1),
      from: clock(outFrom), to: clock(outTo), sd: ymd(now), ed: ymd(days(30)), expect: 'PASS_OUTSIDE_WINDOW' },
    { n: '03', label: '⭐ ĐÃ HẾT HẠN hôm qua (mô phỏng "sau 30 ngày") → rơi về VÃNG LAI', floor: F(0),
      from: '00:00:00', to: '23:59:00', sd: ymd(days(-31)), ed: ymd(days(-1)), expect: 'CONFLICT' },
  ];
  const madeP = [];
  for (const c of PASS) {
    const p = await MonthlyPass.create({
      ...base, plate_number: `${P_PLATE}-100.${c.n}`, floor_id: c.floor.floor_id,
      status: 'active', start_date: c.sd, end_date: c.ed, qr_token: generateQrToken(),
      valid_from_time: c.from, valid_to_time: c.to,
    });
    madeP.push({ ...c, row: p });
  }

  /* ── TỰ KIỂM: quét thử từng mã, đối chiếu với kỳ vọng ───────────────────── */
  const probe = async (token) => {
    try { const r = await resolveCheckinQr(token); return { code: null, msg: r.label }; }
    catch (e) { return { code: e.code || '?', msg: e.message }; }
  };
  const line = '─'.repeat(78);
  let bad = 0;

  console.log(`\n  Bây giờ: ${hm(now)}   ·   tầm chặn walk-in: ${horizonH}h\n`);
  console.log(line);
  console.log('  ĐẶT CHỖ');
  console.log(line);
  for (const c of madeR) {
    const got = await probe(c.row.qr_token);
    const good = got.code === c.expect; if (!good) bad += 1;
    console.log(`\n  ${good ? '✓' : '✗'}  ${R_PLATE}-200.${c.n}  ·  tầng ${c.floor.floor_code}  ·  ${c.label}`);
    console.log(`      ca: ${hm(c.start)} → ${hm(c.end)}`);
    console.log(`      quét QR: ${got.code ? `CHẶN — ${got.msg.slice(0, 82)}` : 'CHO VÀO — ' + got.msg}`);
    console.log(`      QR: ${c.row.qr_token}`);
  }
  console.log(`\n${line}`);
  console.log('  VÉ THÁNG');
  console.log(line);
  for (const c of madeP) {
    const got = await probe(c.row.qr_token);
    const good = got.code === c.expect; if (!good) bad += 1;
    console.log(`\n  ${good ? '✓' : '✗'}  ${P_PLATE}-100.${c.n}  ·  tầng ${c.floor.floor_code}  ·  ${c.label}`);
    console.log(`      hiệu lực: ${c.sd} → ${c.ed}   khung ${c.from.slice(0, 5)}–${c.to.slice(0, 5)}`);
    console.log(`      quét QR: ${got.code ? `CHẶN — ${got.msg.slice(0, 82)}` : 'CHO VÀO — ' + got.msg}`);
    console.log(`      QR: ${c.row.qr_token}`);
  }

  console.log(`\n${line}`);
  console.log('  GÕ TAY BIỂN SỐ (không dùng QR) — khác quét QR ở chỗ nào');
  console.log(line);
  console.log(`
   ${R_PLATE}-200.01   đang trong ca        → vào bãi theo ĐƠN (miễn phí giờ, đã trả phí giữ chỗ)
   ${R_PLATE}-200.02   còn 40 phút          → CHẶN, vì đơn nằm trong tầm ${horizonH}h
   ${R_PLATE}-200.03   tuần sau             → CHO VÀO diện VÃNG LAI, đơn tuần sau vẫn còn nguyên
   ${P_PLATE}-100.01   vé còn hạn, trong khung → miễn phí
   ${P_PLATE}-100.02   vé còn hạn, ngoài khung → vào được, tính tiền PHẦN NGOÀI KHUNG
   ${P_PLATE}-100.03   vé HẾT HẠN           → tính như KHÁCH VÃNG LAI (giá × số giờ)`);

  console.log(`\n${line}`);
  console.log(bad === 0
    ? '  Tất cả các ca hành xử ĐÚNG như mô tả.'
    : `  ⚠ ${bad} ca lệch so với kỳ vọng — xem lại trước khi demo.`);
  console.log(`${line}\n`);

  await sequelize.close();
};

run().catch(async (e) => { console.error('\nLỖI:', e.message, '\n'); await sequelize.close(); process.exit(1); });
