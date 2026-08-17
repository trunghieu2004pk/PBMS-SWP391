/**
 * Bộ kiểm tra biển số xe Việt Nam.
 * Chạy: npm run test:plate --prefix server
 *
 * Căn cứ: Thông tư 79/2024/TT-BCA (hiệu lực 01/01/2025) và các định dạng đời cũ vẫn lưu hành
 * hợp pháp (xe đăng ký trước 01/7/2025 KHÔNG phải đổi biển).
 *
 * NGUYÊN TẮC: thà nhận nhầm một biển lạ còn hơn ĐUỔI một khách thật. Mọi ca "phải nhận" ở dưới
 * là biển có thật ngoài đường — để lọt thì bãi mất khách, và nhân viên không có cách nào ghi đè.
 */
import {
  validateAndNormalizePlateVN,
  plateMatchesVehicleType,
} from '../src/utils/plateVN.js';

// [đầu vào, nhận?, loại mong đợi, dạng chuẩn hoá mong đợi (null = không kiểm), ghi chú]
const CASES = [
  // ═══ Ô TÔ — seri 1 chữ ═══
  ['30A-123.45', true, 'car', '30A-123.45', 'ô tô chuẩn'],
  ['51F-12345', true, 'car', '51F-123.45', 'ô tô, 5 số liền'],
  ['30-A 123.45', true, 'car', '30A-123.45', 'ô tô, viết như trên xe (có gạch + cách)'],
  ['99Z-999.99', true, 'car', '99Z-999.99', 'seri Z hợp lệ'],
  ['29A-1234', true, 'car', '29A-1234', 'ô tô biển cũ 4 số'],
  ['30V-016.04', true, 'car', '30V-016.04', 'ảnh thực tế'],
  ['30a-123.45', true, 'car', '30A-123.45', 'chữ thường phải tự hoa'],
  [' 30A - 123.45 ', true, 'car', '30A-123.45', 'thừa khoảng trắng'],

  // ═══ XE MÁY — seri 1 chữ + 1 số (50–175cc, và A+số cho ≥175cc) ═══
  ['59F1-345.67', true, 'motorbike', '59F1-345.67', 'xe máy chữ+số'],
  ['36-B1 12345', true, 'motorbike', '36B1-123.45', 'VÍ DỤ THỰC TẾ: biển cũ'],
  ['82H3-12345', true, 'motorbike', '82H3-123.45', '5 số liền'],
  ['82H3-9423', true, 'motorbike', '82H3-9423', 'xe máy cũ 4 số'],
  ['51-T1 1234', true, 'motorbike', '51T1-1234', 'ảnh thực tế'],
  ['12-B1 168.88', true, 'motorbike', '12B1-168.88', 'ảnh thực tế'],
  ['89-E1 188.96', true, 'motorbike', '89E1-188.96', 'ảnh thực tế'],
  ['29A1-12345', true, 'motorbike', '29A1-123.45', 'xe ≥175cc dùng chữ A + số'],

  // ═══ XE MÁY — seri 2 chữ (dưới 50cc đời cũ; MỌI xe máy từ 01/01/2025) ═══
  ['68-PA 04545', true, 'motorbike', '68PA-045.45', 'VÍ DỤ THỰC TẾ: biển mới 2 chữ'],
  ['68PA-045.45', true, 'motorbike', '68PA-045.45', 'nt, đã chuẩn hoá'],
  ['59AB-123.45', true, 'motorbike', '59AB-123.45', 'xe máy 2 chữ'],
  ['92TU-11111', true, 'motorbike', '92TU-111.11', '5 số liền'],
  ['29-AB 1234', true, 'motorbike', '29AB-1234', 'xe dưới 50cc, 2 chữ + 4 số'],

  // ═══ XE MÁY ĐIỆN — seri MĐ1..MĐ9 ═══
  ['29-MĐ1 123.45', true, 'motorbike', '29MĐ1-123.45', 'XE MÁY ĐIỆN'],
  ['29MĐ1-12345', true, 'motorbike', '29MĐ1-123.45', 'xe máy điện, viết liền'],
  ['29-MĐ9 00001', true, 'motorbike', '29MĐ9-000.01', 'xe máy điện MĐ9'],
  ['59mđ5-1234', true, 'motorbike', '59MĐ5-1234', 'xe máy điện, chữ thường, 4 số'],

  // ═══ KÝ HIỆU RIÊNG — nhận nhưng KHÔNG suy ra loại xe ═══
  ['30LD-12345', true, 'either', '30LD-123.45', 'LD = doanh nghiệp vốn nước ngoài'],
  ['51DA-1234', true, 'either', '51DA-1234', 'DA = ban quản lý dự án'],
  ['30KT-12345', true, 'either', '30KT-123.45', 'KT = doanh nghiệp quân đội'],
  ['30HC-12345', true, 'either', '30HC-123.45', 'HC = xe hạn chế hoạt động'],
  ['30-TĐ 1234', true, 'either', '30TĐ-1234', 'TĐ = xe thí điểm'],
  ['30MK-12345', true, 'either', '30MK-123.45', 'MK = máy kéo'],
  ['30CD-12345', true, 'either', '30CD-123.45', 'CD = xe máy chuyên dùng'],

  // ═══ NGOẠI GIAO / NƯỚC NGOÀI ═══
  ['80-441-NG-02', true, 'either', '80-441-NG-02', 'xe ngoại giao'],
  ['80441NG02', true, 'either', '80-441-NG-02', 'nt, viết liền'],
  ['80-168-NN-06', true, 'either', '80-168-NN-06', 'xe nước ngoài'],
  ['80-NN 168-06', true, 'either', '80-168-NN-06', 'nt, thứ tự seri trước (ảnh thực tế)'],
  ['80-025-QT-01', true, 'either', '80-025-QT-01', 'tổ chức quốc tế'],
  ['80-100-CV-11', true, 'either', '80-100-CV-11', 'nhân viên hành chính kỹ thuật'],

  // ═══ PHẢI TỪ CHỐI — chữ cái không tồn tại trong seri ═══
  ['30I-12345', false, null, null, 'chữ I không dùng'],
  ['30J-12345', false, null, null, 'chữ J không dùng'],
  ['30O-12345', false, null, null, 'chữ O không dùng'],
  ['30Q-12345', false, null, null, 'chữ Q không dùng'],
  ['30W-12345', false, null, null, 'chữ W không dùng'],
  ['30R-12345', false, null, null, 'R chỉ dùng cho rơ moóc, không nhận ở bãi'],

  // ═══ PHẢI TỪ CHỐI — số lượng chữ số sai ═══
  ['30A-123456', false, null, null, '6 số'],
  ['30A-123', false, null, null, '3 số'],
  ['30A-1', false, null, null, '1 số'],

  // ═══ PHẢI TỪ CHỐI — mã tỉnh ═══
  ['09A-12345', false, null, null, 'mã tỉnh < 11'],
  ['00A-12345', false, null, null, 'mã tỉnh 00'],
  ['10A-12345', false, null, null, 'mã 10 dự trữ'],
  ['42A-12345', false, null, null, 'mã 42 chưa từng cấp'],
  ['44A-12345', false, null, null, 'mã 44 chưa từng cấp'],
  ['45A-12345', false, null, null, 'mã 45 chưa từng cấp'],
  ['46A-12345', false, null, null, 'mã 46 chưa từng cấp'],
  ['87A-12345', false, null, null, 'mã 87 chưa từng cấp'],
  ['91A-12345', false, null, null, 'mã 91 chưa từng cấp'],
  ['96A-12345', false, null, null, 'mã 96 chưa từng cấp'],
  ['92A-004.46', true, 'car', '92A-004.46', 'mã 92 CÓ THẬT (Đà Nẵng) — không được chặn nhầm'],
  ['80A-12345', true, 'car', '80A-123.45', 'mã 80 = Cục CSGT, có thật'],

  // ═══ PHẢI TỪ CHỐI — Đ sai chỗ (KHÔNG được tự sửa thành D) ═══
  ['30Ađ-12345', false, null, null, 'Đ chỉ hợp lệ trong MĐ/TĐ'],
  ['30Đ-12345', false, null, null, 'Đ đứng một mình'],

  // ═══ PHẢI TỪ CHỐI — rác ═══
  ['', false, null, null, 'rỗng'],
  ['ABC', false, null, null, 'không phải biển số'],
  ['12345', false, null, null, 'chỉ có số'],

  // ═══ NHẬP NHẰNG khi gõ liền không dấu — phải HỎI LẠI, không được tự chọn ═══
  // 8 ký tự đọc được cả hai cách: 30A + 12345 (ô tô) hoặc 30A1 + 2345 (xe máy). Trước đây máy
  // lặng lẽ chọn xe máy, nhân viên gõ biển ô tô 5 số rồi nhận về câu "biển xe máy nhưng bạn
  // chọn ô tô" kèm một biển họ không hề gõ — không tài nào hiểu chuyện gì đang xảy ra.
  ['30A12345', false, null, null, 'nhập nhằng ô tô/xe máy → hỏi lại'],
  ['51F12345', false, null, null, 'nhập nhằng ô tô/xe máy → hỏi lại'],
  ['88A10002', false, null, null, 'nhập nhằng ô tô/xe máy → hỏi lại'],
  // Có dấu phân cách thì hết nhập nhằng — gạch hoặc dấu cách đều được
  ['30A-12345', true, 'car', '30A-123.45', 'có gạch → ô tô'],
  ['30A1-2345', true, 'motorbike', '30A1-2345', 'có gạch → xe máy'],
  ['51-T1 1234', true, 'motorbike', '51T1-1234', 'dấu cách giữa seri và số → xe máy'],
];

// Nhap nhang + DA CHON loai xe: lay chinh lua chon do de go, khong bat go lai.
// [bien, loai xe da chon, ket qua mong doi]
const PREFER_CASES = [
  ['30A12345', 'car', '30A-123.45'],
  ['30A12345', 'motorbike', '30A1-2345'],
  ['51F12345', 'car', '51F-123.45'],
  ['88A10002', 'car', '88A-100.02'],
  ['88A10002', 'motorbike', '88A1-0002'],
  ['30A-123.45', 'motorbike', '30A-123.45'],
];

// [biển, mã loại xe nhân viên chọn, có nên khớp không, ghi chú]
const CROSS_CHECK = [
  ['30A-123.45', 'CAR', true, 'ô tô + chọn ô tô'],
  ['30A-123.45', 'BIKE', false, 'ô tô nhưng chọn xe máy — phải chặn'],
  ['59F1-345.67', 'BIKE', true, 'xe máy cũ + chọn xe máy'],
  ['59F1-345.67', 'CAR', false, 'xe máy cũ nhưng chọn ô tô — phải chặn'],
  ['68-PA 04545', 'BIKE', true, 'xe máy 2 chữ + chọn xe máy'],
  ['68-PA 04545', 'CAR', false, 'XE MÁY 2 chữ nhưng chọn Ô TÔ — phải chặn'],
  ['29-MĐ1 123.45', 'BIKE', true, 'xe máy điện + chọn xe máy'],
  ['29-MĐ1 123.45', 'CAR', false, 'xe máy điện nhưng chọn ô tô — phải chặn'],
  // Ký hiệu riêng: KHÔNG suy ra loại xe -> không bao giờ chặn, tránh đuổi nhầm khách
  ['30LD-12345', 'CAR', true, 'LD + ô tô — không chặn'],
  ['30LD-12345', 'BIKE', true, 'LD + xe máy — cũng không chặn (không suy được loại)'],
  ['80-441-NG-02', 'CAR', true, 'ngoại giao — không chặn'],
];

const pad = (s, n) => String(s).padEnd(n);
let fail = 0;
const failures = [];

console.log('\n╔══ ĐỊNH DẠNG & CHUẨN HOÁ ══════════════════════════════════════════════════╗\n');
for (const [input, shouldPass, expectCat, expectNorm, note] of CASES) {
  const r = validateAndNormalizePlateVN(input);
  const okValid = r.valid === shouldPass;
  const okCat = !shouldPass || r.category === expectCat;
  const okNorm = !shouldPass || !expectNorm || r.normalized === expectNorm;
  const pass = okValid && okCat && okNorm;
  if (!pass) {
    fail += 1;
    failures.push(`${input || '(rỗng)'} — ${note}`);
  }
  const actual = r.valid ? `${r.normalized} [${r.category}]` : 'từ chối';
  const expect = shouldPass ? `${expectNorm || '?'} [${expectCat}]` : 'TỪ CHỐI';
  console.log(
    `${pass ? ' ✓' : ' ✗'} ${pad(`"${input}"`, 18)} ${pad(expect, 24)} ${pad(actual, 24)} ${pass ? '' : `<<< ${note}`}`,
  );
}

console.log('\n╔══ ĐỐI CHIẾU BIỂN ↔ LOẠI XE NHÂN VIÊN CHỌN ════════════════════════════════╗\n');
for (const [input, typeCode, shouldMatch, note] of CROSS_CHECK) {
  const r = validateAndNormalizePlateVN(input);
  const got = r.valid ? plateMatchesVehicleType(r.category, typeCode) : null;
  const pass = got === shouldMatch;
  if (!pass) {
    fail += 1;
    failures.push(`${input} + ${typeCode} — ${note}`);
  }
  console.log(
    `${pass ? ' ✓' : ' ✗'} ${pad(`"${input}" + ${typeCode}`, 30)} ${pad(shouldMatch ? 'cho qua' : 'CHẶN', 10)} ${pad(got === null ? 'biển không hợp lệ' : got ? 'cho qua' : 'chặn', 20)} ${pass ? '' : `<<< ${note}`}`,
  );
}

console.log('\n╔══ NHẬP NHẰNG + ĐÃ CHỌN LOẠI XE → GỠ ĐƯỢC, KHÔNG BẮT GÕ LẠI ══════════════╗\n');
for (const [input, prefer, expected] of PREFER_CASES) {
  const r = validateAndNormalizePlateVN(input, prefer);
  const pass = r.valid && r.normalized === expected;
  if (!pass) {
    fail += 1;
    failures.push(`${input} + chọn ${prefer} — mong ${expected}`);
  }
  console.log(
    `${pass ? ' ✓' : ' ✗'} ${pad(`"${input}" + ${prefer}`, 30)} ${pad(expected, 16)} ${pad(r.valid ? r.normalized : 'TỪ CHỐI', 16)}`,
  );
}

const total = CASES.length + CROSS_CHECK.length + PREFER_CASES.length;
console.log(`\n${'═'.repeat(78)}`);
console.log(`${total - fail}/${total} đúng${fail ? `, ${fail} SAI:` : ' — TẤT CẢ ĐẠT'}`);
failures.forEach((f) => console.log(`   ✗ ${f}`));
process.exitCode = fail ? 1 : 0;
