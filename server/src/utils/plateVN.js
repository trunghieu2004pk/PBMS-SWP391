/**
 * DV-01 — Nhận dạng & chuẩn hoá biển số xe Việt Nam.
 *
 * Căn cứ: Thông tư 79/2024/TT-BCA (hiệu lực 01/01/2025) + các định dạng đời cũ VẪN LƯU HÀNH
 * HỢP PHÁP — xe đăng ký trước 01/7/2025 không phải đổi biển, nên hệ thống buộc phải nhận cả
 * biển cũ lẫn biển mới.
 *
 * NGUYÊN TẮC: nhận dạng RỘNG RÃI ở đầu vào, lưu MỘT dạng chuẩn duy nhất ở đầu ra.
 * Thà nhận nhầm một biển lạ còn hơn ĐUỔI một khách thật — nhân viên không có cách nào
 * ghi đè khi hệ thống từ chối, nên từ chối nhầm là khách quay xe đi luôn.
 *
 * Bộ kiểm tra: npm run test:plate --prefix server
 */

/* ─────────────────────────── Bảng tra cứu ─────────────────────────── */

// 20 chữ cái được dùng làm seri (loại I, J, O, Q, R, W — dễ nhầm với chữ số hoặc không dùng).
const L = '[A-HK-NPS-VX-Z]';

/**
 * Ký hiệu RIÊNG cho nhóm xe đặc thù. Nhận biển nhưng KHÔNG suy ra loại xe:
 * phần lớn là ô tô, nhưng không có gì bảo đảm, mà đoán sai thì chặn nhầm khách.
 *   LD  doanh nghiệp có vốn nước ngoài      DA  ban quản lý dự án
 *   KT  doanh nghiệp quân đội               HC  ô tô hạn chế phạm vi hoạt động
 *   TĐ  xe lắp ráp trong nước, thí điểm     MK  máy kéo
 *   CD  xe máy chuyên dùng                  CT / LB  loại trừ khỏi seri xe máy
 * (RM/R rơ moóc CỐ Ý không nhận: xe kéo rơ moóc không vào bãi, mà R lại hay bị gõ nhầm từ P/B.)
 */
const SPECIAL_SERIES = ['LD', 'DA', 'KT', 'HC', 'TĐ', 'MK', 'CD', 'CT', 'LB'];

/** Seri của xe nước ngoài / ngoại giao — có định dạng riêng hẳn (xem FOREIGN_PATTERNS). */
const FOREIGN_SERIES = ['NG', 'QT', 'CV', 'NN'];

/**
 * Mã tỉnh DỰ TRỮ — chưa từng cấp cho tỉnh/thành nào, kể cả trước đợt sáp nhập 01/7/2025.
 * Chặn để bắt lỗi gõ nhầm.
 *
 * CẢNH BÁO cho người sửa sau: chỉ được thêm vào đây mã CHƯA TỪNG CẤP. Mã bị KHAI TỬ sau sáp
 * nhập (tỉnh cũ nay đã nhập vào tỉnh khác) thì TUYỆT ĐỐI KHÔNG chặn — xe đăng ký trước đó vẫn
 * giữ biển cũ hợp pháp, chặn là đuổi khách thật hàng loạt.
 */
const RESERVED_PROVINCE_CODES = new Set([42, 44, 45, 46, 87, 91, 96]);

// type_code được coi là XE MÁY. Mọi loại khác (CAR, CAR7…) coi là ô tô.
export const MOTORBIKE_TYPE_CODES = ['BIKE', 'EVBIKE'];

export const PLATE_VN_HINT =
  'VD: 30A-123.45 (ô tô) · 68PA-045.45 hoặc 36B1-123.45 (xe máy) · 29MĐ1-123.45 (xe máy điện)';

/* ─────────────────────────── Chuẩn hoá đầu vào ─────────────────────────── */

/**
 * Dọn đầu vào về dạng dễ khớp mẫu. KHÔNG đổi Đ→D: trước đây làm vậy khiến "30Ađ-12345" âm thầm
 * biến thành "30AD-123.45" — một biển KHÁC, hoàn toàn hợp lệ, tức là ghi nhầm xe của người khác.
 * Giờ Đ chỉ hợp lệ trong MĐ/TĐ, còn lại báo lỗi cho nhân viên gõ lại.
 */
export function cleanPlateInput(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[–—]/g, '-') // các loại gạch dài unicode → gạch thường
    // Gộp khoảng trắng thành MỘT dấu cách, KHÔNG xoá: trên biển thật dấu cách nằm giữa seri
    // và dãy số ("51-T1 1234"), chính nó phân định xe máy với ô tô. Xoá đi là tự tay vứt mất
    // thông tin rồi lại phải quay ra hỏi lại người dùng.
    .replace(/\s+/g, ' ')
    // Gom MỌI cụm dấu phân cách liền nhau về đúng 1 ký tự: "30--A", "30 - A", "30. .A".
    // Ưu tiên giữ dấu cứng (-./) vì đó mới là thứ người dùng cố ý gõ; không có thì giữ dấu cách.
    .replace(/[-./ ]{2,}/g, (run) => (run.match(/[-./]/) || [' '])[0])
    .trim();
}

/** Dấu phân cách tuỳ chọn giữa các nhóm (khoảng trắng đã bị bỏ ở bước dọn). */
const S = '[-./ ]?';

/** 4 hoặc 5 chữ số, dấu chấm ở giữa tuỳ ý: 1234 | 12345 | 123.45 */
const NUM = '(\\d{3}\\.\\d{2}|\\d{4,5})';

/** "123.45"|"12345" → "123.45"; "1234" → "1234" (biển 4 số đời cũ giữ nguyên). */
const formatNumber = (raw) => {
  const digits = raw.replace(/\./g, '');
  return digits.length === 5 ? `${digits.slice(0, 3)}.${digits.slice(3)}` : digits;
};

/* ─────────────────────────── Mẫu nhận dạng ───────────────────────────
 * THỨ TỰ QUAN TRỌNG: mẫu hẹp phải đứng trước mẫu rộng.
 * Ví dụ "30LD-12345" vừa khớp ký hiệu riêng LD vừa khớp seri 2 chữ của xe máy — phải bắt LD trước.
 */

const esc = (arr) => arr.join('|');

const FOREIGN_PATTERNS = [
  {
    // Dạng chuẩn: 80-441-NG-02 (tỉnh · mã nước 3 số · seri · thứ tự 2 số)
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(\\d{3})${S}(${esc(FOREIGN_SERIES)})${S}(\\d{2})$`),
    normalize: ([, prov, country, series, seq]) => `${prov}-${country}-${series}-${seq}`,
  },
  {
    // Dạng viết trên xe, seri đứng trước: 80-NN 168-06 → chuẩn hoá về dạng trên.
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(${esc(FOREIGN_SERIES)})${S}(\\d{3})${S}(\\d{2})$`),
    normalize: ([, prov, series, country, seq]) => `${prov}-${country}-${series}-${seq}`,
  },
];

const DOMESTIC_PATTERNS = [
  {
    // Xe máy điện: seri MĐ1..MĐ9 hoặc MĐ — 2 chữ + 1 số (tùy chọn). Phải đứng TRƯỚC ký hiệu riêng lẫn seri 2 chữ.
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(MĐ)([1-9]?)${S}${NUM}$`),
    normalize: ([, prov, s, d, num]) => `${prov}${s}${d}-${formatNumber(num)}`,
  },
  {
    // Ký hiệu riêng (LD, DA, KT, HC, TĐ, MK, CD, CT, LB) — không suy ra loại xe.
    category: 'either',
    re: new RegExp(`^(\\d{2})${S}(${esc(SPECIAL_SERIES)})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
  {
    // Xe máy seri 2 CHỮ: dưới 50cc đời cũ, và MỌI xe máy đăng ký từ 01/01/2025.
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(${L}${L})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
  {
    // Xe máy seri 1 CHỮ + 1 SỐ: 50–175cc (B1, F2…) và ≥175cc (A1, A2…).
    category: 'motorbike',
    re: new RegExp(`^(\\d{2})${S}(${L})(\\d)${S}${NUM}$`),
    normalize: ([, prov, s, d, num]) => `${prov}${s}${d}-${formatNumber(num)}`,
  },
  {
    // Ô TÔ: seri 1 CHỮ. Đứng CUỐI vì rộng nhất.
    // An toàn: mọi seri xe máy đều tối thiểu 2 ký tự (chữ+số hoặc 2 chữ), nên seri đúng 1 chữ
    // chỉ có thể là ô tô.
    category: 'car',
    re: new RegExp(`^(\\d{2})${S}(${L})${S}${NUM}$`),
    normalize: ([, prov, series, num]) => `${prov}${series}-${formatNumber(num)}`,
  },
];

/* ─────────────────────────── Hàm chính ─────────────────────────── */

const fail = (error, extra = {}) => ({ valid: false, normalized: '', category: null, error, ...extra });

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

  // Bắt sớm chữ Đ dùng sai chỗ để báo lỗi nói đúng vấn đề, thay vì câu "sai định dạng" chung chung.
  if (s.includes('Đ') && !/MĐ|TĐ/.test(s)) {
    return fail('Chữ "Đ" chỉ có trong biển MĐ (xe máy điện) và TĐ — kiểm tra lại biển số');
  }

  const ALL = [...FOREIGN_PATTERNS, ...DOMESTIC_PATTERNS];
  const hits = [];
  for (const { re, normalize, category } of ALL) {
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

  /**
   * NHẬP NHẰNG THẬT khi gõ liền không dấu: 8 ký tự đọc được CẢ HAI cách —
   *   30A12345 → 30A-123.45 (ô tô: seri 1 chữ + 5 số)
   *            → 30A1-2345  (xe máy: seri chữ+số + 4 số)
   * Cả hai đều là biển hợp lệ ngoài đời. Tự chọn một cách là đoán thay người dùng, mà đoán sai
   * thì nhân viên nhận về câu "biển xe máy nhưng bạn chọn ô tô" với một biển họ không hề gõ —
   * không tài nào hiểu chuyện gì. Hỏi lại rẻ hơn nhiều so với đoán sai.
   *
   * Chỉ xét khi hai cách đọc ra HAI LOẠI XE khác nhau. Ký hiệu riêng (LD, KT…) và biển nước
   * ngoài mang category 'either' nên giữ nguyên thứ tự ưu tiên như cũ, không bị coi là nhập nhằng.
   */
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

export function normalizePlateVN(input) {
  const result = validateAndNormalizePlateVN(input);
  if (!result.valid) throw new Error(result.error);
  return result.normalized;
}

/**
 * Biển (theo category) có khớp loại xe nhân viên đã chọn không?
 *
 * 'either' LUÔN khớp — đó là van an toàn: với ký hiệu riêng và biển nước ngoài thì không suy
 * được loại xe, mà đoán sai sẽ CHẶN CỨNG người đang đứng ở quầy. Thà bỏ lọt một lần chọn nhầm
 * loại xe (nhân viên nhìn thấy chiếc xe trước mặt) còn hơn không cho khách vào bãi.
 */
export function plateMatchesVehicleType(category, typeCode) {
  if (!category || category === 'either') return true;
  const expected = MOTORBIKE_TYPE_CODES.includes(typeCode) ? 'motorbike' : 'car';
  return category === expected;
}
