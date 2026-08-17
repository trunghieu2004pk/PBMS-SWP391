/**
 * Danh sách ngân hàng tại Việt Nam (Local Static Dictionary)
 * Lưu trữ mã, tên ngắn gọn (shortName), tên đầy đủ và các từ khóa tìm kiếm/viết tắt (aliases).
 */
export const VIETNAM_BANKS = [
  { code: 'VCB', shortName: 'VIETCOMBANK', name: 'Ngân hàng TMCP Ngoại Thương Việt Nam', aliases: ['VCB', 'VIETCOMBANK', 'NGOAI THUONG'] },
  { code: 'CTG', shortName: 'VIETINBANK', name: 'Ngân hàng TMCP Công Thương Việt Nam', aliases: ['CTG', 'VIETINBANK', 'CONG THUONG'] },
  { code: 'BIDV', shortName: 'BIDV', name: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam', aliases: ['BIDV', 'DAU TU VA PHAT TRIEN'] },
  { code: 'VBA', shortName: 'AGRIBANK', name: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', aliases: ['VBA', 'AGRIBANK', 'NONG NGHIEP'] },
  { code: 'TCB', shortName: 'TECHCOMBANK', name: 'Ngân hàng TMCP Kỹ Thương Việt Nam', aliases: ['TCB', 'TECHCOMBANK', 'KY THUONG'] },
  { code: 'MB', shortName: 'MBBANK', name: 'Ngân hàng TMCP Quân Đội', aliases: ['MB', 'MBBANK', 'QUAN DOI'] },
  { code: 'ACB', shortName: 'ACB', name: 'Ngân hàng TMCP Á Châu', aliases: ['ACB', 'A CHAU'] },
  { code: 'VPB', shortName: 'VPBANK', name: 'Ngân hàng TMCP Việt Nam Thịnh Vượng', aliases: ['VPB', 'VPBANK', 'THINH VUONG'] },
  { code: 'TPB', shortName: 'TPBANK', name: 'Ngân hàng TMCP Tiên Phong', aliases: ['TPB', 'TPBANK', 'TIEN PHONG'] },
  { code: 'STB', shortName: 'SACOMBANK', name: 'Ngân hàng TMCP Sài Gòn Thương Tín', aliases: ['STB', 'SACOMBANK', 'SAI GON THUONG TIN'] },
  { code: 'HDB', shortName: 'HDBANK', name: 'Ngân hàng TMCP Phát triển TP.HCM', aliases: ['HDB', 'HDBANK', 'PHAT TRIEN'] },
  { code: 'VIB', shortName: 'VIB', name: 'Ngân hàng TMCP Quốc Tế Việt Nam', aliases: ['VIB', 'QUOC TE'] },
  { code: 'MSB', shortName: 'MSB', name: 'Ngân hàng TMCP Hàng Hải Việt Nam', aliases: ['MSB', 'HANG HAI', 'MARITIME'] },
  { code: 'SHB', shortName: 'SHB', name: 'Ngân hàng TMCP Sài Gòn - Hà Nội', aliases: ['SHB', 'SAI GON HA NOI'] },
  { code: 'LPB', shortName: 'LPBANK', name: 'Ngân hàng TMCP Lộc Phát Việt Nam', aliases: ['LPB', 'LPBANK', 'LIENVIETPOSTBANK', 'LIEN VIET'] },
  { code: 'SSB', shortName: 'SEABANK', name: 'Ngân hàng TMCP Đông Nam Á', aliases: ['SSB', 'SEABANK', 'DONG NAM A'] },
  { code: 'OCB', shortName: 'OCB', name: 'Ngân hàng TMCP Phương Đông', aliases: ['OCB', 'PHUONG DONG'] },
  { code: 'EIB', shortName: 'EXIMBANK', name: 'Ngân hàng TMCP Xuất Nhập Khẩu Việt Nam', aliases: ['EIB', 'EXIMBANK', 'XUAT NHAP KHAU'] },
  { code: 'SCB', shortName: 'SCB', name: 'Ngân hàng TMCP Sài Gòn', aliases: ['SCB', 'SAI GON'] },
  { code: 'BAB', shortName: 'BAC A BANK', name: 'Ngân hàng TMCP Bắc Á', aliases: ['BAB', 'BAC A', 'BACA'] },
  { code: 'BVB', shortName: 'BAOVIET BANK', name: 'Ngân hàng TMCP Bảo Việt', aliases: ['BVB', 'BAO VIET', 'BAOVIET'] },
  { code: 'VAB', shortName: 'VIET A BANK', name: 'Ngân hàng TMCP Việt Á', aliases: ['VAB', 'VIET A', 'VIETA'] },
  { code: 'VBB', shortName: 'VIETBANK', name: 'Ngân hàng TMCP Việt Nam Thương Tín', aliases: ['VBB', 'VIETBANK'] },
  { code: 'NAB', shortName: 'NAM A BANK', name: 'Ngân hàng TMCP Nam Á', aliases: ['NAB', 'NAM A', 'NAMA'] },
  { code: 'KLB', shortName: 'KIENLONG BANK', name: 'Ngân hàng TMCP Kiên Long', aliases: ['KLB', 'KIEN LONG', 'KIENLONG'] },
  { code: 'PGB', shortName: 'PGBANK', name: 'Ngân hàng TMCP Thịnh vượng và Phát triển', aliases: ['PGB', 'PGBANK', 'PETROLIMEX'] },
  { code: 'NCB', shortName: 'NCB', name: 'Ngân hàng TMCP Quốc Dân', aliases: ['NCB', 'QUOC DAN', 'NAVIBANK'] },
  { code: 'GPB', shortName: 'GPBANK', name: 'Ngân hàng TNHH MTV Dầu Khí Toàn Cầu', aliases: ['GPB', 'GPBANK', 'DAU KHI TOAN CAU'] },
  { code: 'OJB', shortName: 'OCEANBANK', name: 'Ngân hàng TNHH MTV Đại Dương', aliases: ['OJB', 'OCEANBANK', 'DAI DUONG'] },
  { code: 'VRB', shortName: 'VRB', name: 'Ngân hàng Liên doanh Việt - Nga', aliases: ['VRB', 'VIET NGA'] },
  { code: 'PBVN', shortName: 'PUBLIC BANK', name: 'Ngân hàng TNHH MTV Public Việt Nam', aliases: ['PUBLIC', 'PUBLIC BANK'] },
  { code: 'HLBVN', shortName: 'HONG LEONG BANK', name: 'Ngân hàng TNHH MTV Hong Leong Việt Nam', aliases: ['HONG LEONG'] },
  { code: 'SHBVN', shortName: 'SHINHAN BANK', name: 'Ngân hàng TNHH MTV Shinhan Việt Nam', aliases: ['SHINHAN'] },
  { code: 'WVN', shortName: 'WOORI BANK', name: 'Ngân hàng TNHH MTV Woori Việt Nam', aliases: ['WOORI'] },
  { code: 'SCVN', shortName: 'STANDARD CHARTERED', name: 'Ngân hàng TNHH MTV Standard Chartered Việt Nam', aliases: ['STANDARD CHARTERED'] },
  { code: 'HSBC', shortName: 'HSBC', name: 'Ngân hàng TNHH MTV HSBC Việt Nam', aliases: ['HSBC'] },
  { code: 'CITI', shortName: 'CITIBANK', name: 'Ngân hàng Citibank Việt Nam', aliases: ['CITIBANK', 'CITI'] },
  { code: 'CBBANK', shortName: 'CBBANK', name: 'Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam', aliases: ['CBBANK', 'XAY DUNG'] },
  { code: 'SAIGONBANK', shortName: 'SAIGONBANK', name: 'Ngân hàng TMCP Sài Gòn Công Thương', aliases: ['SAIGONBANK', 'SGICB'] },
  { code: 'DONGABANK', shortName: 'DONG A BANK', name: 'Ngân hàng TMCP Đông Á', aliases: ['DAB', 'DONG A', 'DONGA'] },
  { code: 'KASIKORN', shortName: 'KASIKORNBANK', name: 'Ngân hàng KASIKORNBANK', aliases: ['KASIKORN', 'KBANK'] },
];

/**
 * Chuẩn hóa chuỗi tìm kiếm: bỏ dấu tiếng Việt, viết hoa, rút gọn khoảng trắng.
 */
export const normalizeBankSearch = (str) => {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Tra cứu ngân hàng từ chuỗi nhập của người dùng.
 * Trả về đối tượng ngân hàng khớp nhất trong danh sách tĩnh, hoặc null nếu không khớp.
 */
export const findMatchingBank = (userInput) => {
  const clean = normalizeBankSearch(userInput);
  if (!clean) return null;

  // 1. Tìm khớp chính xác với code, shortName hoặc alias
  const exact = VIETNAM_BANKS.find(
    (b) =>
      b.code === clean ||
      b.shortName === clean ||
      b.aliases.some((a) => a === clean),
  );
  if (exact) return exact;

  // 2. Tìm khớp tương đối (chứa hoặc được chứa)
  const partial = VIETNAM_BANKS.find(
    (b) =>
      b.shortName.includes(clean) ||
      clean.includes(b.shortName) ||
      b.aliases.some((a) => clean.includes(a) || a.includes(clean)),
  );
  return partial || null;
};

/**
 * Kiểm tra tên ngân hàng nhập vào có thuộc danh sách ngân hàng Việt Nam hợp lệ hay không.
 */
export const isValidBankName = (userInput) => Boolean(findMatchingBank(userInput));

/**
 * Tìm danh sách ngân hàng gợi ý cho tính năng Autocomplete.
 */
export const searchVietnamBanks = (keyword, limit = 8) => {
  const clean = normalizeBankSearch(keyword);
  if (!clean) return VIETNAM_BANKS.slice(0, limit);

  return VIETNAM_BANKS.filter(
    (b) =>
      b.code.includes(clean) ||
      b.shortName.includes(clean) ||
      normalizeBankSearch(b.name).includes(clean) ||
      b.aliases.some((a) => a.includes(clean) || clean.includes(a)),
  ).slice(0, limit);
};
