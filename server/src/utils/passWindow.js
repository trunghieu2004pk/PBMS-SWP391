export const parseTimeToMinutes = (timeVal) => {
  if (!timeVal) return 0;
  const str = typeof timeVal === 'string' ? timeVal : String(timeVal);
  const parts = str.split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
};

/**
 * Vé có hiệu lực tại thời điểm này không — kiểm 2 lớp: KHOẢNG NGÀY (start_date..end_date) và
 * KHUNG GIỜ trong ngày (valid_from_time..valid_to_time, snapshot giờ mở cửa tòa lúc mua).
 */
export const isWithinPassWindow = (pass, dateTime) => {
  if (!pass || pass.status !== 'active') return false;   // pending/cancelled/expired đều không dùng được

  const d = new Date(dateTime);
  const start = new Date(pass.start_date);
  start.setHours(0, 0, 0, 0);                         // nới ra cả ngày: vé ngày đầu vào từ 00:00
  const end = new Date(pass.end_date);
  end.setHours(23, 59, 59, 999);                      // ...và ngày cuối dùng hết đêm, không cắt lúc 00:00

  if (d < start || d > end) return false;

  const minutes = d.getHours() * 60 + d.getMinutes();
  const from = parseTimeToMinutes(pass.valid_from_time);
  const to = parseTimeToMinutes(pass.valid_to_time);
  // Khung qua nửa đêm (from > to, vd 22:00→06:00): hợp lệ nếu sau 'from' HOẶC trước 'to'
  if (from > to) return minutes >= from || minutes <= to;
  return minutes >= from && minutes <= to;
};

// Miễn phí chỉ khi CẢ vào lẫn ra đều trong khung. Vào đúng khung rồi đỗ lố ra ngoài khung là
// phải trả tiền — không thì quét vào lúc 21:59 rồi để xe cả tuần vẫn free.
export const isSessionFreeUnderPass = (pass, timeIn, timeOut) =>
  isWithinPassWindow(pass, timeIn) && isWithinPassWindow(pass, timeOut);

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * Các KHOẢNG thời gian mà vé BAO, cắt trong [timeIn, timeOut].
 *
 * Duyệt theo từng ngày lịch vì khung giờ vé lặp lại mỗi ngày. Bắt đầu lùi 1 ngày để khung qua
 * nửa đêm (vd 22:00→06:00) mở từ hôm trước vẫn phủ được phần sáng sớm hôm nay.
 */
const coveredRangesUnderPass = (pass, timeIn, timeOut) => {
  if (!pass || pass.status !== 'active') return [];

  const from = parseTimeToMinutes(pass.valid_from_time);
  const to = parseTimeToMinutes(pass.valid_to_time);
  // +1 phút vì valid_to_time là mốc BAO GỒM: khung tới 22:00 thì 22:00:59 vẫn trong khung
  // (isWithinPassWindow so theo phút, bỏ giây). Thiếu +1 thì vé cả ngày 00:00–23:59 hụt 1 phút
  // mỗi ngày và khách bị thu tiền oan.
  const spanMs = ((from > to ? to + 24 * 60 - from : to - from) + 1) * 60 * 1000;

  // Vé chỉ có giá trị trong khoảng NGÀY đã mua — cắt luôn ở đây cho khớp isWithinPassWindow.
  const validFrom = startOfDay(pass.start_date).getTime();
  const validTo = startOfDay(pass.end_date).getTime() + DAY_MS - 1;

  const lo = new Date(timeIn).getTime();
  const hi = new Date(timeOut).getTime();
  const ranges = [];

  for (let day = startOfDay(lo).getTime() - DAY_MS; day <= hi; day += DAY_MS) {
    const openAt = day + from * 60 * 1000;
    const s = Math.max(openAt, lo, validFrom);
    const e = Math.min(openAt + spanMs, hi, validTo);
    if (e > s) ranges.push([s, e]);
  }
  return ranges;
};

/**
 * Số PHÚT phải trả tiền của một lượt gửi dùng vé tháng = tổng thời gian đỗ trừ phần vé đã bao.
 *
 * Vì sao không dùng isSessionFreeUnderPass rồi tính lại từ đầu: khách đã trả tiền cả tháng mà
 * ra trễ 1 tiếng thì chỉ nợ 1 tiếng đó, không phải nợ lại cả ngày. Chỉ thu phần THẬT SỰ nằm
 * ngoài khung vé.
 */
export const billableMinutesUnderPass = (pass, timeIn, timeOut) => {
  const lo = new Date(timeIn).getTime();
  const hi = new Date(timeOut).getTime();
  const totalMs = hi - lo;
  if (totalMs <= 0) return 0;

  // Các khoảng sinh theo ngày tăng dần và không chồng nhau (span ≤ 24h) nên cộng thẳng được.
  const coveredMs = coveredRangesUnderPass(pass, timeIn, timeOut)
    .reduce((sum, [s, e]) => sum + (e - s), 0);

  return Math.max(0, (totalMs - coveredMs) / (1000 * 60));
};

export const normalizeTimeInput = (value) => {
  if (!value) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
};
