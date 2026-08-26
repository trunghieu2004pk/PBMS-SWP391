/**
 * Tạo sự cố DEMO cho tab [6] Sự cố của staff.
 *
 * Gắn `reported_by` = tài khoản Staff đang đăng nhập lúc demo, vì BE lọc theo người báo
 * khi vai trò là Staff (staff chỉ thấy sự cố của chính mình). Gắn sai người là mở tab ra trống.
 *
 * Chạy:  node scripts/seedDemoIncidents.js            (tự tìm staff đầu tiên)
 *        node scripts/seedDemoIncidents.js staff@x.com (chỉ định tài khoản)
 *        node scripts/seedDemoIncidents.js --clean     (xoá sự cố demo đã tạo)
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';
import { Incident, UserAccount, Role, ParkingSession } from '../src/models/index.js';
import { Op } from 'sequelize';

const MARK = '[DEMO]';

// Mỗi dòng một TÌNH HUỐNG KHÁC NHAU để lúc demo có cái mà kể, không phải 5 dòng giống nhau.
const ROWS = [
  {
    type: 'vehicle_damage',
    status: 'open',
    needSession: true,
    description:
      `${MARK} Khách báo xước cản sau khi lấy xe. Đối chiếu bộ ảnh VÀO/RA của phiên: `
      + 'ảnh đuôi xe lúc VÀO đã có vết xước, ảnh lúc RA không phát sinh thêm. Đề nghị Admin xem ảnh và kết luận.',
  },
  {
    type: 'lost_ticket',
    status: 'open',
    needSession: true,
    description:
      `${MARK} Khách mất mã QR, tra ra phiên bằng biển số. Đã đối chiếu ảnh người lái lúc VÀO `
      + 'khớp với người đang đứng ở quầy. Thu phí mất vé theo quy định rồi cho ra.',
  },
  {
    type: 'wrong_floor',
    status: 'investigating',
    needSession: true,
    description:
      `${MARK} Xe được xếp chỗ ở tầng 2 nhưng khách tự chạy lên tầng 3 đỗ. `
      + 'Cổng tầng 3 không cho quét vào vì không khớp tầng đã cấp. Đã hướng dẫn khách xuống lại.',
  },
  {
    type: 'overstay',
    status: 'open',
    needSession: false,
    description:
      `${MARK} Xe vé tháng đỗ quá khung giờ của vé (khung 07:00–19:00, ra lúc 21:40). `
      + 'Phần giờ nằm ngoài khung đã tính phụ thu theo bảng giá. Khách thắc mắc, đã giải thích tại quầy.',
  },
  {
    type: 'wrong_info',
    status: 'resolved',
    needSession: false,
    resolution: 'Đã sửa biển số trên phiên và ghi nhật ký thao tác.',
    description:
      `${MARK} Nhân viên gõ nhầm biển số lúc check-in (51F-678.90 thành 51F-678.09). `
      + 'Phát hiện khi khách ra, đã dùng chức năng sửa biển số trên phiên.',
  },
  {
    type: 'slot_conflict',
    status: 'investigating',
    needSession: false,
    description:
      `${MARK} Khách báo tới chỗ được cấp thì đã có xe khác đỗ sẵn. `
      + 'Xe kia không có phiên đang hoạt động — nghi xe vào bãi không qua quầy. Đã cấp lại chỗ khác cho khách.',
  },
];

const run = async () => {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const email = args.find((a) => a.includes('@'));

  await sequelize.authenticate();

  if (clean) {
    const n = await Incident.destroy({ where: { description: { [Op.like]: `${MARK}%` } } });
    console.log(`\nDa xoa ${n} su co demo.\n`);
    await sequelize.close();
    return;
  }

  // Tìm tài khoản staff để gán reported_by.
  const staff = email
    ? await UserAccount.findOne({ where: { email } })
    : await UserAccount.findOne({
      include: [{ model: Role, as: 'role', where: { role_name: 'Staff' } }],
      order: [['user_id', 'ASC']],
    });

  if (!staff) {
    console.error('\nKhong tim thay tai khoan Staff. Chay lai kem email:  node scripts/seedDemoIncidents.js staff@example.com\n');
    process.exitCode = 1;
    await sequelize.close();
    return;
  }

  // Vài phiên có thật để gắn vào — sự cố có session_id thì màn hình hiện thêm thông tin xe.
  const sessions = await ParkingSession.findAll({
    order: [['session_id', 'DESC']],
    limit: 3,
    attributes: ['session_id', 'plate_number'],
  });

  const existing = await Incident.count({ where: { description: { [Op.like]: `${MARK}%` } } });
  if (existing > 0) {
    console.log(`\nDa co ${existing} su co demo tu truoc. Chay --clean truoc neu muon tao lai.\n`);
    await sequelize.close();
    return;
  }

  const created = [];
  for (let i = 0; i < ROWS.length; i += 1) {
    const r = ROWS[i];
    const s = r.needSession ? sessions[i % Math.max(1, sessions.length)] : null;
    const row = await Incident.create({
      type: r.type,
      status: r.status,
      description: r.description,
      reported_by: staff.user_id,
      session_id: s?.session_id ?? null,
      resolution: r.resolution ?? null,
      resolved_by: r.status === 'resolved' ? staff.user_id : null,
      resolved_at: r.status === 'resolved' ? new Date() : null,
    });
    created.push({ id: row.incident_id, type: r.type, status: r.status, plate: s?.plate_number ?? '—' });
  }

  console.log(`\nDa tao ${created.length} su co demo, bao boi: ${staff.email} (user_id=${staff.user_id})\n`);
  for (const c of created) {
    console.log(`  #${String(c.id).padEnd(4)} ${c.type.padEnd(16)} ${c.status.padEnd(14)} xe: ${c.plate}`);
  }
  console.log('\nXoa di:  node scripts/seedDemoIncidents.js --clean\n');

  await sequelize.close();
};

run().catch(async (e) => { console.error(e); await sequelize.close(); process.exit(1); });
