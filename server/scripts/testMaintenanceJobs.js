/**
 * Kiểm tra 2 job nền của luồng ảnh hiện trạng, dùng DB thật.
 * Chạy: npm run test:jobs --prefix server
 *
 * Tự dựng dữ liệu, chạy job, kiểm kết quả, rồi DỌN SẠCH những gì mình tạo ra.
 */
import sequelize from '../src/config/db.js';
import {
  ParkingSession,
  SessionPhoto,
  Incident,
  ParkingSlot,
  VehicleType,
  UserAccount,
} from '../src/models/index.js';
import { runSessionMaintenance } from '../src/jobs/sessionMaintenance.job.js';
import { runPhotoRetention } from '../src/jobs/photoRetention.job.js';
import { generateQrToken } from '../src/utils/qr.js';

const created = { sessions: [], photos: [], incidents: [] };
const ok = (cond, msg) => console.log(`   ${cond ? '✓' : '✗ SAI —'} ${msg}`);

/** Tạo phiên active giả với giờ check-in lùi về quá khứ. */
const makeSession = async ({ plate, minutesAgo, gateStage = 'checked_in' }) => {
  const slot = await ParkingSlot.findOne({ where: { status: 'available' } });
  const vt = await VehicleType.findOne();
  const staff = await UserAccount.findOne({ where: { username: 'staff' } });
  const timeIn = new Date(Date.now() - minutesAgo * 60 * 1000);
  const s = await ParkingSession.create({
    gate_id: 1,
    slot_id: slot.slot_id,
    vehicle_type_id: vt.vehicle_type_id,
    plate_number: plate,
    time_in: timeIn,
    gate_stage: gateStage,
    qr_token: generateQrToken(),
    check_in_by: staff.user_id,
    session_type: 'walk_in',
    status: 'active',
  });
  await slot.update({ status: 'occupied' });
  created.sessions.push(s.session_id);
  return s;
};

const makePhoto = async (sessionId, kind, daysAgo) => {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const p = await SessionPhoto.create({
    session_id: sessionId,
    phase: 'entry',
    kind,
    seq: 1,
    file_path: `sessions/test/${sessionId}-${kind}.jpg`, // tệp không tồn tại — job bỏ qua lặng lẽ
    sha256_raw: 'a'.repeat(64),
    sha256_stored: 'b'.repeat(64),
    source: 'upload',
    mime: 'image/jpeg',
    bytes: 1,
    captured_at: at,
    received_at: at,
  });
  // created_at do Sequelize tự quản — update thường KHÔNG ghi đè được, phải dùng SQL thô,
  // nếu không thì ảnh "cũ 200 ngày" vẫn mang created_at = bây giờ và job coi là còn hạn.
  await sequelize.query('UPDATE session_photo SET created_at = ? WHERE photo_id = ?', {
    replacements: [at, p.photo_id],
  });
  created.photos.push(p.photo_id);
  return p;
};

const run = async () => {
  await sequelize.authenticate();

  console.log('\n=== JOB 1: dọn phiên treo ở cổng vào ===');
  const oldStuck = await makeSession({ plate: '99Z-00001', minutesAgo: 90 });
  const freshStuck = await makeSession({ plate: '99Z-00002', minutesAgo: 5 });
  const enteredOld = await makeSession({
    plate: '99Z-00003',
    minutesAgo: 300,
    gateStage: 'on_floor', // XE ĐÃ VÀO BÃI THẬT
  });

  await runSessionMaintenance();

  await oldStuck.reload();
  await freshStuck.reload();
  await enteredOld.reload();
  ok(oldStuck.status === 'exception', `phiên treo 90 phút -> đã hủy (status=${oldStuck.status})`);
  ok(freshStuck.status === 'active', `phiên mới 5 phút -> giữ nguyên (status=${freshStuck.status})`);
  ok(
    enteredOld.status === 'active',
    `xe ĐÃ VÀO BÃI 5 tiếng -> KHÔNG đụng tới (status=${enteredOld.status}, stage=${enteredOld.gate_stage})`,
  );
  const freedSlot = await ParkingSlot.findByPk(oldStuck.slot_id);
  ok(freedSlot.status === 'available', `chỗ đỗ của phiên bị hủy -> đã trả lại (${freedSlot.status})`);

  console.log('\n=== JOB 2: xóa ảnh hết hạn ===');
  const sOld = await makeSession({ plate: '99Z-00004', minutesAgo: 5 });
  const sDisputed = await makeSession({ plate: '99Z-00005', minutesAgo: 5 });

  await makePhoto(sOld.session_id, 'front', 200); // quá hạn, không tranh chấp
  await makePhoto(sOld.session_id, 'left', 1); // còn hạn
  await makePhoto(sDisputed.session_id, 'front', 200); // quá hạn NHƯNG đang khiếu nại

  const inc = await Incident.create({
    session_id: sDisputed.session_id,
    description: 'Khiếu nại hư hại đang xử lý (test)',
    type: 'vehicle_damage',
    status: 'open',
  });
  created.incidents.push(inc.incident_id);

  const res = await runPhotoRetention();
  console.log(`   (job báo: xóa ${res.deleted}, giữ ảnh của ${res.keptForDispute} lượt gửi)`);

  const leftOld = await SessionPhoto.count({ where: { session_id: sOld.session_id } });
  const leftDisputed = await SessionPhoto.count({ where: { session_id: sDisputed.session_id } });
  ok(leftOld === 1, `phiên thường: ảnh 200 ngày bị xóa, ảnh 1 ngày còn lại (còn ${leftOld}/2)`);
  ok(
    leftDisputed === 1,
    `phiên ĐANG KHIẾU NẠI: ảnh 200 ngày VẪN GIỮ (còn ${leftDisputed}/1) — không mất bằng chứng`,
  );

  console.log('\n=== Đóng phiếu rồi thì ảnh mới được xóa ===');
  await inc.update({ status: 'resolved', resolution: 'test' });
  await runPhotoRetention();
  const afterResolve = await SessionPhoto.count({ where: { session_id: sDisputed.session_id } });
  ok(afterResolve === 0, `phiếu đã đóng -> ảnh quá hạn được xóa (còn ${afterResolve})`);
};

const cleanup = async () => {
  for (const id of created.incidents) await Incident.destroy({ where: { incident_id: id } });
  for (const id of created.photos) await SessionPhoto.destroy({ where: { photo_id: id } });
  for (const id of created.sessions) {
    const s = await ParkingSession.findByPk(id);
    if (s) {
      await ParkingSlot.update({ status: 'available' }, { where: { slot_id: s.slot_id } });
      await s.destroy();
    }
  }
  console.log(`\n(đã dọn ${created.sessions.length} phiên test)`);
};

run()
  .catch((err) => {
    console.error('LỖI:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await sequelize.close();
  });
