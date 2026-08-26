/**
 * E2E — 3 LUỒNG CHECK-IN + tính tiền lúc ra.
 *
 * Sinh ra sau hai bug lọt tới sát ngày chấm, cả hai đều CHỈ HIỆN KHI LỆCH GIỜ nên test ban ngày
 * không bao giờ gặp:
 *   1. Quét QR đơn của NGÀY MAI vẫn lọt → phiên thành walk_in → khách trả phí giữ chỗ vẫn bị
 *      thu giá vãng lai.
 *   2. Vé tháng VÀO ngoài khung giờ thì mất luôn pass_id → lúc ra thu vãng lai TRỌN lượt,
 *      kể cả những giờ nằm TRONG khung khách đã trả tiền cả tháng.
 *
 * Nên script tự dựng mốc thời gian thay vì chờ tới giờ đó. Tự tạo, tự đo, tự dọn.
 *
 * Chạy:  node scripts/testCheckinE2E.js
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';
import { Op } from 'sequelize';
import {
  Reservation, MonthlyPass, VehicleType, Floor, UserAccount, ParkingSession,
} from '../src/models/index.js';
import { refreshSettingsCache, getMaxParkingHours } from '../src/utils/settings.js';
import { resolveCheckinQr, checkin, previewCheckoutFee } from '../src/services/session.service.js';
import { billableMinutesUnderPass } from '../src/utils/passWindow.js';
import { releaseSlotIfOccupied } from '../src/utils/slotSuggest.js';
import { MOTORBIKE_TYPE_CODES } from '../src/utils/plateVN.js';

const MARK = 'E2ETEST';
const h = (n) => new Date(Date.now() + n * 3600 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;

let pass = 0;
let fail = 0;
const line = (s = '') => console.log(s);

const ok = (cond, label, detail) => {
  if (cond) pass += 1; else fail += 1;
  line(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) line(`        ${detail}`);
};

/** Quét QR: mong đợi chặn với đúng mã lỗi, hoặc cho qua. */
const scanQr = async (label, token, expectCode) => {
  let got;
  try {
    const r = await resolveCheckinQr(token);
    got = { code: null, msg: `nhận diện ${r.label}` };
  } catch (e) {
    got = { code: e.code || '?', msg: e.message };
  }
  ok(got.code === expectCode, label,
    `mong: ${expectCode || 'CHO QUA'}  |  thực: ${got.code || 'CHO QUA'} — ${got.msg.slice(0, 78)}`);
};

/** Check-in ở quầy: trả về phiên, hoặc mã lỗi nếu bị chặn. */
const doCheckin = async (staffId, plate, vtId, floorId) => {
  try {
    return { session: await checkin(staffId, { plateNumber: plate, vehicleTypeId: vtId, floorId }) };
  } catch (e) {
    return { code: e.code || '?', msg: e.message };
  }
};

const run = async () => {
  await sequelize.authenticate();
  await refreshSettingsCache();          // BẮT BUỘC — không nạp thì getMaxParkingHours() đọc .env, sai thật tế

  const vt = await VehicleType.findOne();
  const floor = await Floor.findOne();
  const owner = await UserAccount.findOne({ order: [['user_id', 'ASC']] });
  if (!vt || !floor || !owner) throw new Error('Thiếu loại xe / tầng / user trong DB');

  const isBike = MOTORBIKE_TYPE_CODES.includes(vt.type_code);
  const P = (n) => (isBike ? `99A${n}-1234` : `99A-11${n}.11`);
  const horizonH = getMaxParkingHours() ?? 24;

  line(`\n  Bây giờ: ${new Date().toLocaleString('vi-VN')}`);
  line(`  Loại xe thử: ${vt.type_code} · tầm chặn đặt chỗ: ${horizonH}h · max_parking_hours: ${getMaxParkingHours() ?? 'không giới hạn'}\n`);

  const resv = (n, extra) => Reservation.create({
    plate_number: P(n), user_id: owner.user_id, vehicle_type_id: vt.vehicle_type_id,
    floor_id: floor.floor_id, status: 'confirmed', qr_token: `${MARK}-R${n}`, ...extra,
  });
  const mkPass = (n, from, to) => MonthlyPass.create({
    plate_number: P(n), user_id: owner.user_id, vehicle_type_id: vt.vehicle_type_id,
    floor_id: floor.floor_id, status: 'active', qr_token: `${MARK}-P${n}`,
    start_date: ymd(h(-120)), end_date: ymd(h(600)),
    valid_from_time: from, valid_to_time: to,
  });

  /* ═══ LUỒNG 1 — VÃNG LAI ═══════════════════════════════════════════════ */
  line('═══ LUỒNG 1 · KHÁCH VÃNG LAI ═══\n');
  {
    const r = await doCheckin(owner.user_id, P(1), vt.vehicle_type_id, floor.floor_id);
    ok(!r.code, 'Check-in vãng lai bình thường', r.code ? r.msg : `phiên #${r.session.session_id}`);
    if (r.session) {
      ok(r.session.session_type === 'walk_in', 'session_type = walk_in', `thực: ${r.session.session_type}`);
      ok(r.session.gate_stage === 'checked_in', "gate_stage = checked_in (CHƯA vào bãi)", `thực: ${r.session.gate_stage}`);
      ok(r.session.calculated_fee == null, 'calculated_fee = null (chưa biết đỗ bao lâu)', `thực: ${r.session.calculated_fee}`);
    }
  }
  line('');

  /* ═══ LUỒNG 2 — ĐẶT CHỖ ════════════════════════════════════════════════ */
  line('═══ LUỒNG 2 · ĐẶT CHỖ ═══\n');
  await resv(2, { start_time: h(-1), end_time: h(3) });                       // đang trong ca
  await resv(3, { start_time: h(Math.max(1, horizonH - 2)), end_time: h(horizonH + 2) }); // chưa tới giờ, TRONG tầm chặn
  await resv(4, { start_time: h(-9), end_time: h(-5) });                       // đã hết ca

  await scanQr('Quét QR — đơn ĐANG trong ca', `${MARK}-R2`, null);
  await scanQr('Quét QR — đơn CHƯA tới giờ', `${MARK}-R3`, 'RESERVATION_NOT_OPEN');
  await scanQr('Quét QR — đơn ĐÃ hết ca', `${MARK}-R4`, 'RESERVATION_EXPIRED');

  {
    const r = await doCheckin(owner.user_id, P(3), vt.vehicle_type_id, floor.floor_id);
    ok(r.code === 'RESERVATION_NOT_OPEN', 'Gõ tay biển có đơn chưa tới giờ → CHẶN',
      `thực: ${r.code || 'CHO VÀO'} — bịt luôn đường vòng qua ô nhập tay`);
  }
  {
    const r = await doCheckin(owner.user_id, P(2), vt.vehicle_type_id, floor.floor_id);
    const linked = r.session?.reservation_id != null;
    ok(linked, 'Gõ tay biển có đơn ĐANG trong ca → gắn vào đơn, KHÔNG thành walk_in',
      r.code ? r.msg : `session_type=${r.session.session_type} · reservation_id=${r.session.reservation_id}`);
  }
  line('');

  /* ═══ LUỒNG 3 — VÉ THÁNG ═══════════════════════════════════════════════ */
  line('═══ LUỒNG 3 · VÉ THÁNG ═══\n');
  await mkPass(5, hhmm(h(-2)), hhmm(h(2)));   // ĐANG trong khung
  await mkPass(6, hhmm(h(3)), hhmm(h(5)));    // NGOÀI khung (khung mở sau 3h nữa)

  await scanQr('Quét QR — vé TRONG khung', `${MARK}-P5`, null);
  await scanQr('Quét QR — vé NGOÀI khung', `${MARK}-P6`, 'PASS_OUTSIDE_WINDOW');

  {
    const r = await doCheckin(owner.user_id, P(5), vt.vehicle_type_id, floor.floor_id);
    ok(r.session?.session_type === 'monthly_pass', 'Vào TRONG khung → session_type = monthly_pass',
      r.code ? r.msg : `pass_id=${r.session.pass_id} · fee=${r.session.calculated_fee}`);
    ok(r.session?.calculated_fee === 0 || Number(r.session?.calculated_fee) === 0,
      'Vào TRONG khung → calculated_fee = 0 (miễn phí)', `thực: ${r.session?.calculated_fee}`);
  }
  {
    const r = await doCheckin(owner.user_id, P(6), vt.vehicle_type_id, floor.floor_id);
    ok(r.session?.pass_id != null, '⭐ Vào NGOÀI khung → VẪN gắn pass_id (không rơi về walk_in)',
      r.code ? r.msg : `session_type=${r.session.session_type} · pass_id=${r.session.pass_id}`);
    ok(r.session?.calculated_fee == null, 'Vào NGOÀI khung → calculated_fee = null (chưa biết, KHÔNG phải 0đ)',
      `thực: ${r.session?.calculated_fee}`);

    if (r.session) {
      const prev = await previewCheckoutFee({ sessionId: r.session.session_id });
      const p = await MonthlyPass.findByPk(r.session.pass_id);
      const mins = billableMinutesUnderPass(p, r.session.time_in, new Date());
      ok(prev.session != null, 'Lúc ra: previewCheckoutFee VẪN nhìn thấy vé tháng',
        `phí ${money(prev.fee)} · số phút ngoài khung = ${Math.round(mins)}`);
    }
  }
  line('');

  /* ═══ DỌN ══════════════════════════════════════════════════════════════ */
  const stray = await ParkingSession.findAll({ where: { plate_number: { [Op.like]: '99A%' } } });
  for (const s of stray) {
    if (s.slot_id) await releaseSlotIfOccupied(s.slot_id);
    await s.destroy();
  }
  const rDel = await Reservation.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });
  const pDel = await MonthlyPass.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });

  line('─'.repeat(72));
  line(`  ${pass} PASS / ${fail} FAIL      (đã xoá ${stray.length} phiên · ${rDel} đơn · ${pDel} vé)`);
  line('─'.repeat(72) + '\n');

  await sequelize.close();
  if (fail > 0) process.exit(1);
};

run().catch(async (e) => { console.error('\nLỖI:', e.message, '\n', e.stack); await sequelize.close(); process.exit(1); });
