import { useEffect, useMemo, useState } from 'react';
import { systemSettingsApi } from '../../api/settings';
import Card, { CardHeader } from '../../components/ui/Card';
import Field, { ErrorAlert } from '../../components/ui/Field';
import { inputClass } from '../../components/ui/Input';
import MoneyInput from '../../components/ui/MoneyInput';
import Button from '../../components/ui/Button';
import { toast } from '../../components/ui/toast';

// 11 field Manager được sửa (whitelist BE). GET trả thêm field khác (slot_suggest_strategy,
// booking_*...) — CHỈ đọc/gửi lại đúng 11 key này, không đụng phần còn lại.
const MONEY_GROUP = [
  {
    key: 'booking_fee',
    label: 'Phí giữ chỗ (đặt trước)',
    // Hay bị nhầm với tiền gửi xe. Nói rõ: thu MỘT LẦN lúc đặt, KHÔNG phải tiền gửi xe
    // theo giờ (tiền đó nằm ở Quy tắc giá) và không trừ vào tiền gửi xe khi ra.
    hint: 'VND — thu 1 lần khi khách đặt chỗ trước. KHÔNG phải tiền gửi xe theo giờ (xem Quy tắc giá) và không trừ vào tiền gửi xe.',
  },
  { key: 'monthly_pass_price', label: 'Giá vé tháng', hint: 'VND — số ≥ 0' },
  {
    key: 'lost_ticket_fee',
    label: 'Phí cấp lại vé (xe ra khi không có mã)',
    // Đây là PHÍ DỊCH VỤ đã niêm yết, không phải tiền phạt — bãi tư nhân không có thẩm quyền
    // phạt, và phạt vi phạm hợp đồng phải có thỏa thuận trước (Điều 418 BLDS 2015).
    //
    // Khoản này bù cho VẬT ĐÃ PHÁT: khách vãng lai được phát vé in nên mất thì tốn giấy in
    // lại. Khách vé tháng / đặt chỗ giữ mã trong ứng dụng — bãi không phát vật gì, mất điện
    // thoại thì tra lại bằng biển số, nên bãi không in vé giấy thì để 0.
    hint: 'VND — số ≥ 0. Phí dịch vụ đã niêm yết (không phải tiền phạt), bù chi phí in lại vé cho khách vãng lai. Đặt 0 nếu bãi không phát vé giấy — khi đó chỉ ghi phiếu sự cố và đối chiếu giấy tờ, không thu tiền.',
  },
  { key: 'overstay_fee', label: 'Phụ thu quá giờ', hint: 'VND — số ≥ 0' },
];

const REFUND_GROUP = [
  { key: 'pass_refund_trial_days', label: 'Số ngày đầu hưởng ưu đãi hoàn', hint: 'Số nguyên ≥ 0', kind: 'int0' },
  { key: 'pass_refund_trial_percent', label: '% hoàn trong mấy ngày đầu', hint: '0 – 100', kind: 'percent' },
  { key: 'pass_refund_half_term_percent', label: '% hoàn tới hết nửa hạn', hint: '0 – 100', kind: 'percent' },
  { key: 'pass_refund_bank_info_ttl_days', label: 'Hạn cập nhật STK nhận hoàn (ngày)', hint: 'Số nguyên ≥ 0', kind: 'int0' },
];

// Hoàn phí GIỮ CHỖ (đặt chỗ) — khác nhóm trên (vé tháng). Mốc cutoff cho phép lẻ (0.5 = 30 phút)
// nên dùng kind riêng 'hours0' với step 0.5, không ép số nguyên như 'int0'.
const BOOKING_REFUND_GROUP = [
  { key: 'booking_refund_cutoff_hours', label: 'Hủy trước giờ vào ≥ (giờ) mới được hoàn', hint: 'Số ≥ 0 — cho phép lẻ, VD 0.5 = 30 phút', kind: 'hours0' },
  { key: 'booking_refund_percent', label: '% hoàn phí giữ chỗ', hint: '0 – 100 — đặt 0 là không hoàn', kind: 'percent' },
];

const EDITABLE_KEYS = [
  'booking_fee', 'monthly_pass_price', 'lost_ticket_fee', 'overstay_fee', 'max_parking_hours',
  'booking_refund_cutoff_hours', 'booking_refund_percent',
  'pass_refund_trial_days', 'pass_refund_trial_percent', 'pass_refund_half_term_percent',
  'pass_refund_bank_info_ttl_days',
];

// --- Ảnh hiện trạng xe + người lái (migration 010) ----------------------------
// Giữ RIÊNG khỏi EDITABLE_KEYS: nhóm trên toàn số (normalize -> Number), nhóm này có
// boolean + chuỗi + mảng nên nhét chung sẽ bị Number() nuốt mất giá trị.
// CHỈ 4 thứ người vận hành thật sự cần quyết. Ngưỡng ảnh-quá-cũ và độ-nhạy-chặn-trùng-cảnh
// cố ý KHÔNG đưa lên đây: đó là hằng số kỹ thuật (server/src/utils/settings.js), quản lý bãi
// không có căn cứ nào để chỉnh, bày ra chỉ làm rối màn hình.
const PHOTO_KEYS = [
  'require_entry_photo', 'require_exit_photo',
  'photo_required_kinds', 'photo_retention_days',
];

const PHOTO_KIND_OPTIONS = [
  { id: 'front', label: 'Đầu xe' },
  { id: 'left', label: 'Bên trái' },
  { id: 'rear', label: 'Đuôi xe' },
  { id: 'right', label: 'Bên phải' },
  { id: 'driver', label: 'Người lái' },
];

const PHOTO_DEFAULTS = {
  require_entry_photo: true,
  require_exit_photo: true,
  photo_required_kinds: ['front', 'left', 'rear', 'right', 'driver'],
  photo_retention_days: 90,
};

const readPhotoSettings = (data) => ({
  require_entry_photo: Boolean(data.require_entry_photo),
  require_exit_photo: Boolean(data.require_exit_photo),
  photo_required_kinds: Array.isArray(data.photo_required_kinds) && data.photo_required_kinds.length
    ? data.photo_required_kinds
    : PHOTO_DEFAULTS.photo_required_kinds,
  photo_retention_days: Number(data.photo_retention_days ?? PHOTO_DEFAULTS.photo_retention_days),
});

// So sánh nông; riêng mảng góc ảnh so theo NỘI DUNG (không phụ thuộc thứ tự) để
// tick rồi bỏ tick về như cũ thì không bị coi là "có thay đổi chưa lưu".
const photoValueChanged = (key, next, base) => {
  if (key === 'photo_required_kinds') {
    const a = [...(next || [])].sort().join(',');
    const b = [...(base || [])].sort().join(',');
    return a !== b;
  }
  // Ô number trả về CHUỖI. So thẳng thì gõ lại đúng số cũ ("90" !== 90) vẫn bị coi là đổi.
  if (key === 'photo_retention_days') return Number(next) !== Number(base);
  return next !== base;
};

// Chuẩn hóa giá trị từ BE về number | null để so sánh "có đổi hay không".
const normalize = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// --- Đơn vị thời gian cho `max_parking_hours` ---------------------------------
// BE lưu chuẩn theo GIỜ (số, cho phép lẻ). Manager nhập theo đơn vị tự chọn, FE quy đổi
// về giờ trước khi gửi. Đơn vị KHÔNG lưu ở BE — chỉ là cách nhập/hiện.
const DURATION_UNITS = [
  { id: 'minutes', label: 'Phút' },
  { id: 'hours', label: 'Giờ' },
];
const toHours = (v, unit) => (unit === 'minutes' ? v / 60 : v);
// Làm tròn 6 số lẻ khi HIỆN để tránh rác dấu phẩy động (1.6666666666666667 × 60 = 100.00000000000001).
const fromHours = (h, unit) => (unit === 'minutes' ? Math.round(h * 60 * 1e6) / 1e6 : h);
const nearlyInt = (n) => Math.abs(n - Math.round(n)) < 1e-6;
// Giờ nguyên → hiện "Giờ"; lẻ mà chia hết ra phút → hiện "Phút"; còn lại → "Giờ".
const pickUnit = (h) => {
  if (h === null || Number.isNaN(h)) return 'hours';
  if (Number.isInteger(h)) return 'hours';
  return nearlyInt(h * 60) ? 'minutes' : 'hours';
};
// number|null (giờ) → {value, unit} cho ô nhập. Không giới hạn (null) hiện thành 0.
const hoursToDuration = (h) => {
  if (h === null || Number.isNaN(h)) return { value: '0', unit: 'hours' };
  const unit = pickUnit(h);
  return { value: String(fromHours(h, unit)), unit };
};

export default function SettingsPage() {
  const [initial, setInitial] = useState(null); // {key: number|null} — mốc so sánh
  const [form, setForm] = useState({}); // {key: string} — giá trị ô nhập
  // Ô "Giờ gửi tối đa" nhập theo đơn vị chọn — giữ riêng, không dùng form.max_parking_hours.
  const [maxDuration, setMaxDuration] = useState({ value: '', unit: 'hours' });
  // Ảnh hiện trạng — state riêng vì có boolean/mảng, không đi qua normalize() số.
  const [photo, setPhoto] = useState(PHOTO_DEFAULTS);
  const [photoInitial, setPhotoInitial] = useState(PHOTO_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await systemSettingsApi.get();
        if (!active) return;
        const data = res.data.data || {};
        const base = {};
        const formVals = {};
        for (const key of EDITABLE_KEYS) {
          const n = normalize(data[key]);
          base[key] = n;
          formVals[key] = n === null ? '' : String(n);
        }
        setInitial(base);
        setForm(formVals);
        setMaxDuration(hoursToDuration(base.max_parking_hours));
        const p = readPhotoSettings(data);
        setPhoto(p);
        setPhotoInitial(p);
      } catch (err) {
        setError(err.response?.data?.error?.message || 'Không tải được cấu hình hệ thống');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Giờ gửi tối đa quy về GIỜ (number|null|NaN) — nguồn để so sánh/gửi/validate.
  // 0 = KHÔNG giới hạn → gửi null (BE lưu null; getMaxParkingHours() coi <= 0 là không giới hạn).
  // Bỏ trống coi như chưa hợp lệ (NaN) — muốn vô hạn thì nhập 0 cho rõ ý.
  const maxHoursValue = () => {
    const n = normalize(maxDuration.value);
    if (n === null || Number.isNaN(n)) return NaN;
    if (n === 0) return null;
    return toHours(n, maxDuration.unit);
  };

  // Giá trị hiện tại (number|null) của 1 field, xét cả checkbox "không giới hạn".
  const currentValue = (key) => {
    if (key === 'max_parking_hours') return maxHoursValue();
    return normalize(form[key]);
  };

  // Chỉ những field đã đổi so với dữ liệu tải về (để PATCH partial).
  const changedPayload = useMemo(() => {
    if (!initial) return {};
    const payload = {};
    for (const key of EDITABLE_KEYS) {
      if (currentValue(key) !== initial[key]) payload[key] = currentValue(key);
    }
    for (const key of PHOTO_KEYS) {
      if (photoValueChanged(key, photo[key], photoInitial[key])) payload[key] = photo[key];
    }
    return payload;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, form, maxDuration, photo, photoInitial]);

  const hasChanges = Object.keys(changedPayload).length > 0;

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Validate mirror ràng buộc BE — chặn gửi rác, BE vẫn là nguồn chân lý.
  const validate = () => {
    const errs = {};
    for (const key of ['booking_fee', 'monthly_pass_price', 'lost_ticket_fee', 'overstay_fee']) {
      const n = normalize(form[key]);
      if (n === null || Number.isNaN(n) || n < 0) errs[key] = 'Nhập số ≥ 0';
    }
    {
      // Số nguyên theo ĐƠN VỊ đang chọn (90 phút vẫn là số nguyên, gửi đi thành 1.5 giờ).
      // 0 = không giới hạn.
      const n = normalize(maxDuration.value);
      if (n === null || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        errs.max_parking_hours = 'Nhập số nguyên ≥ 0 (0 = không giới hạn)';
      }
    }
    for (const key of ['pass_refund_trial_days', 'pass_refund_bank_info_ttl_days']) {
      const n = normalize(form[key]);
      if (n === null || Number.isNaN(n) || !Number.isInteger(n) || n < 0) errs[key] = 'Nhập số nguyên ≥ 0';
    }
    for (const key of ['pass_refund_trial_percent', 'pass_refund_half_term_percent', 'booking_refund_percent']) {
      const n = normalize(form[key]);
      if (n === null || Number.isNaN(n) || n < 0 || n > 100) errs[key] = 'Nhập số từ 0 đến 100';
    }
    // Mốc cutoff hoàn đặt chỗ: số thực ≥ 0 (0 = hủy lúc nào cũng được hoàn).
    {
      const n = normalize(form.booking_refund_cutoff_hours);
      if (n === null || Number.isNaN(n) || n < 0) errs.booking_refund_cutoff_hours = 'Nhập số ≥ 0';
    }
    // Ảnh hiện trạng: BE từ chối mảng góc rỗng (không còn gì để bắt buộc = tính năng vô nghĩa).
    if (!photo.photo_required_kinds?.length) {
      errs.photo_required_kinds = 'Chọn ít nhất 1 góc ảnh bắt buộc';
    }
    {
      const n = Number(photo.photo_retention_days);
      if (!Number.isInteger(n) || n < 1) errs.photo_retention_days = 'Nhập số nguyên ≥ 1';
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    if (!hasChanges) {
      toast.info('Chưa có thay đổi nào để lưu');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await systemSettingsApi.update(changedPayload);
      const data = res.data.data || {};
      // Đồng bộ lại mốc so sánh + ô nhập từ full cấu hình BE trả về.
      const base = {};
      const formVals = {};
      for (const key of EDITABLE_KEYS) {
        const n = normalize(data[key]);
        base[key] = n;
        formVals[key] = n === null ? '' : String(n);
      }
      setInitial(base);
      setForm(formVals);
      setMaxDuration(hoursToDuration(base.max_parking_hours));
      const p = readPhotoSettings(data);
      setPhoto(p);
      setPhotoInitial(p);
      toast.success(res.data.message || 'Đã lưu cấu hình hệ thống');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Lưu cấu hình thất bại');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-slate-400">Đang tải cấu hình...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cấu hình hệ thống</h1>
        <p className="mt-1 text-sm text-slate-500">
          Giá dịch vụ, chính sách hoàn tiền và ảnh hiện trạng xe. Lưu xong áp dụng ngay.
        </p>
      </div>

      {error && <ErrorAlert message={error} className="mb-4" />}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader
            title="Giá & giới hạn"
            description="Các khoản phụ thu một lần và giới hạn thời gian gửi. Tiền gửi xe tính theo giờ nằm ở trang Quy tắc giá."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {MONEY_GROUP.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={fieldErrors[f.key]}>
                <MoneyInput value={form[f.key] ?? ''} onChange={(v) => setField(f.key, v)} />
              </Field>
            ))}
            <Field
              label="Giờ gửi tối đa trước khi tính quá giờ"
              hint="Nhập số nguyên — 0 là không giới hạn. Chọn đơn vị Phút hoặc Giờ (VD 90 phút = 1,5 giờ)"
              error={fieldErrors.max_parking_hours}
            >
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    value={maxDuration.value}
                    onChange={(e) => setMaxDuration((d) => ({ ...d, value: e.target.value }))}
                  />
                </div>
                <div className="w-28 shrink-0">
                  <select
                    className={inputClass}
                    value={maxDuration.unit}
                    // Đổi đơn vị = đổi cách nhập, GIỮ nguyên khoảng thời gian đang đặt.
                    onChange={(e) =>
                      setMaxDuration((d) => {
                        const unit = e.target.value;
                        const n = normalize(d.value);
                        if (n === null || Number.isNaN(n)) return { value: d.value, unit };
                        return { value: String(fromHours(toHours(n, d.unit), unit)), unit };
                      })
                    }
                  >
                    {DURATION_UNITS.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Chính sách hoàn tiền vé tháng"
            description="Áp dụng khi khách yêu cầu hoàn vé tháng."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {REFUND_GROUP.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={fieldErrors[f.key]}>
                <input
                  type="number"
                  min="0"
                  max={f.kind === 'percent' ? '100' : undefined}
                  step="1"
                  className={inputClass}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Chính sách hoàn tiền đặt chỗ"
            description="Áp dụng khi khách hủy đơn giữ chỗ đã thanh toán."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {BOOKING_REFUND_GROUP.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={fieldErrors[f.key]}>
                <input
                  type="number"
                  min="0"
                  max={f.kind === 'percent' ? '100' : undefined}
                  step={f.kind === 'hours0' ? '0.5' : '1'}
                  className={inputClass}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Ảnh hiện trạng xe & người lái"
            description="Bãi ghi hình hiện trạng lúc vào/ra để đối chiếu khi khách khiếu nại hư hại (mất gương, xước xe). Mặc định BẬT. Chỉ tắt khi camera hỏng — tắt là bãi mất bằng chứng, nhưng còn hơn kẹt không cho xe nào ra vào."
          />

          <div className="space-y-4">
            {/* Hai công tắc chính — tắt cả hai là hệ thống chạy y như trước khi có tính năng này */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'require_entry_photo', label: 'Bắt buộc ảnh lúc VÀO', hint: 'Chưa đủ ảnh thì cổng vào tòa không mở. Bỏ tick = chấp nhận nhận xe mà không có bằng chứng.' },
                { key: 'require_exit_photo', label: 'Bắt buộc ảnh lúc RA', hint: 'Chưa đủ ảnh thì không cho thanh toán / ra cổng. Bỏ tick = không đối chiếu được khi khách khiếu nại.' },
              ].map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={photo[t.key]}
                    onChange={(e) => setPhoto((p) => ({ ...p, [t.key]: e.target.checked }))}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{t.label}</span>
                    <span className="block text-xs text-slate-500">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* Chỉ có ảnh VÀO thì không đối chiếu được gì cả — đó là lý do tính năng này tồn tại. */}
            {photo.require_entry_photo && !photo.require_exit_photo && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                Đang bắt buộc ảnh lúc VÀO nhưng KHÔNG bắt buộc ảnh lúc RA. Không có ảnh lúc ra
                thì không đối chiếu được gì khi khách khiếu nại — bộ ảnh lúc vào gần như vô dụng.
                Nên bật cả hai.
              </p>
            )}

            <Field
              label="Các góc bắt buộc phải chụp"
              hint="Bỏ tick góc nào thì góc đó không còn bắt buộc. VD bãi chỉ có xe máy có thể bỏ 'Đuôi xe'."
              error={fieldErrors.photo_required_kinds}
            >
              <div className="flex flex-wrap gap-2">
                {PHOTO_KIND_OPTIONS.map((k) => {
                  const on = photo.photo_required_kinds.includes(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() =>
                        setPhoto((p) => ({
                          ...p,
                          photo_required_kinds: on
                            ? p.photo_required_kinds.filter((x) => x !== k.id)
                            : [...p.photo_required_kinds, k.id],
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                        on
                          ? 'bg-brand text-white'
                          : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {on ? '✓ ' : ''}{k.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Số ngày lưu ảnh"
              hint="Quá hạn thì tự xóa. Ảnh thuộc khiếu nại chưa xử lý xong vẫn được giữ lại."
              error={fieldErrors.photo_retention_days}
            >
              <input
                type="number"
                min="1"
                step="1"
                className={inputClass}
                value={photo.photo_retention_days}
                onChange={(e) => setPhoto((p) => ({ ...p, photo_retention_days: e.target.value }))}
              />
            </Field>

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Hệ thống tự động từ chối ảnh không phải vừa chụp, ảnh đã dùng cho lượt gửi khác,
              và hai góc chụp trùng một chỗ. Các mức này cố định trong hệ thống, không cần cấu hình.
            </p>

          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {hasChanges && <span className="text-sm text-slate-500">Có thay đổi chưa lưu</span>}
          <Button type="submit" className="brand-gradient border-0" loading={saving} disabled={!hasChanges}>
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </div>
  );
}
