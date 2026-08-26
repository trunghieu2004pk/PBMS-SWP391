/**
 * BỘ KIỂM TOÀN LUỒNG STAFF — chạy 1 lệnh, quét hết.
 *
 *   PHẦN 1  Vòng đời đầy đủ: check-in → ảnh vào → 3 cổng → ảnh ra → cổng ra → thu tiền
 *           (kiểm trạng thái DB SAU TỪNG BƯỚC, không tin vào lời hàm trả về)
 *   PHẦN 2  Các chốt chặn — những thứ BẮT BUỘC phải bị từ chối
 *   PHẦN 3  Bất biến dữ liệu — quét DB THẬT tìm trạng thái mâu thuẫn
 *
 * Tự tạo, tự đo, tự dọn. Dữ liệu thử dùng biển 99A-* nên không đụng dữ liệu demo.
 *
 * Chạy:  node scripts/auditStaffFlow.js
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';
import { Op } from 'sequelize';
import sharp from 'sharp';
import {
  Reservation, MonthlyPass, VehicleType, Floor, UserAccount,
  ParkingSession, ParkingSlot, Gate, SessionPhoto, Payment,
} from '../src/models/index.js';
import { refreshSettingsCache, getMaxParkingHours } from '../src/utils/settings.js';
import {
  checkin, resolveCheckinQr, previewCheckoutFee, cashCheckout,
  cancelEntryBeforeGate, correctSessionPlate,
} from '../src/services/session.service.js';
import { storeSessionPhoto, getPhotoProgress } from '../src/services/sessionPhoto.service.js';
import { scanGate } from '../src/services/gateScan.service.js';
import { releaseSlotIfOccupied } from '../src/utils/slotSuggest.js';
import { MOTORBIKE_TYPE_CODES } from '../src/utils/plateVN.js';

const MARK = 'AUDIT';
const hh = (n) => new Date(Date.now() + n * 3600 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10);
const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

let pass = 0; let fail = 0; const failures = [];
const L = (s = '') => console.log(s);
const ok = (cond, label, detail = '') => {
  if (cond) pass += 1; else { fail += 1; failures.push(label); }
  L(`  ${cond ? '✓' : '✗ FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** Ảnh thử: mỗi góc một bố cục khác hẳn để không bị dHash chặn trùng. */
const KINDS = ['front', 'left', 'rear', 'right', 'driver'];
const photoBuf = async (kind, salt) => {
  const i = KINDS.indexOf(kind);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <rect width="640" height="480" fill="#111"/>
    <rect x="${i * 110}" y="${i * 70}" width="${180 + i * 40}" height="${300 - i * 40}" fill="#eee"/>
    <circle cx="${560 - i * 90}" cy="${400 - i * 60}" r="${40 + i * 18}" fill="#888"/>
    <text x="20" y="460" font-size="34" fill="#fff">${kind}-${salt}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
};
const upload = (sessionId, phase, kind, actorId, salt) => async () => storeSessionPhoto(
  actorId, sessionId, { phase, kind, capturedAt: new Date().toISOString() },
  { buffer: await photoBuf(kind, salt), mimetype: 'image/jpeg', originalname: `${kind}.jpg` },
);
const uploadAll = async (sessionId, phase, actorId, salt) => {
  for (const k of KINDS) await (upload(sessionId, phase, k, actorId, salt))();
};

/** Chạy 1 việc, trả về mã lỗi nếu bị chặn (null nếu qua). */
const codeOf = async (fn) => {
  try { await fn(); return null; } catch (e) { return e.code || e.message.slice(0, 40); }
};
/** Dọn sạch dữ liệu thử của lần chạy trước (kể cả lần bị lỗi giữa chừng). */
const wipe = async () => {
  const rows = await ParkingSession.findAll({ where: { plate_number: { [Op.like]: '99A%' } } });
  for (const s of rows) {
    await SessionPhoto.destroy({ where: { session_id: s.session_id } });
    await Payment.destroy({ where: { session_id: s.session_id } });
    if (s.slot_id) await releaseSlotIfOccupied(s.slot_id);
    await s.destroy();
  }
  const r = await Reservation.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });
  const p = await MonthlyPass.destroy({ where: { qr_token: { [Op.like]: `${MARK}-%` } } });
  return { s: rows.length, r, p };
};

/** Đọc lại phiên TỪ DB — không tin object trả về. */
const fresh = (id) => ParkingSession.findByPk(id);
const slotOf = (id) => ParkingSlot.findByPk(id);

const run = async () => {
  sequelize.options.logging = false;   // tắt log SQL cho màn hình sạch khi demo
  await sequelize.authenticate();
  await refreshSettingsCache();
  const pre = await wipe();
  if (pre.s || pre.r || pre.p) console.log(`  (dọn rác lần chạy trước: ${pre.s} phiên · ${pre.r} đơn · ${pre.p} vé)`);

  const vt = await VehicleType.findOne();
  const floor = await Floor.findOne({ order: [['floor_id', 'ASC']] });
  const staff = await UserAccount.findOne({ order: [['user_id', 'ASC']] });
  const gBldIn = await Gate.findOne({ where: { floor_id: null, direction: 'in' } });
  const gBldOut = await Gate.findOne({ where: { floor_id: null, direction: 'out' } });
  const gFlIn = await Gate.findOne({ where: { floor_id: floor.floor_id, direction: 'in' } });
  const gFlOut = await Gate.findOne({ where: { floor_id: floor.floor_id, direction: 'out' } });
  if (!gBldIn || !gBldOut || !gFlIn || !gFlOut) throw new Error('Thiếu cổng toà/tầng trong DB');

  const isBike = MOTORBIKE_TYPE_CODES.includes(vt.type_code);
  const P = (n) => (isBike ? `99A${n}-1234` : `99A-1${String(n).padStart(2, '0')}.11`);

  L(`\n  ${new Date().toLocaleString('vi-VN')}  ·  loại xe ${vt.type_code}  ·  tầng ${floor.floor_code}`);
  L(`  max_parking_hours: ${getMaxParkingHours() ?? 'không giới hạn'}\n`);

  /* ══════════ PHẦN 1 — VÒNG ĐỜI ĐẦY ĐỦ ══════════ */
  L('═══ PHẦN 1 · VÒNG ĐỜI ĐẦY ĐỦ (kiểm DB sau từng bước) ═══\n');
  let sid; let slotId;
  {
    const s = await checkin(staff.user_id, { plateNumber: P(1), vehicleTypeId: vt.vehicle_type_id, floorId: floor.floor_id });
    sid = s.session_id; slotId = s.slot_id;
    // Lui gio VAO 2 tieng: ca vong doi nay chay trong <1 giay, de nguyen thi time_out (mốc rời
    // tầng) trùng time_in và chốt DV-04 chặn. Ngoài đời xe không vào-ra trong cùng một giây.
    await ParkingSession.update({ time_in: hh(-2) }, { where: { session_id: sid } });
    const db = await fresh(sid); const sl = await slotOf(slotId);
    ok(db.status === 'active' && db.gate_stage === 'checked_in', '1. Check-in → active / checked_in', `${db.status}/${db.gate_stage}`);
    ok(sl.status === 'occupied', '   slot → occupied', sl.status);
    ok(db.calculated_fee == null, '   calculated_fee → null (chưa biết)', String(db.calculated_fee));
  }
  {
    const code = await codeOf(async () => scanGate({ qrToken: (await fresh(sid)).qr_token, gateId: gBldIn.gate_id }));
    ok(code != null, '2. Qua cổng toà khi CHƯA đủ ảnh → phải CHẶN', code || 'LỌT!');
  }
  {
    await uploadAll(sid, 'entry', staff.user_id, 'e');
    const pr = await getPhotoProgress(sid, 'entry');
    ok(pr.complete && pr.captured === 5, '3. Chụp đủ 5 ảnh VÀO', `${pr.captured}/${pr.total}`);
    const db = await fresh(sid);
    ok(db.gate_stage === 'checked_in', '   chụp ảnh KHÔNG đổi gate_stage', db.gate_stage);
  }
  {
    await scanGate({ qrToken: (await fresh(sid)).qr_token, gateId: gBldIn.gate_id });
    ok((await fresh(sid)).gate_stage === 'in_building', '4. Cổng toà IN → in_building');
    await scanGate({ qrToken: (await fresh(sid)).qr_token, gateId: gFlIn.gate_id });
    ok((await fresh(sid)).gate_stage === 'on_floor', '5. Cổng tầng IN → on_floor');
  }
  {
    await scanGate({ qrToken: (await fresh(sid)).qr_token, gateId: gFlOut.gate_id });
    const db = await fresh(sid); const sl = await slotOf(slotId);
    ok(db.gate_stage === 'left_floor', '6. Cổng tầng OUT → left_floor', db.gate_stage);
    ok(sl.status === 'available', '   ⭐ slot NHẢ NGAY, không đợi trả tiền', sl.status);
    ok(db.status === 'active', '   phiên vẫn active (chưa thanh toán)', db.status);
  }
  {
    const code = await codeOf(async () => scanGate({ qrToken: (await fresh(sid)).qr_token, gateId: gBldOut.gate_id }));
    ok(code != null, '7. Cổng toà OUT khi CHƯA đủ ảnh RA → phải CHẶN', code || 'LỌT!');
  }
  {
    await uploadAll(sid, 'exit', staff.user_id, 'x');
    const pr = await getPhotoProgress(sid, 'exit');
    ok(pr.complete, '8. Chụp đủ 5 ảnh RA', `${pr.captured}/${pr.total}`);
  }
  {
    const prev = await previewCheckoutFee({ sessionId: sid });
    ok(prev.fee >= 0, '9. Tính trước phí', `${Number(prev.fee).toLocaleString('vi-VN')}đ`);
    const db = await fresh(sid);
    ok(db.status === 'active', '   ⭐ preview KHÔNG ghi gì vào DB', db.status);
  }
  {
    await cashCheckout(staff.user_id, { sessionId: sid });
    const db = await fresh(sid); const sl = await slotOf(slotId);
    ok(db.status === 'completed', '10. Thu tiền mặt → completed', db.status);
    ok(db.gate_stage === 'exited', '    gate_stage → exited', db.gate_stage);
    ok(db.time_out != null, '    time_out được ghi');
    ok(sl.status === 'available', '    slot vẫn available', sl.status);
    const pay = await Payment.findOne({ where: { session_id: sid } });
    ok(pay && pay.status === 'success', '    có bản ghi thanh toán success', pay?.status);
  }
  L('');

  /* ══════════ PHẦN 2 — CÁC CHỐT CHẶN ══════════ */
  L('═══ PHẦN 2 · CÁC CHỐT CHẶN (phải bị từ chối) ═══\n');
  {
    const s = await checkin(staff.user_id, { plateNumber: P(2), vehicleTypeId: vt.vehicle_type_id, floorId: floor.floor_id });
    const code = await codeOf(() => checkin(staff.user_id, { plateNumber: P(2), vehicleTypeId: vt.vehicle_type_id, floorId: floor.floor_id }));
    ok(code != null, 'Check-in TRÙNG biển đang gửi', code || 'LỌT!');

    const c2 = await codeOf(() => cashCheckout(staff.user_id, { sessionId: s.session_id }));
    ok(c2 != null, 'Thu tiền khi xe CHƯA vào bãi (checked_in)', c2 || 'LỌT!');

    await uploadAll(s.session_id, 'entry', staff.user_id, 'a');
    await scanGate({ qrToken: (await fresh(s.session_id)).qr_token, gateId: gBldIn.gate_id });
    const c3 = await codeOf(() => cancelEntryBeforeGate(staff.user_id, s.session_id, 'thử'));
    ok(c3 != null, 'Huỷ phiên SAU khi đã qua cổng', c3 || 'LỌT!');

    const c4 = await codeOf(() => cashCheckout(staff.user_id, { sessionId: s.session_id }));
    ok(c4 != null, 'Thu tiền khi CHƯA đủ ảnh RA', c4 || 'LỌT!');

    // Ảnh RA đầu tiên → khoá ảnh VÀO
    await (upload(s.session_id, 'exit', 'front', staff.user_id, 'z'))();
    const c5 = await codeOf(upload(s.session_id, 'entry', 'left', staff.user_id, 'q'));
    ok(c5 != null, '⭐ Thêm ảnh VÀO sau khi đã chụp ảnh RA', c5 || 'LỌT!');

    // dHash: dùng CÙNG một ảnh cho góc khác
    const same = await photoBuf('front', 'z');
    const c6 = await codeOf(() => storeSessionPhoto(staff.user_id, s.session_id,
      { phase: 'exit', kind: 'rear', capturedAt: new Date().toISOString() },
      { buffer: same, mimetype: 'image/jpeg', originalname: 'x.jpg' }));
    ok(c6 != null, '⭐ Dùng LẠI cùng một ảnh cho góc khác (dHash)', c6 || 'LỌT!');
  }
  {
    const c = await codeOf(() => checkin(staff.user_id, { plateNumber: 'XX-9999', vehicleTypeId: vt.vehicle_type_id, floorId: floor.floor_id }));
    ok(c != null, 'Biển số sai định dạng', c || 'LỌT!');
  }
  {
    await Reservation.create({
      plate_number: P(3), user_id: staff.user_id, vehicle_type_id: vt.vehicle_type_id,
      floor_id: floor.floor_id, status: 'confirmed', qr_token: `${MARK}-R1`,
      start_time: hh(6), end_time: hh(10),
    });
    ok(await codeOf(() => resolveCheckinQr(`${MARK}-R1`)) === 'RESERVATION_NOT_OPEN', 'Quét QR đơn CHƯA tới giờ');
    await Reservation.create({
      plate_number: P(4), user_id: staff.user_id, vehicle_type_id: vt.vehicle_type_id,
      floor_id: floor.floor_id, status: 'confirmed', qr_token: `${MARK}-R2`,
      start_time: hh(-9), end_time: hh(-5),
    });
    ok(await codeOf(() => resolveCheckinQr(`${MARK}-R2`)) === 'RESERVATION_EXPIRED', 'Quét QR đơn ĐÃ hết ca');
  }
  {
    const base = {
      user_id: staff.user_id, vehicle_type_id: vt.vehicle_type_id, floor_id: floor.floor_id,
      status: 'active', start_date: ymd(hh(-120)), end_date: ymd(hh(600)),
    };
    await MonthlyPass.create({ ...base, plate_number: P(5), qr_token: `${MARK}-P1`, valid_from_time: clock(hh(3)), valid_to_time: clock(hh(5)) });
    ok(await codeOf(() => resolveCheckinQr(`${MARK}-P1`)) === 'PASS_OUTSIDE_WINDOW', 'Quét QR vé NGOÀI khung giờ');

    const other = await Floor.findOne({ where: { floor_id: { [Op.ne]: floor.floor_id } } });
    if (other) {
      await MonthlyPass.create({ ...base, plate_number: P(6), floor_id: other.floor_id, qr_token: `${MARK}-P2`, valid_from_time: '00:00:00', valid_to_time: '23:59:00' });
      const c = await codeOf(() => checkin(staff.user_id, { plateNumber: P(6), vehicleTypeId: vt.vehicle_type_id, floorId: floor.floor_id }));
      ok(c === 'PASS_WRONG_FLOOR', 'Vé tháng check-in SAI TẦNG', c || 'LỌT!');
    }
  }
  {
    const c = await codeOf(() => resolveCheckinQr('khong-ton-tai-gi-ca'));
    ok(c != null, 'QR không tồn tại', c);
    const c2 = await codeOf(() => resolveCheckinQr('revoked-abc'));
    ok(c2 != null, 'QR đã bị thu hồi', c2);
  }
  L('');

  /* ══════════ PHẦN 3 — BẤT BIẾN DỮ LIỆU THẬT ══════════ */
  L('═══ PHẦN 3 · QUÉT DB THẬT — tìm trạng thái mâu thuẫn ═══\n');
  {
    const [a] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_session s JOIN parking_slot p ON p.slot_id = s.slot_id
      WHERE s.status='active' AND s.gate_stage IN ('checked_in','in_building','on_floor')
        AND p.status <> 'occupied'`);
    ok(Number(a[0].c) === 0, 'Phiên đang giữ chỗ mà slot KHÔNG occupied', `${a[0].c} dòng`);

    const [b] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_session s JOIN parking_slot p ON p.slot_id = s.slot_id
      WHERE s.status IN ('completed','exception') AND p.status='occupied'
        AND NOT EXISTS (SELECT 1 FROM parking_session s2
                        WHERE s2.slot_id=s.slot_id AND s2.status='active')`);
    ok(Number(b[0].c) === 0, 'Phiên đã đóng mà slot vẫn occupied (rác)', `${b[0].c} dòng`);

    const [c] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_session
      WHERE status='active' AND gate_stage='exited'`);
    ok(Number(c[0].c) === 0, 'Phiên active mà gate_stage=exited (mâu thuẫn)', `${c[0].c} dòng`);

    const [d] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_session
      WHERE status='completed' AND (time_out IS NULL OR calculated_fee IS NULL)`);
    ok(Number(d[0].c) === 0, 'Phiên completed mà thiếu time_out / phí', `${d[0].c} dòng`);

    const [e] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_session s
      WHERE s.status='active' AND EXISTS (
        SELECT 1 FROM parking_session s2 WHERE s2.plate_number=s.plate_number
        AND s2.status='active' AND s2.session_id<>s.session_id)`);
    ok(Number(e[0].c) === 0, '⭐ Một biển số có >1 phiên đang gửi', `${e[0].c} dòng`);

    const [f] = await sequelize.query(`
      SELECT COUNT(*) c FROM reservation r WHERE r.status='checked_in'
        AND NOT EXISTS (SELECT 1 FROM parking_session s WHERE s.reservation_id=r.reservation_id)`);
    ok(Number(f[0].c) === 0, 'Đơn checked_in mà không có phiên nào', `${f[0].c} dòng`);

    const [g] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_slot WHERE status='occupied'
        AND NOT EXISTS (SELECT 1 FROM parking_session s
                        WHERE s.slot_id=parking_slot.slot_id AND s.status='active')`);
    ok(Number(g[0].c) === 0, 'Slot occupied mà không phiên nào giữ (rò chỗ)', `${g[0].c} dòng`);

    const [i] = await sequelize.query(`
      SELECT COUNT(*) c FROM session_photo WHERE file_path IS NULL OR sha256_stored IS NULL`);
    ok(Number(i[0].c) === 0, 'Ảnh thiếu đường dẫn / mã băm', `${i[0].c} dòng`);

    // Đơn đã đóng mà còn ôm slot = RÒ SỨC CHỨA: chỗ đó không ai vào được mà cũng không ai giữ.
    // Bản kiểm đầu bỏ sót loại này vì chỉ soi slot 'occupied', trong khi đơn giữ chỗ để 'reserved'.
    // CHỈ soi 'cancelled' và 'no_show' — hai ca đó nhả chỗ mà quên xoá slot_id là RÒ THẬT.
    // 'completed' thì KHÁC: đơn dùng xong vẫn giữ slot_id làm DẤU VẾT "xe đã đỗ ô nào",
    // còn bản thân ô đã được nhả và có thể đang phục vụ xe khác. Soi luôn 'completed' là báo oan.
    const [j] = await sequelize.query(`
      SELECT COUNT(*) c FROM reservation r
      WHERE r.slot_id IS NOT NULL AND r.status IN ('cancelled','no_show')`);
    ok(Number(j[0].c) === 0, '⭐ Đơn huỷ/no-show mà vẫn giữ chỗ (rò sức chứa)', `${j[0].c} dòng`);

    const [k] = await sequelize.query(`
      SELECT COUNT(*) c FROM parking_slot p WHERE p.status='reserved'
        AND NOT EXISTS (SELECT 1 FROM reservation r
                        WHERE r.slot_id=p.slot_id AND r.status='confirmed')`);
    ok(Number(k[0].c) === 0, 'Slot reserved mà không đơn nào đang giữ', `${k[0].c} dòng`);
  }
  L('');

  /* ══════════ DỌN ══════════ */
  const done = await wipe();

  L('─'.repeat(74));
  L(`  ${pass} ĐẠT / ${fail} HỎNG      (dọn ${done.s} phiên · ${done.r} đơn · ${done.p} vé)`);
  if (fail) { L(''); L('  CẦN XEM:'); failures.forEach((f) => L(`    ✗ ${f}`)); }
  L('─'.repeat(74) + '\n');

  await sequelize.close();
  if (fail > 0) process.exit(1);
};

run().catch(async (e) => { console.error('\nLỖI:', e.message, '\n', e.stack); await sequelize.close(); process.exit(1); });
