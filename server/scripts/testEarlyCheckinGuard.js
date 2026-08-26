/**
 * KIỂM CHỨNG — chặn quét QR khi CHƯA tới giờ ca / NGOÀI khung vé tháng.
 *
 * Bug gốc: resolveCheckinQr chỉ kiểm `status`, KHÔNG kiểm giờ. Nên quét QR đơn của ngày mai
 * vẫn lọt, form được điền sẵn như một lượt đặt chỗ, rồi checkin() không khớp được đơn
 * (chưa tới giờ) và lặng lẽ tạo phiên walk_in → khách đã trả phí giữ chỗ vẫn bị thu giá vãng lai.
 *
 * Script tự tạo dữ liệu thử, chạy 6 ca, rồi DỌN SẠCH.
 *
 * Chạy:  node scripts/testEarlyCheckinGuard.js
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';
import { Reservation, MonthlyPass, VehicleType, Floor, UserAccount } from '../src/models/index.js';
import { resolveCheckinQr, checkin } from '../src/services/session.service.js';
import { getMaxParkingHours } from '../src/utils/settings.js';

const MARK = 'ZZTEST';
const h = (n) => new Date(Date.now() + n * 3600 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

let pass = 0;
let fail = 0;

const check = async (label, token, expect) => {
  let got;
  try {
    const r = await resolveCheckinQr(token);
    got = { ok: true, code: null, msg: `nhận diện: ${r.label}` };
  } catch (e) {
    got = { ok: false, code: e.code || '?', msg: e.message };
  }
  const good = expect.ok === got.ok && (!expect.code || expect.code === got.code);
  if (good) pass += 1; else fail += 1;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        mong doi : ${expect.ok ? 'CHO QUA' : `CHAN (${expect.code})`}`);
  console.log(`        thuc te  : ${got.ok ? 'CHO QUA' : `CHAN (${got.code})`} — ${got.msg.slice(0, 110)}`);
  console.log('');
};

const run = async () => {
  await sequelize.authenticate();
  const vt = await VehicleType.findOne();
  const floor = await Floor.findOne();
  const owner = await UserAccount.findOne({ order: [['user_id', 'ASC']] });
  if (!vt || !floor || !owner) throw new Error('Thieu loai xe / tang / user trong DB');

  const now = new Date();
  const mk = (suffix, extra) => ({
    plate_number: `99Z-${suffix}`,
    user_id: owner.user_id,
    vehicle_type_id: vt.vehicle_type_id,
    floor_id: floor.floor_id,
    status: 'confirmed',
    qr_token: `${MARK}-${suffix}`,
    ...extra,
  });

  // ── Đơn đặt chỗ: 3 mốc thời gian ──────────────────────────────────────────
  await Reservation.bulkCreate([
    mk('001', { start_time: h(10), end_time: h(14) }), // NGÀY MAI  → phải CHẶN
    mk('002', { start_time: h(-1), end_time: h(3) }),  // ĐANG trong ca → cho qua
    mk('003', { start_time: h(-8), end_time: h(-4) }), // ĐÃ hết ca → phải CHẶN
  ]);

  // ── Vé tháng: trong khung vs ngoài khung ──────────────────────────────────
  const inFrom = new Date(now.getTime() - 3600 * 1000);
  const inTo = new Date(now.getTime() + 3600 * 1000);
  const outFrom = new Date(now.getTime() + 3 * 3600 * 1000);
  const outTo = new Date(now.getTime() + 5 * 3600 * 1000);
  const passBase = {
    user_id: owner.user_id,
    vehicle_type_id: vt.vehicle_type_id,
    floor_id: floor.floor_id,
    status: 'active',
    start_date: ymd(new Date(now.getTime() - 5 * 86400000)),
    end_date: ymd(new Date(now.getTime() + 25 * 86400000)),
  };
  await MonthlyPass.bulkCreate([
    { ...passBase, plate_number: '99Z-P01', qr_token: `${MARK}-P01`, valid_from_time: hhmm(inFrom), valid_to_time: hhmm(inTo) },
    { ...passBase, plate_number: '99Z-P02', qr_token: `${MARK}-P02`, valid_from_time: hhmm(outFrom), valid_to_time: hhmm(outTo) },
  ]);

  console.log(`\nBay gio: ${now.toLocaleString('vi-VN')}\n`);
  console.log('=== DAT CHO ===\n');
  await check('Don cua NGAY MAI (con 10 gio)', `${MARK}-001`, { ok: false, code: 'RESERVATION_NOT_OPEN' });
  await check('Don DANG trong ca', `${MARK}-002`, { ok: true });
  await check('Don DA HET ca (ket thuc 4 gio truoc)', `${MARK}-003`, { ok: false, code: 'RESERVATION_EXPIRED' });

  console.log('=== VE THANG ===\n');
  await check('Ve TRONG khung gio', `${MARK}-P01`, { ok: true });
  await check('Ve NGOAI khung gio (khung bat dau sau 3 gio nua)', `${MARK}-P02`, { ok: false, code: 'PASS_OUTSIDE_WINDOW' });

  console.log('=== QR RAC ===\n');
  await check('Token khong ton tai', `${MARK}-KHONGCO`, { ok: false });

  // ── Đường GÕ TAY biển số (không dùng QR) ──────────────────────────────────
  const horizonH = getMaxParkingHours() ?? 24;
  console.log(`=== GO TAY BIEN SO (tam chan = ${horizonH}h) ===\n`);

  const tryCheckin = async (label, plate, expectBlocked) => {
    let got;
    try {
      await checkin(owner.user_id, {
        plateNumber: plate,
        vehicleTypeId: vt.vehicle_type_id,
        floorId: floor.floor_id,
      });
      got = { blocked: false, code: null, msg: 'tao duoc phien walk-in' };
    } catch (e) {
      got = { blocked: true, code: e.code || '?', msg: e.message };
    }
    const good = got.blocked === expectBlocked
      && (!expectBlocked || got.code === 'RESERVATION_NOT_OPEN');
    if (good) pass += 1; else fail += 1;
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}`);
    console.log(`        mong doi : ${expectBlocked ? 'CHAN (RESERVATION_NOT_OPEN)' : 'cho vao vang lai'}`);
    console.log(`        thuc te  : ${got.blocked ? `CHAN (${got.code})` : 'CHO VAO'} — ${got.msg.slice(0, 100)}`);
    console.log('');
  };

  // Bien phai DUNG DINH DANG VN va khop loai xe — checkin() kiem ca hai (khac duong QR,
  // duong QR doc thang tu DB nen khong qua buoc nay).
  const { MOTORBIKE_TYPE_CODES } = await import('../src/utils/plateVN.js');
  const isBike = MOTORBIKE_TYPE_CODES.includes(vt.type_code);
  const plateA = isBike ? '99A1-2345' : '99A-123.45';
  const plateB = isBike ? '99A1-6789' : '99A-678.90';
  console.log(`  (loai xe thu: ${vt.type_code} -> dung bien ${plateA})
`);

  const inH = Math.max(1, horizonH - 1);
  await Reservation.create({ ...mk('004', { start_time: h(inH), end_time: h(horizonH + 2) }), plate_number: plateA });
  await tryCheckin(`Don bat dau sau ${inH}h (TRONG tam chan ${horizonH}h)`, plateA, true);

  await Reservation.create({ ...mk('005', { start_time: h(horizonH + 48), end_time: h(horizonH + 52) }), plate_number: plateB });
  await tryCheckin(`Don bat dau sau ${horizonH + 48}h (NGOAI tam chan)`, plateB, false);

  // ── Dọn sạch ───────────────────────────────────────────────────────────────
  const { Op } = await import('sequelize');
  const { ParkingSession } = await import('../src/models/index.js');
  const { releaseSlotIfOccupied } = await import('../src/utils/slotSuggest.js');
  // Phien do ca '99Z-005' tao ra: nha slot roi xoa, khong de lai rac
  const stray = await ParkingSession.findAll({ where: { plate_number: { [Op.like]: '99A%' } } });
  for (const s2 of stray) {
    if (s2.slot_id) await releaseSlotIfOccupied(s2.slot_id);
    await s2.destroy();
  }
  const rDel = await Reservation.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });
  const pDel = await MonthlyPass.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });

  console.log('─'.repeat(68));
  console.log(`  KET QUA: ${pass} pass / ${fail} fail   (xoa ${rDel} don + ${pDel} ve + ${stray.length} phien thu)`);
  console.log('─'.repeat(68) + '\n');

  await sequelize.close();
  if (fail > 0) process.exit(1);
};

run().catch(async (e) => { console.error('\nLOI:', e.message, '\n'); await sequelize.close(); process.exit(1); });
