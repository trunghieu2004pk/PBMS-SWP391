// Đổi lỗi thô của BE ở tab "Check-in (xe vào)" thành câu staff đọc là biết phải sửa gì.
// BE trả { error: { code, message } } — map theo CODE vì code ổn định, còn message có thể đổi chữ.
// Không khớp code nào thì báo chung "Thông tin đặt chỗ không chính xác" theo yêu cầu vận hành.

// Mã quy tắc nội bộ (OR-03, BR-12…) chỉ có nghĩa với người viết tài liệu, staff đọc thấy rối
// → cắt bỏ trước khi hiện. Chỉ cắt khi nằm ở CUỐI câu, tránh xén nhầm nội dung thật.
const RULE_CODE_RE = /\s*\([A-Z]{2,3}-\d+\)\s*$/;

export function stripRuleCode(message) {
  return String(message || '').replace(RULE_CODE_RE, '').trim();
}

/** Lấy message BE đã bỏ mã quy tắc — dùng cho các ô lỗi không cần map chi tiết. */
export function plainApiError(err, fallback = 'Thao tác thất bại, vui lòng thử lại.') {
  return stripRuleCode(err?.response?.data?.error?.message) || fallback;
}

/**
 * @param err lỗi axios từ POST /sessions/checkin
 */
export function friendlyCheckinError(err) {
  const raw = err?.response?.data?.error?.message || '';
  const code = err?.response?.data?.error?.code || '';
  const clean = stripRuleCode(raw);
  const generic = 'Thông tin đặt chỗ không chính xác.';

  switch (code) {
    // ── Vé tháng ──────────────────────────────────────────────────────────────
    // BE đã ghép sẵn tên tầng vào câu (vd "có vé tháng ở tầng F1") nên hiện nguyên văn,
    // không cần FE tra lại floor_id.
    case 'PASS_WRONG_FLOOR':
    case 'PASS_VEHICLE_MISMATCH':
      return clean || 'Thông tin không khớp vé tháng của xe — quét mã QR của khách để điền sẵn.';
    case 'PASS_OUTSIDE_WINDOW':
      return 'Vé tháng đang ngoài khung giờ hiệu lực — xe vào lúc này sẽ tính phí như khách vãng lai.';

    // ── Hết chỗ ───────────────────────────────────────────────────────────────
    case 'PASS_CAPACITY_RESERVED':
      return 'Hết chỗ cho khách vãng lai — số chỗ trống còn lại đang để dành cho vé tháng.';
    case 'WALKIN_HELD_FOR_RESERVATIONS':
      return 'Hết chỗ cho khách vãng lai — số chỗ trống còn lại đang giữ cho các đơn đặt sắp tới.';

    // ── Đặt chỗ ───────────────────────────────────────────────────────────────
    case 'RESERVATION_NOT_OPEN':
      return clean || 'Chưa tới giờ vào của đơn đặt chỗ — dùng tab "Đặt chỗ vào" (sớm nhất 15 phút trước giờ đặt).';

    // ── Còn lại ───────────────────────────────────────────────────────────────
    case 'CONFLICT':
      return /active session/i.test(raw)
        ? 'Xe này đang có phiên trong bãi — phải cho xe ra trước khi check-in lượt mới.'
        : clean || generic;
    case 'VALIDATION_ERROR':
      // Lỗi định dạng biển số của BE đã đủ rõ, giữ nguyên.
      return clean || generic;
    default:
      return clean || generic;
  }
}
