/**
 * Nhận dạng & chuẩn hoá biển số xe Việt Nam — bản FE, MIRROR của server/src/utils/plateVN.js
 * (Thông tư 79/2024/TT-BCA + các định dạng đời cũ vẫn lưu hành hợp pháp).
 *
 * Mục đích: báo lỗi NGAY tại ô nhập thay vì để bấm gửi rồi mới nhận lỗi từ máy chủ.
 *
 * ⚠ PHẢI KHỚP TỪNG KÝ TỰ với bản server. Lệch nhau sinh ra 2 kiểu lỗi đều khó chịu:
 *   - FE chặt hơn BE → chặn oan biển hợp lệ, khách không vào được bãi
 *   - FE lỏng hơn BE → nhân viên gõ xong bấm gửi mới nhận lỗi
 * Sửa bên server thì sửa luôn file này, rồi chạy: npm run test:plate --prefix server
 */

// 20 chữ cái được dùng làm seri (loại I, J, O, Q, R, W).
const L = '[A-HK-NPS-VX-Z]';

// Ký hiệu riêng — nhận biển nhưng không suy ra loại xe.
const SPECIAL_SERIES = ['LD', 'DA', 'KT', 'HC', 'TĐ', 'MK', 'CD', 'CT', 'LB'];
// Xe nước ngoài / ngoại giao — định dạng riêng.
const FOREIGN_SERIES = ['NG', 'QT', 'CV', 'NN'];

// Mã tỉnh CHƯA TỪNG cấp cho tỉnh/thành nào (kể cả trước sáp nhập 01/7/2025).
// KHÔNG thêm vào đây mã đã bị khai tử sau sáp nhập — xe cũ vẫn giữ biển đó hợp pháp.
const RESERVED_PROVINCE_CODES = new Set([42, 44, 45, 46, 87, 91, 96]);

/** Giữ khớp với MOTORBIKE_TYPE_CODES bên server (utils/plateVN.js). */
const MOTORBIKE_TYPE_CODES = ['BIKE'];

export const PLATE_VN_HINT =
  'VD: 30A-123.45 (ô tô) · 68PA-045.45 hoặc 36B1-123.45 (xe máy) · 29MĐ1-123.45 (xe máy điện)';

/**
 * Dọn ô nhập. KHÔNG đổi Đ→D — làm vậy khiến biển gõ sai âm thầm biến thành một biển KHÁC
 * hợp lệ (ghi nhầm xe người khác). Đ chỉ hợp lệ trong MĐ/TĐ.
 */
export function cleanPlateInput(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-')
    // Gộp khoảng trắng thành MỘT dấu cách, KHÔNG xoá: trên biển thật dấu cách nằm giữa seri
    // và dãy số ("51-T1 1234"), chính nó phân định xe máy với ô tô. Xoá đi là tự tay vứt mất
    // thông tin rồi lại phải quay ra hỏi lại người dùng.
    .replace(/\s+/g, ' ')
    // Gom MỌI cụm dấu phân cách liền nhau về đúng 1 ký tự: "30--A", "30 - A", "30. .A".
    // Ưu tiên giữ dấu cứng (-./) vì đó mới là thứ người dùng cố ý gõ; không có thì giữ dấu cách.
    .replace(/[-./ ]{2,}/g, (run) => (run.match(/[-./]/) || [' '])[0])
    .trim();
}

const S = '[-./ ]?';
const NUM = '(\\d{3}\\.\\d{2}|\\d{4,5})';
const esc = (arr) => arr.join('|');

const formatNumber = (raw) => {
  const digits = raw.replace(/\./g, '');
  return digits.length === 5 ? `${digits.slice(0, 3)}.${digits.slice(3)}` : digits;
};

// THỨ TỰ QUAN TRỌNG: mẫu hẹp trước mẫu rộng (LD phải bắt trước seri 2 chữ chung).
const PATTERNS = [
  {
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(\\d{3})${S}(${esc(FOREIGN_SERIES)})${S}(\\d{2})$`),
    normalize: ([, prov, country, series, seq]) => `${prov}-${country}-${series}-${seq}`,
  },
  {
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(${esc(FOREIGN_SERIES)})${S}(\\d{3})${S}(\\d{2})$`),
    normalize: ([, prov, series, country, seq]) => `${prov}-${country}-${series}-${seq}`,
  },
  {
    // Xe máy điện MĐ1..MĐ9
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(MĐ)([1-9])${S}${NUM}$`),
    normalize: ([, prov, s, d, num]) => `${prov}${s}${d}-${formatNumber(num)}`,
  },
  {
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(${esc(SPECIAL_SERIES)})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
  {
    // Xe máy seri 2 chữ (dưới 50cc đời cũ; mọi xe máy từ 01/01/2025)
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(${L}${L})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
  {
    // Xe máy seri 1 chữ + 1 số
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(${L})(\\d)${S}${NUM}$`),
    normalize: ([, prov, s, d, num]) => `${prov}${s}${d}-${formatNumber(num)}`,
  },
  {
    // Ô tô: seri 1 chữ (rộng nhất nên đứng cuối)
    category: 'car',
    re: new RegExp(`^(\\d{2})${S}(${L})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
];

const fail = (error, extra = {}) => ({ valid: false, normalized: '', category: null, error, ...extra });

/** { valid, normalized, category, error } — normalized là dạng chuẩn máy chủ sẽ lưu. */
/**
 * @param input       biển số người dùng gõ
 * @param preferCategory 'car' | 'motorbike' — loại xe NGƯỜI DÙNG ĐÃ CHỌN. Chỉ dùng để gỡ nhập
 *   nhằng "gõ liền không dấu": nhân viên đã nói đây là ô tô thì 51A12345 đọc theo cách ô tô.
 *   Đây KHÔNG phải đoán — là dùng thông tin người dùng vừa khai. Không truyền thì gặp nhập
 *   nhằng sẽ từ chối và hỏi lại.
 */
export function validateAndNormalizePlateVN(input, preferCategory = null) {
  const s = cleanPlateInput(input);
  if (!s) return fail('Biển số xe không được để trống');

  if (s.includes('Đ') && !/MĐ|TĐ/.test(s)) {
    return fail('Chữ "Đ" chỉ có trong biển MĐ (xe máy điện) và TĐ — kiểm tra lại biển số');
  }

  const hits = [];
  for (const { re, normalize, category } of PATTERNS) {
    const m = s.match(re);
    if (m) hits.push({ m, category, normalized: normalize(m) });
  }
  if (hits.length === 0) {
    return fail(`Biển số không đúng định dạng Việt Nam. ${PLATE_VN_HINT}`);
  }

  const first = hits[0];
  const province = parseInt(first.m[1], 10);
  if (province < 11 || province > 99) {
    return fail('Mã tỉnh/thành (2 số đầu) phải từ 11 đến 99');
  }
  if (RESERVED_PROVINCE_CODES.has(province)) {
    return fail(`Mã tỉnh "${first.m[1]}" chưa được cấp cho tỉnh/thành nào — kiểm tra lại biển số`);
  }

  // NHẬP NHẰNG THẬT khi gõ liền không dấu: 8 ký tự đọc được CẢ HAI cách —
  //   30A12345 → 30A-123.45 (ô tô) hoặc 30A1-2345 (xe máy). Cả hai đều hợp lệ ngoài đời.
  // Tự chọn một cách là đoán thay người dùng; đoán sai thì nhân viên nhận về câu "biển xe máy
  // nhưng bạn chọn ô tô" với một biển họ không hề gõ. Hỏi lại rẻ hơn đoán sai.
  const other = hits.find(
    (h) => (h.category === 'car' || h.category === 'motorbike')
      && (first.category === 'car' || first.category === 'motorbike')
      && h.category !== first.category,
  );
  if (other) {
    // Nhân viên đã chọn loại xe → dùng chính lựa chọn đó để gỡ mơ hồ, khỏi bắt gõ lại.
    const picked = [first, other].find((h) => h.category === preferCategory);
    if (picked) {
      return { valid: true, normalized: picked.normalized, category: picked.category, error: null };
    }
    const label = (c) => (c === 'car' ? 'ô tô' : 'xe máy');
    return fail(
      `Biển "${s}" đọc được hai cách: ${first.normalized} (${label(first.category)}) `
      + `hoặc ${other.normalized} (${label(other.category)}). `
      + 'Chọn Loại xe trước, hoặc gõ kèm dấu gạch — ví dụ 30A-123.45 hoặc 30A1-2345.',
      { ambiguous: true },
    );
  }

  return { valid: true, normalized: first.normalized, category: first.category, error: null };
}

/** Chuẩn hoá nếu hợp lệ, không thì trả lại nguyên input đã dọn (để không nuốt chữ đang gõ dở). */
export function normalizePlateOrKeep(input, preferCategory = null) {
  const result = validateAndNormalizePlateVN(input, preferCategory);
  return result.valid ? result.normalized : cleanPlateInput(input);
}

/** Mã loại xe (type_code) → nhóm biển tương ứng, để gỡ nhập nhằng lúc gõ liền không dấu. */
export function categoryOfVehicleType(typeCode) {
  if (!typeCode) return null;
  return MOTORBIKE_TYPE_CODES.includes(typeCode) ? 'motorbike' : 'car';
}
