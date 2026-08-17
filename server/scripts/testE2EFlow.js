/**
 * Kiểm tra END-TO-END toàn bộ luồng nghiệp vụ, gọi qua HTTP như giao diện thật gọi.
 * Chạy:  npm run dev --prefix server   (cửa sổ khác)
 *        npm run test:e2e --prefix server
 *
 * Đi hết: check-in → chặn cổng khi thiếu ảnh → nhập ảnh vào → qua cổng → nhập ảnh ra →
 * đối chiếu → lập khiếu nại → cho xe ra → Admin xem ảnh + đóng phiếu kèm kết luận.
 * Tự dọn sạch dữ liệu mình tạo ra.
 */
const BASE = 'http://localhost:5000/api';
const DEMO = new URL('../../client/public/demo-photos/', import.meta.url);

let pass = 0;
const failures = [];
const ok = (cond, label, extra = '') => {
  if (cond) pass += 1;
  else failures.push(label);
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? `  — ${extra}` : ''}`);
};

const login = async (u, p) => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`Đăng nhập ${u} lỗi: ${j.error?.message}`);
  return j.data.token;
};

const api = async (token, path, method = 'GET', body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};

const scan = async (gateId, qrToken) => {
  const r = await fetch(`${BASE}/gates/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Kiosk-Key': process.env.KIOSK_API_KEY || 'dev-kiosk-key-123' },
    body: JSON.stringify({ gateId, qrToken }),
  });
  return { status: r.status, body: await r.json() };
};

const uploadPhoto = async (token, sessionId, phase, kind, file) => {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(new URL(file, DEMO));
  const form = new FormData();
  form.append('photo', new Blob([buf], { type: 'image/jpeg' }), `${kind}.jpg`);
  form.append('phase', phase);
  form.append('kind', kind);
  form.append('capturedAt', new Date().toISOString());
  const r = await fetch(`${BASE}/sessions/${sessionId}/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: r.status, body: await r.json() };
};

const KINDS = ['front', 'left', 'rear', 'right', 'driver'];
const created = { sessions: [], incidents: [], passes: [], reservations: [] };
const savedSettings = {};

const run = async () => {
  const staff = await login('staff', '123456');
  const manager = await login('manager', '123456');
  const admin = await login('admin', '123456');

  // Bật bắt buộc ảnh + ép một mức "phí xe ra khi không có mã" đã biết, để bài kiểm tra khỏi
  // phụ thuộc cấu hình đang chạy của bãi (bãi có thể để 0 = chỉ ghi phiếu, không thu tiền).
  // Giá trị cũ được nhớ lại và trả về nguyên trạng ở cleanup.
  savedSettings.lost_ticket_fee = (await api(manager, '/settings/system')).body.data.lost_ticket_fee;
  await api(manager, '/settings/system', 'PATCH', {
    require_entry_photo: true,
    require_exit_photo: true,
    lost_ticket_fee: 50000,
  });

  const gates = (await api(staff, '/gates')).body.data;
  const bldIn = gates.find((g) => g.floor_id === null && g.direction === 'in');
  const floors = (await api(staff, '/floors')).body.data;
  const vtypes = (await api(staff, '/vehicle-types')).body.data;
  const car = vtypes.find((v) => v.type_code === 'CAR') || vtypes[0];

  const plate = `51F-${String(Math.floor(10000 + Math.random() * 89999)).slice(0, 5)}`;

  console.log('\n━━ 1. CHECK-IN ━━');
  let floorId = null;
  let session = null;
  for (const f of floors) {
    const r = await api(staff, '/sessions/checkin', 'POST', {
      plateNumber: plate,
      vehicleTypeId: car.vehicle_type_id,
      floorId: f.floor_id,
    });
    if (r.body.success) {
      session = r.body.data;
      floorId = f.floor_id;
      break;
    }
  }
  ok(Boolean(session), `Check-in ${plate}`, session ? `phiên #${session.session_id}` : 'không tầng nào còn chỗ');
  if (!session) return;
  created.sessions.push(session.session_id);
  const sid = session.session_id;
  const qr = session.qr_token;

  const dup = await api(staff, '/sessions/checkin', 'POST', {
    plateNumber: plate,
    vehicleTypeId: car.vehicle_type_id,
    floorId,
  });
  ok(!dup.body.success && dup.body.error.code === 'CONFLICT', 'Check-in trùng biển bị chặn');

  console.log('\n━━ 2. CHẶN CỔNG KHI THIẾU ẢNH ━━');
  const blocked = await scan(bldIn.gate_id, qr);
  ok(
    !blocked.body.success && blocked.body.error.code === 'PHOTO_REQUIRED',
    'Quét cổng khi 0/5 ảnh → barie KHÔNG mở',
    blocked.body.error?.message?.slice(0, 50),
  );

  // Lỗ hổng từng có: quầy thu tiền KHÔNG kiểm gate_stage, nên xe mới ghi nhận ở quầy (chưa
  // qua cổng, chưa hề vào bãi) vẫn bị thu tiền và đóng phiên — gate_stage nhảy thẳng
  // checked_in -> exited, bỏ qua cả máy trạng thái. Cổng kiosk chặn đúng, quầy thì không.
  const earlyCash = await api(staff, '/sessions/cash-checkout', 'POST', { sessionId: sid });
  ok(
    !earlyCash.body.success && earlyCash.body.error.code === 'NOT_IN_BUILDING',
    'Xe CHƯA qua cổng vào → quầy KHÔNG thu tiền được',
    earlyCash.body.error?.message?.slice(0, 45),
  );

  console.log('\n━━ 3. NHẬP 5 ẢNH VÀO ━━');
  for (const k of KINDS) {
    const r = await uploadPhoto(staff, sid, 'entry', k, `${k}-ok.jpg`);
    if (k === 'driver') ok(r.body.success && r.body.data.progress.complete, `Đủ 5/5 ảnh vào`);
  }
  const dupAngle = await uploadPhoto(staff, sid, 'entry', 'left', 'front-ok.jpg');
  ok(
    !dupAngle.body.success && dupAngle.body.error.code === 'PHOTO_TOO_SIMILAR',
    'Nhập 1 ảnh cho 2 góc → chặn PHOTO_TOO_SIMILAR',
  );

  console.log('\n━━ 4. QUA CỔNG VÀO ━━');
  const opened = await scan(bldIn.gate_id, qr);
  ok(opened.body.success && opened.body.data.action === 'OPEN', 'Đủ ảnh → barie MỞ');
  const again = await scan(bldIn.gate_id, qr);
  ok(!again.body.success && again.body.error.code === 'ALREADY_PARKED', 'Quét lại lần 2 → chặn vào lại');
  const cancelAfter = await api(staff, `/sessions/${sid}/cancel-entry`, 'POST', { reason: 'thử' });
  ok(
    !cancelAfter.body.success && cancelAfter.body.error.code === 'ALREADY_PARKED',
    'Xe đã vào bãi → KHÔNG hủy phiên được',
  );

  console.log('\n━━ 5. CHẶN CHECK-OUT KHI THIẾU ẢNH RA ━━');
  const noExit = await api(staff, '/sessions/cash-checkout', 'POST', { sessionId: sid });
  ok(
    !noExit.body.success && noExit.body.error.code === 'PHOTO_REQUIRED',
    'Thu tiền mặt khi thiếu ảnh ra → chặn',
  );
  const still = (await api(staff, `/sessions/${sid}`)).body.data;
  ok(still.status === 'active', 'Phiên VẪN active, chỗ đỗ chưa bị nhả');

  // Khách quét ở CỔNG RA khi chưa có ảnh: lỗi phải kèm sessionId, không thì kiosk chỉ báo đỏ
  // rồi về màn chờ — khách đứng trước màn hình trống trong khi nhân viên đang chụp ảnh và tất
  // toán cho đúng chiếc xe đó ở quầy. Có sessionId thì kiosk bám theo phiên và tự mở barie.
  const bldOut = gates.find((g) => g.floor_id === null && g.direction === 'out');
  const outScan = await scan(bldOut.gate_id, qr);
  ok(
    !outScan.body.success && outScan.body.error.code === 'PHOTO_REQUIRED'
      && outScan.body.error.details?.sessionId === sid,
    'Cổng ra thiếu ảnh → lỗi kèm sessionId để kiosk bám theo phiên',
    `ảnh ${outScan.body.error.details?.captured}/${outScan.body.error.details?.total}`,
  );

  // Cho xe ra khi khách KHÔNG có mã QR = bỏ qua thứ duy nhất chứng minh đúng người gửi xe.
  // Không ràng buộc gì thì "báo mất thẻ" thành lối đi thẳng cho kẻ trộm: leo lên xe, ra cổng,
  // nói mất mã, đi thẳng. Bắt buộc ghi giấy tờ đã đối chiếu vào phiếu sự cố.
  const noNote = await api(staff, '/sessions/cash-checkout', 'POST', { sessionId: sid, lostTicket: true });
  ok(
    !noNote.body.success && /giấy tờ/.test(noNote.body.error.message),
    'Cho ra khi KHÔNG có mã mà không ghi giấy tờ → bị chặn',
    noNote.body.error?.message?.slice(0, 45),
  );

  console.log('\n━━ 6. NHẬP 5 ẢNH RA (bên trái = bản MẤT GƯƠNG) ━━');
  for (const k of KINDS) {
    await uploadPhoto(staff, sid, 'exit', k, k === 'left' ? 'left-damaged.jpg' : `${k}-ok.jpg`);
  }
  const photos = (await api(staff, `/sessions/${sid}/photos`)).body.data;
  ok(photos.entryProgress.complete && photos.exitProgress.complete, 'Đủ 2 bộ ảnh VÀO/RA để đối chiếu');
  ok(photos.entry.every((p) => p.source === 'upload'), 'Ảnh ghi đúng nguồn "upload"');

  const lockEntry = await uploadPhoto(staff, sid, 'entry', 'front', 'front-damaged.jpg');
  ok(
    !lockEntry.body.success && lockEntry.body.error.code === 'CONFLICT',
    'Đã có ảnh RA → KHÔNG sửa được ảnh VÀO (niêm phong bằng chứng)',
  );

  console.log('\n━━ 7. LẬP KHIẾU NẠI + CHO XE RA ━━');
  const inc = await api(staff, '/incidents', 'POST', {
    type: 'vehicle_damage',
    description: 'Đối chiếu ảnh: vào còn gương trái, ra đã mất',
    sessionId: sid,
  });
  ok(inc.body.success, 'Staff lập phiếu khiếu nại hư hại', `phiếu #${inc.body.data?.incident_id}`);
  const incId = inc.body.data.incident_id;
  created.incidents.push(incId);

  const out = await api(staff, '/sessions/cash-checkout', 'POST', { sessionId: sid });
  ok(out.body.success, 'Cho xe RA (không giữ xe khách)', `phí ${out.body.data?.fee}`);
  const done = (await api(staff, `/sessions/${sid}`)).body.data;
  ok(done.status === 'completed' && done.gate_stage === 'exited', 'Phiên đóng đúng trạng thái cuối');
  ok(done.slot?.status === 'available', 'Chỗ đỗ đã được trả lại');

  console.log('\n━━ 8. ADMIN XỬ LÝ (xe đã rời bãi) ━━');
  const list = await api(admin, '/incidents?type=vehicle_damage&limit=50');
  const mine = list.body.data.items.find((i) => i.incident_id === incId);
  ok(Boolean(mine), 'Admin thấy phiếu trong danh sách');
  ok(mine?.session?.session_id === sid, 'Phiếu gắn đúng lượt gửi để mở ảnh');
  ok(
    mine?.claimWindow && !mine.claimWindow.filedAfterExit,
    'Phiếu gắn nhãn "lập khi xe còn trong bãi"',
  );

  const adminPhotos = await api(admin, `/sessions/${sid}/photos`);
  ok(adminPhotos.body.success && adminPhotos.body.data.exit.length === 5, 'Admin xem được ảnh của phiên ĐÃ ĐÓNG');

  const noRes = await api(admin, `/incidents/${incId}/status`, 'PATCH', { status: 'resolved' });
  ok(
    !noRes.body.success && noRes.body.error.code === 'RESOLUTION_REQUIRED',
    'Đóng phiếu KHÔNG ghi kết luận → bị chặn',
  );
  const res = await api(admin, `/incidents/${incId}/status`, 'PATCH', {
    status: 'resolved',
    resolution: 'Đối chiếu ảnh: bãi chịu trách nhiệm, đã bồi thường 800.000đ.',
  });
  ok(res.body.success && res.body.data.resolution, 'Đóng phiếu kèm kết luận → OK', res.body.data?.resolver?.full_name);

  // Chốt của nhóm: MỌI sự cố dồn về Admin. Manager chỉ còn lo dữ liệu gốc (tầng, khu, chỗ đỗ,
  // bảng giá, cấu hình) — không đọc, không xử lý sự cố, và cũng không xem ảnh của khách.
  const mgrList = await api(manager, '/incidents?limit=1');
  ok(mgrList.status === 403, 'Manager KHÔNG xem được danh sách sự cố (403)');
  const mgrFix = await api(manager, `/incidents/${incId}/status`, 'PATCH', { status: 'open' });
  ok(mgrFix.status === 403, 'Manager KHÔNG đổi được trạng thái sự cố (403)');
  const mgrPhoto = await api(manager, `/sessions/${sid}/photos`);
  ok(mgrPhoto.status === 403, 'Manager KHÔNG xem được ảnh hiện trạng của khách (403)');

  const staffTry = await api(staff, `/incidents/${incId}/status`, 'PATCH', { status: 'open' });
  ok(staffTry.status === 403, 'Staff KHÔNG được đổi trạng thái phiếu (403)');

  console.log('\n━━ 9. PHÂN QUYỀN XEM ẢNH ━━');
  const user = await login('user', '123456');
  const userTry = await api(user, `/sessions/${sid}/photos`);
  ok(userTry.status === 403, 'Khách (User) KHÔNG xem được ảnh (403)');
  const anon = await fetch(`${BASE}/sessions/${sid}/photos`);
  ok(anon.status === 401, 'Chưa đăng nhập → 401');

  const logs = await api(admin, '/admin/audit-logs?action=SESSION_PHOTO_VIEW&limit=5');
  ok((logs.body.data?.items?.length ?? 0) > 0, 'Mỗi lần xem ảnh đều ghi nhật ký');

  // ─────────────────────────────────────────────────────────────────────────
  // Khách vé tháng đã trả tiền cả tháng rồi, nên tiền lúc ra bãi phải tính RIÊNG phần giờ
  // nằm ngoài khung ghi trên vé. Từng có lúc chỉ cần lố 1 phút là mất sạch quyền miễn phí và
  // bị tính lại từ lúc vào — khách đỗ 15 tiếng trong khung bị thu như vãng lai cả 15 tiếng.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n━━ 10. VÉ THÁNG: LỐ KHUNG GIỜ + MẤT VÉ ━━');
  const m = await import('../src/models/index.js');
  const passPlate = `88C-300.${String(Math.floor(10 + Math.random() * 89))}`;
  const owner = await m.UserAccount.findOne({ where: { username: 'user' } });
  const today = new Date();
  const mp = await m.MonthlyPass.create({
    user_id: owner.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: floors[0].floor_id,
    plate_number: passPlate,
    valid_from_time: '06:00:00',
    valid_to_time: '22:00:00',
    start_date: new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10),
    end_date: new Date(today.getTime() + 25 * 86400000).toISOString().slice(0, 10),
    status: 'active',
    qr_token: `e2e-${Date.now()}`,
  });
  created.passes.push(mp.pass_id);

  let passSession = null;
  for (const f of floors) {
    const r = await api(staff, '/sessions/checkin', 'POST', {
      plateNumber: passPlate, vehicleTypeId: car.vehicle_type_id, floorId: f.floor_id,
    });
    if (r.body.success) { passSession = r.body.data; break; }
  }
  ok(Boolean(passSession), `Check-in vé tháng ${passPlate}`);
  if (passSession) {
    created.sessions.push(passSession.session_id);
    const psid = passSession.session_id;
    const row = await m.ParkingSession.findByPk(psid);
    const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };
    const feeOf = async (timeIn, leftAt, lostTicket = false) => {
      await row.update({ time_in: timeIn, left_floor_at: leftAt });
      return (await api(staff, '/sessions/preview-fee', 'POST', { sessionId: psid, lostTicket })).body.data;
    };

    const inside = await feeOf(at(8), at(21));
    ok(inside.fee === 0 && inside.passCovered, 'Đỗ 08:00–21:00 trong khung vé → 0đ');

    const over = await feeOf(at(8), at(23));
    const wholeStay = 15 * Number(over.pricingRule.baseRate); // nếu tính lại từ lúc vào
    ok(
      over.fee > 0 && over.fee < wholeStay,
      'Ra trễ 1 tiếng → CHỈ tính phần ngoài khung, không tính lại từ lúc vào',
      `thu ${over.fee}đ thay vì ${wholeStay}đ`,
    );
    ok(over.overstayReason === 'pass_window' && over.overstayCharge, 'Vé tháng lố khung → có phụ thu, đúng lý do');

    const early = await feeOf(at(4), at(8));
    ok(early.fee > 0 && early.passBillableMinutes === 120, 'Vào SỚM trước khung → tính 2 tiếng đầu ngoài khung');

    const lost = await feeOf(at(8), at(21), true);
    ok(
      lost.fee === lost.lostTicketFee && lost.lostTicketFee > 0,
      'Vé tháng bao trọn nhưng KHÔNG CÓ MÃ → vẫn cộng khoản đó',
      `${lost.fee}đ`,
    );

    const plain = await feeOf(at(8), at(9));
    const withLost = await feeOf(at(8), at(9), true);
    ok(
      withLost.fee - plain.fee === withLost.lostTicketFee,
      'Phí mất vé chỉ cộng ĐÚNG MỘT LẦN',
      `chênh ${withLost.fee - plain.fee}đ`,
    );

    const prepaid = plain.prepaid;
    ok(
      prepaid?.kind === 'monthly_pass' && prepaid.window.from === '06:00',
      'Quầy thấy được khoản khách đã trả trước + khung vé',
    );

    // Khách vé tháng cầm QR VÉ chứ không cầm vé giấy của lượt gửi. Chốt ra chỉ dò QR phiên và
    // QR đặt chỗ thì cả nhóm khách này không tra ra được gì.
    const byPassQr = await api(staff, '/sessions/preview-fee', 'POST', { qrToken: mp.qr_token });
    ok(
      byPassQr.body.success && byPassQr.body.data.session.session_id === psid,
      'Quét QR VÉ THÁNG ở chốt ra → ra đúng lượt đang gửi',
    );
  }

  console.log('\n━━ 11. BÁO ĐÚNG LÝ DO KHI KHÔNG CÓ XE TRONG BÃI ━━');
  // "Active session not found" đọc lên không phân biệt được: gõ sai biển, xe chưa vào, hay xe
  // đã ra rồi. Tab tra cứu vé tháng lại hiện "Đang hiệu lực" nên nhân viên rất dễ tưởng hệ
  // thống hỏng.
  const ghost = await api(staff, '/sessions/preview-fee', 'POST', { plateNumber: '51K-123.45' });
  ok(
    !ghost.body.success && /Không có xe nào đang gửi/.test(ghost.body.error.message),
    'Biển lạ → nói rõ không có xe nào đang gửi',
  );
  // Vé riêng, cố tình KHÔNG check-in — đúng cảnh trong ảnh chụp màn hình: vé "Đang hiệu lực"
  // nhưng xe không hề nằm trong bãi.
  const idlePlate = `88C-400.${String(Math.floor(10 + Math.random() * 89))}`;
  const idle = await m.MonthlyPass.create({
    user_id: owner.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: floors[0].floor_id,
    plate_number: idlePlate,
    valid_from_time: '06:00:00',
    valid_to_time: '22:00:00',
    start_date: new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10),
    end_date: new Date(today.getTime() + 25 * 86400000).toISOString().slice(0, 10),
    status: 'active',
    qr_token: `e2e-idle-${Date.now()}`,
  });
  created.passes.push(idle.pass_id);

  // Gõ TAY biển số: form phải nhận diện ngay, không để nhân viên tự nhớ vé tháng của xe đó
  // nằm tầng nào. Quét QR thì form tự điền; gõ tay mà im lặng là bắt người ta đoán.
  const idPass = await api(staff, `/sessions/staff/identify-plate?plateNumber=${idlePlate}`);
  ok(
    idPass.body.success && idPass.body.data?.kind === 'pass'
      && idPass.body.data.floorId === idle.floor_id,
    'Gõ tay biển vé tháng → nhận diện ra đúng vé và đúng tầng',
    `${idPass.body.data?.label} · tầng ${idPass.body.data?.floorId}`,
  );
  const idWalk = await api(staff, `/sessions/staff/identify-plate?plateNumber=${plate}`);
  ok(
    idWalk.body.success && idWalk.body.data === null,
    'Gõ tay biển lạ → trả null (khách vãng lai), KHÔNG phải lỗi',
  );

  const idlePass = await api(staff, '/sessions/preview-fee', 'POST', { plateNumber: idlePlate });
  ok(
    !idlePass.body.success && /Vé tháng .* còn hiệu lực/.test(idlePass.body.error.message),
    'Vé tháng còn hạn nhưng xe không trong bãi → nói rõ vé còn hạn ≠ xe đang gửi',
    idlePass.body.error?.message?.slice(0, 55),
  );
  const idleQr = await api(staff, '/sessions/preview-fee', 'POST', { qrToken: idle.qr_token });
  ok(
    !idleQr.body.success && /VÉ THÁNG/.test(idleQr.body.error.message),
    'Quét QR vé tháng của xe không trong bãi → nói rõ đây là QR vé tháng',
  );

  console.log('\n━━ 12. CHỌN LỆCH TẦNG: BÁO RÕ, KHÔNG BẮN PHIẾU SỰ CỐ ━━');
  // Chọn lệch tầng là nhân viên bấm nhầm ô trong lúc khách còn đứng ở quầy — không phải
  // khách lái lạc tầng. Phải báo lệch ở đâu, và KHÔNG được lập phiếu sự cố (phiếu ảo bay
  // lên admin). Sai tầng thật thì cổng tầng bên kiosk vẫn bắt, đã có case riêng.
  const wrongFloor = floors.find((f) => f.floor_id !== idle.floor_id) || floors[0];
  const incBefore = (await api(admin, '/incidents?type=wrong_floor&limit=1')).body.data.total;
  const bad = await api(staff, '/sessions/checkin', 'POST', {
    plateNumber: idlePlate,
    vehicleTypeId: car.vehicle_type_id,
    floorId: wrongFloor.floor_id,
  });
  ok(
    !bad.body.success && bad.body.error.code === 'PASS_WRONG_FLOOR'
      && /tầng/.test(bad.body.error.message),
    'Chọn lệch tầng → báo rõ tầng đúng của vé, không âm thầm đổi',
    bad.body.error?.message?.slice(0, 55),
  );
  const incAfter = (await api(admin, '/incidents?type=wrong_floor&limit=1')).body.data.total;
  ok(incAfter === incBefore, 'KHÔNG bắn phiếu sự cố "sai tầng" oan lên admin');

  // Lớp giữ-chỗ-cho-vé-tháng sinh ra để chặn WALK-IN ăn vào phần để dành. Đường kiosk đã miễn
  // cho chính chủ vé từ đầu, đường QUẦY thì chưa — mà từ khi bãi bắt buộc ảnh, khách vé tháng
  // BUỘC phải vào bằng đường quầy, nên chính chủ vé bị chính hạn mức của mình khóa lại.
  const okFloor = await api(staff, '/sessions/checkin', 'POST', {
    plateNumber: idlePlate,
    vehicleTypeId: car.vehicle_type_id,
    floorId: idle.floor_id,
  });
  ok(
    okFloor.body.success && okFloor.body.data.session_type === 'monthly_pass',
    'Chọn đúng tầng → chủ vé vào được, KHÔNG bị hạn mức vé tháng khóa (OR-03)',
    okFloor.body.error?.message?.slice(0, 55),
  );
  if (okFloor.body.success) created.sessions.push(okFloor.body.data.session_id);

  console.log('\n━━ 13. HỦY PHIÊN PHẢI TRẢ LẠI ĐƠN ĐẶT CHỖ ━━');
  // Hủy phiên chỉ nhả chỗ đỗ, đơn vẫn kẹt ở 'checked_in' = "đã dùng rồi": QR của khách báo
  // không dùng được, gõ biển số thì ra khách VÃNG LAI — khách trả tiền giữ chỗ xong mất suất
  // và bị tính tiền như người không đặt.
  const bookPlate = `88D-500.${String(Math.floor(10 + Math.random() * 89))}`;
  const book = await m.Reservation.create({
    user_id: owner.user_id,
    vehicle_type_id: car.vehicle_type_id,
    floor_id: floors[0].floor_id,
    plate_number: bookPlate,
    start_time: new Date(Date.now() - 30 * 60000),
    end_time: new Date(Date.now() + 4 * 3600000),
    status: 'confirmed',
    reservation_type: 'hourly',
    qr_token: `e2e-book-${Date.now()}`,
  });
  created.reservations.push(book.reservation_id);

  const bookIn = await api(staff, '/sessions/checkin', 'POST', {
    plateNumber: bookPlate, vehicleTypeId: car.vehicle_type_id, floorId: book.floor_id,
  });
  ok(bookIn.body.success && bookIn.body.data.session_type === 'reservation', 'Check-in đơn đặt chỗ');
  if (bookIn.body.success) {
    created.sessions.push(bookIn.body.data.session_id);
    const undo = await api(staff, `/sessions/${bookIn.body.data.session_id}/cancel-entry`, 'POST', {
      reason: 'chưa nhập xong ảnh, làm lại',
    });
    ok(undo.body.success, 'Hủy phiên chưa qua cổng');

    await book.reload();
    ok(book.status === 'confirmed' && book.slot_id === null, 'Đơn được trả về "confirmed", nhả luôn chỗ đã gán');

    const reScan = await api(staff, `/sessions/staff/resolve-checkin-qr?qrToken=${book.qr_token}`);
    ok(reScan.body.success, 'QR của khách quét lại được');

    const reIn = await api(staff, '/sessions/checkin', 'POST', {
      plateNumber: bookPlate, vehicleTypeId: car.vehicle_type_id, floorId: book.floor_id,
    });
    ok(
      reIn.body.success && reIn.body.data.session_type === 'reservation',
      'Check-in lại vẫn là ĐẶT CHỖ, không tụt xuống khách vãng lai',
      reIn.body.data?.session_type,
    );
    if (reIn.body.success) created.sessions.push(reIn.body.data.session_id);
  }
};

const cleanup = async () => {
  try {
    const manager = await login('manager', '123456');
    await api(manager, '/settings/system', 'PATCH', {
      require_entry_photo: false,
      require_exit_photo: false,
      // Trả về ĐÚNG giá trị bãi đang đặt, không phải một hằng số của bài test.
      ...(savedSettings.lost_ticket_fee !== undefined
        ? { lost_ticket_fee: savedSettings.lost_ticket_fee }
        : {}),
    });
    const m = await import('../src/models/index.js');
    const sequelize = (await import('../src/config/db.js')).default;
    const { releaseSlotIfOccupied } = await import('../src/utils/slotSuggest.js');
    for (const id of created.incidents) await m.Incident.destroy({ where: { incident_id: id } });
    for (const id of created.passes) await m.MonthlyPass.destroy({ where: { pass_id: id } });
    for (const id of created.reservations) {
      // Xoá thẳng đơn thì không đi qua đường nhả chỗ của service — ô "khóa đầu ca" bị kẹt
      // 'reserved' và bãi cứ đầy dần dù không có xe nào. Trả ô về bãi trước khi xoá đơn.
      const r = await m.Reservation.findByPk(id);
      if (r?.slot_id) {
        await m.ParkingSlot.update(
          { status: 'available' },
          { where: { slot_id: r.slot_id, status: 'reserved' } },
        );
      }
      await m.Reservation.destroy({ where: { reservation_id: id } });
    }
    for (const id of created.sessions) {
      const s = await m.ParkingSession.findByPk(id);
      if (s && s.status === 'active') {
        // eslint-disable-next-line no-await-in-loop
        await sequelize.transaction(async (t) => {
          await releaseSlotIfOccupied(s.slot_id, t);
          await s.update({ status: 'exception', time_out: new Date(), calculated_fee: 0 }, { transaction: t });
        });
      }
      await m.SessionPhoto.destroy({ where: { session_id: id } });
    }
    await sequelize.close();
    console.log(`\n(đã dọn ${created.sessions.length} phiên, ${created.incidents.length} phiếu, trả cấu hình về mặc định)`);
  } catch (e) {
    console.error('Dọn dẹp lỗi:', e.message);
  }
};

run()
  .catch((e) => {
    console.error('\nLỖI:', e.message);
    failures.push(e.message);
  })
  .finally(async () => {
    await cleanup();
    const total = pass + failures.length;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`${pass}/${total} bước đạt${failures.length ? ':' : ' — LUỒNG THÔNG SUỐT'}`);
    failures.forEach((f) => console.log(`   ✗ ${f}`));
    process.exit(failures.length ? 1 : 0);
  });
