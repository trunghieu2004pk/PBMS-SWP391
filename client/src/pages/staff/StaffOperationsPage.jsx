import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Upload, X, Images, CheckCircle2 } from 'lucide-react';
import { sessionsApi } from '../../api/sessions';
import { staffReservationsApi } from '../../api/staffReservations';
import { floorsApi, vehicleTypesApi, gatesApi } from '../../api/masterData';
import { friendlyReservationError, reservationCheckinBadge } from '../../lib/reservationStatus';
import { friendlyCheckinError, plainApiError } from '../../lib/checkinError';
import { publicApi } from '../../api/public';
import { validateCheckinForm } from '../../lib/validate';
import {
  PLATE_VN_HINT,
  cleanPlateInput,
  normalizePlateOrKeep,
  validateAndNormalizePlateVN,
  categoryOfVehicleType,
} from '../../lib/plate';
import Card from '../../components/ui/Card';
import Modal, { ModalActions } from '../../components/ui/Modal';
import Field, { ErrorAlert } from '../../components/ui/Field';
import { inputClass } from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { toast } from '../../components/ui/toast';
import QrScanner from '../../components/QrScanner';
import PhotoCapture from '../../components/PhotoCapture';
import PhotoCompare from '../../components/PhotoCompare';
import { sessionPhotosApi } from '../../api/sessionPhotos';
import { incidentsApi, fetchIncidentPhotoBlobUrl } from '../../api/incidents';
import { staffPassesApi } from '../../api/staffPasses';
import { kioskApi } from '../../api/kiosk';

/* ============================================================================
   BAN DO FILE — 6 muc, xep DUNG thu tu hien tren sidebar ben trai.
   Muc dang mo doc tu URL (?tab=), sidebar o StaffLayout la noi chuyen muc.

   Moi muc co 3 manh mang CUNG so hieu (hang so / state+logic / giao dien).
   Go Ctrl+F so hieu trong ngoac vuong de ra du ca 3 manh:

     [1] CHECK-IN (XE VAO)    bien so -> loai xe -> tang -> cong vao (IN)
     [2] PHIEN HOAT DONG      + loc bien so, ve lai QR cho khach mat ma
     [3] DAT CHO VAO          + [3M] modal Cho xe vao
     [5] THU TIEN MAT (RA)    (so [4] cu la tab Tra cuu QR, da bo)
     [6] SU CO
     [7] VE THANG
     [0] dung chung cho nhieu muc + [0M] modal ve lai ma QR

   Thu tu trong file:  hang so -> state+logic tung muc -> giao dien tung muc.
   ============================================================================ */

/* ─────────────────────── [0] Helper dung chung ─────────────────────── */

// Lấy floor_id của đơn đặt chỗ — để lọc cổng VÀO (IN) cùng tầng đã đặt.
const reservationFloorId = (r) => r?.floor_id ?? r?.floor?.floor_id ?? r?.slot?.zone?.floor?.floor_id ?? null;

const fmtMoney = (v) => `${Number(v || 0).toLocaleString('vi-VN')} ₫`;

// Khóa so sánh biển số: bỏ hết chấm/gạch/khoảng trắng. Khách mất mã QR thường chỉ đọc dãy số
// ("năm trăm lẻ một") chứ không nhớ đúng cách chấm, nên gõ "50001" phải ra được "51M-500.01".
const plateKey = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Thời gian đã đỗ tính từ time_in -> hiện tại (dạng "2h 15p").
const fmtElapsed = (timeIn) => {
  if (!timeIn) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(timeIn).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}p` : `${mins}p`;
};

// Lố giờ có 3 lý do khác nhau (BE trả overstayReason) — nói đúng để Manager không tưởng
// liên quan "Giờ gửi tối đa": reservation_window = ở quá khung đã đặt (không liên quan giờ gửi
// tối đa); pass_window = vé tháng ra ngoài khung giờ ghi trên vé; walk_in_max_hours = quá giờ
// gửi tối đa của bãi.
// Dùng ở [2] Phiên hoạt động và [4] Thu tiền mặt.
const overstayLabel = (reason) =>
  reason === 'reservation_window'
    ? 'ở quá KHUNG ĐẶT CHỖ đã đăng ký'
    : reason === 'pass_window'
      ? 'đỗ NGOÀI KHUNG GIỜ của vé tháng'
      : reason === 'walk_in_max_hours'
        ? 'quá GIỜ GỬI TỐI ĐA của bãi'
        : reason === 'reported_overstay'
          ? 'bị báo quá giờ gửi xe'
          : 'lố giờ';

// Loai phien -> note nho duoi bien so o bang [2]. Muc dich: nhin bang la biet ngay
// xe nao chiu luat lo gio nao, khoi tuong he thong bo sot.
//   walk_in / auto_registered -> chan bang "Gio gui toi da" (Manager set)
//   reservation               -> chan bang end_time cua don da dat
//   monthly_pass              -> KHONG bi danh lo gio (BE: "Ve thang: khung rieng, monthly lo")
const SESSION_TYPE_NOTE = {
  walk_in: 'Khách vãng lai',
  auto_registered: 'Vãng lai (tự động)',
  reservation: 'Đặt chỗ qua app',
  // KHÔNG ghi "không tính lố giờ": vé tháng vẫn lố được — đỗ sang phần giờ nằm ngoài khung
  // ghi trên vé thì phải trả tiền phần đó kèm phụ thu, và vé hết hạn thì tính như vãng lai.
  monthly_pass: 'Vé tháng',
};

// Khung gio da dat: "07:00–11:00 23/7" (cung ngay) hoac "23/7 22:00 → 24/7 06:00" (qua dem).
// Doc tu s.reservation — BE da include san start_time/end_time trong listActive.
const fmtWindow = (r) => {
  if (!r?.start_time || !r?.end_time) return null;
  const s = new Date(r.start_time);
  const e = new Date(r.end_time);
  const hm = (d) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const dm = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  return s.toDateString() === e.toDateString()
    ? `${hm(s)}–${hm(e)} ${dm(s)}`
    : `${dm(s)} ${hm(s)} → ${dm(e)} ${hm(e)}`;
};

// Note duoi bien so: loai phien, kem KHUNG GIO neu la dat cho (moc tinh lo gio cua don).
const sessionTypeNote = (s) => {
  if (s.session_type === 'reservation') {
    const w = fmtWindow(s.reservation);
    return w ? `Đặt chỗ · ${w}` : SESSION_TYPE_NOTE.reservation;
  }
  return SESSION_TYPE_NOTE[s.session_type] || null;
};

/* ─────────────────── [1] Hang so — Check-in (xe vao) ─────────────────── */

const emptyCheckin = { plateNumber: '', vehicleTypeId: '', floorId: '', gateId: '' };

/* ────────────────────────── [6] Hang so — Su co ────────────────────────── */

// 5 loại sự cố Staff được phép báo (mirror server STAFF_CREATABLE_INCIDENT_TYPES + nhãn VN).
// needLink: BE bắt buộc gắn 1 thực thể (vd phiên xe) cho các loại này.
const STAFF_INCIDENT_TYPES = [
  { value: 'lost_ticket', label: 'Mất thẻ', needLink: true },
  { value: 'wrong_info', label: 'Sai thông tin xe', needLink: true },
  { value: 'overstay', label: 'Quá hạn gửi', needLink: true },
  { value: 'wrong_zone', label: 'Sai khu vực', needLink: true },
  { value: 'vehicle_damage', label: 'Hư hại xe', needLink: true },
  { value: 'other', label: 'Khác', needLink: false },
];
const INCIDENT_STATUS_BADGE = {
  open: 'bg-amber-50 text-amber-700',
  investigating: 'bg-blue-50 text-blue-700',
  resolved: 'bg-emerald-50 text-emerald-700',
};

const getIncidentTypeStyles = (type) => {
  switch (type) {
    case 'lost_ticket':
      return {
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        badge: 'bg-amber-100 text-amber-800',
        iconColor: 'text-amber-500'
      };
    case 'wrong_info':
      return {
        bg: 'bg-rose-50 text-rose-700 border-rose-200',
        badge: 'bg-rose-100 text-rose-800',
        iconColor: 'text-rose-500'
      };
    case 'overstay':
      return {
        bg: 'bg-violet-50 text-violet-700 border-violet-200',
        badge: 'bg-violet-100 text-violet-800',
        iconColor: 'text-violet-500'
      };
    case 'wrong_zone':
      return {
        bg: 'bg-sky-50 text-sky-700 border-sky-200',
        badge: 'bg-sky-100 text-sky-800',
        iconColor: 'text-sky-500'
      };
    case 'vehicle_damage':
      return {
        bg: 'bg-red-50 text-red-700 border-red-200',
        badge: 'bg-red-100 text-red-800',
        iconColor: 'text-red-500'
      };
    default:
      return {
        bg: 'bg-slate-50 text-slate-700 border-slate-200',
        badge: 'bg-slate-100 text-slate-800',
        iconColor: 'text-slate-500'
      };
  }
};

const getStatusStyles = (status) => {
  switch (status) {
    case 'resolved':
      return {
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        ping: false
      };
    case 'investigating':
      return {
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        dot: 'bg-amber-500',
        ping: true,
        pingBg: 'bg-amber-400'
      };
    default: // open
      return {
        badge: 'bg-rose-50 text-rose-700 border-rose-200',
        dot: 'bg-rose-500',
        ping: true,
        pingBg: 'bg-rose-400'
      };
  }
};

/* ───────────────────────── [7] Hang so — Ve thang ───────────────────────── */

const PASS_STATUS_OPTIONS = [
  ['pending', 'Chờ thanh toán'],
  ['active', 'Đang hiệu lực'],
  ['expired', 'Hết hạn'],
  ['cancelled', 'Đã hủy'],
];
const PASS_LABEL = Object.fromEntries(PASS_STATUS_OPTIONS);
const PASS_BADGE = {
  pending: 'bg-amber-50 text-amber-700',
  active: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-slate-100 text-slate-500',
};
const fmtPassDate = (v) => (v ? new Date(v).toLocaleDateString('vi-VN') : '—');
const hhmm = (t) => (t ? String(t).slice(0, 5) : '—');

export default function StaffOperationsPage() {
  /* ==========================================================================
     [0] DUNG CHUNG — tab dang mo, danh muc, tai du lieu luc mo trang
     ========================================================================== */

  // Mục đang mở nằm trên URL (?tab=) chứ không phải state trong component: sidebar bên trái là
  // nơi chuyển mục, và F5 / mở lại link vẫn về đúng chỗ đang xem.
  // 'checkin' | 'active' | 'reservation' | 'booth' | 'incident' | 'passes'
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'checkin';

  // Danh mục cho dropdown: floors dùng ở [1] và [7], vehicleTypes dùng ở [1].
  const [floors, setFloors] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [availability, setAvailability] = useState([]); // số chỗ trống theo tầng/khu — [1] đọc

  // Quét QR bằng camera dùng chung 2 tab: [3] đặt chỗ vào | [5] thu tiền mặt.
  const [scanTarget, setScanTarget] = useState(null);

  // Phiên đang xem mã QR (modal [0M] vẽ lại mã) — mở được từ [1] ô tìm biển số và [2] bảng xe trong bãi.
  const [qrSession, setQrSession] = useState(null);

  // Số chỗ trống theo tầng/khu (GET /public/availability) — cập nhật dropdown + panel.
  // Gọi lại sau mỗi thao tác đổi số chỗ: [1] check-in, [3] cho vào, [5] thu tiền mặt.
  const loadAvailability = async () => {
    try {
      const { data } = await publicApi.availability();
      setAvailability(data.data || []);
    } catch {
      // lỗi tải số chỗ trống không chặn nghiệp vụ check-in
    }
  };

  // Tải danh mục + danh sách xe đang đỗ + đặt chỗ sắp tới + số chỗ trống khi mở trang.
  // Các loadXxx() nằm ở section của tab tương ứng bên dưới — gọi được vì callback của
  // useEffect chỉ chạy SAU khi render xong, lúc đó mọi const đã được gán.
  useEffect(() => {
    (async () => {
      try {
        const [fRes, vRes] = await Promise.all([floorsApi.list(), vehicleTypesApi.list()]);
        setFloors(fRes.data.data);
        setVehicleTypes(vRes.data.data);
      } catch {
        toast.error('Không tải được danh mục tầng/loại xe');
      }
      loadActive();      // [2]
      loadUpcoming();    // [3]
      loadAvailability();// [0]
      loadIncidents();   // [6]
      loadPasses();      // [7]
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ==========================================================================
     [1] TAB CHECK-IN (XE VAO) — state + logic
         Giao dien o duoi: tim "[1] TAB CHECK-IN" phan JSX.
         Thu tu tren man hinh: bien so -> loai xe -> tang -> cong vao (IN)
     ========================================================================== */

  const [form, setForm] = useState(emptyCheckin);
  const [gates, setGates] = useState([]); // cổng IN theo tầng đã chọn
  const [fieldErrors, setFieldErrors] = useState({});
  const [checkinError, setCheckinError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastCheckin, setLastCheckin] = useState(null);

  /* ── [1Q] Quét QR ngay ở quầy check-in ──────────────────────────────────────
     Khách mua đặt chỗ / vé tháng online gần như luôn cầm sẵn QR trên điện thoại. Bắt họ
     đọc biển số cho nhân viên gõ là bước thừa và dễ gõ sai. Quét xong ĐIỀN SẴN ô nhập rồi
     đi tiếp đúng luồng check-in chung — không tách thành luồng riêng. */
  const [ciQr, setCiQr] = useState('');
  const [ciQrInfo, setCiQrInfo] = useState(null); // { kind, label, plateNumber, ... }
  const [ciQrLoading, setCiQrLoading] = useState(false);

  /**
   * Gõ TAY biển số xong → hỏi BE xem xe đó có đặt chỗ / vé tháng không.
   *
   * Quét QR thì form tự điền tầng + loại xe, còn gõ tay thì trước đây form IM LẶNG: nhân viên
   * phải tự nhớ vé tháng của xe đó nằm tầng nào, nhớ sai là check-in fail. Máy đã biết sẵn thì
   * phải nói ra TRƯỚC khi bấm. Không khớp gì (data = null) là khách vãng lai — trường hợp
   * thường gặp nhất, giữ nguyên các ô cho nhân viên tự chọn.
   */
  const identifyPlate = async (rawPlate) => {
    const plate = String(rawPlate || '').trim();
    if (!plate) return;
    try {
      const { data } = await sessionsApi.identifyPlate(plate);
      const info = data.data;
      setCiQrInfo(info || null);
      if (!info) return;
      setForm((f) => ({
        ...f,
        vehicleTypeId: String(info.vehicleTypeId ?? f.vehicleTypeId),
        floorId: String(info.floorId ?? f.floorId),
      }));
      if (info.floorId) await onFloorChange(String(info.floorId));
    } catch {
      // Biển gõ dở / không hợp lệ: im lặng, ô biển số đã có lỗi định dạng riêng rồi.
      setCiQrInfo(null);
    }
  };

  const applyCheckinQr = async (raw) => {
    const token = String(raw || '').trim();
    if (!token) return;
    setCiQrLoading(true);
    setCheckinError('');
    try {
      const { data } = await sessionsApi.resolveCheckinQr(token);
      const info = data.data;
      setCiQrInfo(info);
      // Điền sẵn nhưng KHÔNG tự bấm — nhân viên còn phải đối chiếu với chiếc xe trước mặt.
      setForm((f) => ({
        ...f,
        plateNumber: info.plateNumber,
        vehicleTypeId: String(info.vehicleTypeId ?? f.vehicleTypeId),
        floorId: String(info.floorId ?? f.floorId),
      }));
      // Nạp cổng IN của tầng đã đặt. onFloorChange giữ nguyên các ô khác (spread state cũ).
      if (info.floorId) await onFloorChange(String(info.floorId));
      setCiQr('');
    } catch (err) {
      setCiQrInfo(null);
      setCheckinError(plainApiError(err, 'Không đọc được mã QR này'));
    } finally {
      setCiQrLoading(false);
    }
  };

  /* ── [1P] Ảnh hiện trạng xe + người lái ──────────────────────────────────
     Ảnh chụp SAU khi tạo phiên (cần session_id để đặt tên file). Xe chưa đủ ảnh thì
     cổng VÀO TÒA không mở, nên không có kẽ hở dù check-in đã xong ở booth.
     photoTarget != null ⇒ đang mở modal chụp. photoInfo = trạng thái ảnh của phiên vừa check-in. */
  const [photoTarget, setPhotoTarget] = useState(null);
  const [photoInfo, setPhotoInfo] = useState(null);

  // Nạp trạng thái ảnh của 1 phiên — cũng là nơi lấy danh sách góc bắt buộc, vì Staff
  // không đọc được GET /settings/system (đó là route của Manager).
  const fetchPhotoInfo = async (sessionId) => {
    try {
      const { data } = await sessionPhotosApi.list(sessionId);
      return data.data;
    } catch {
      return null;
    }
  };

  const loadPhotoInfo = async (sessionId) => {
    const info = await fetchPhotoInfo(sessionId);
    setPhotoInfo(info);
    return info;
  };

  /**
   * BƯỚC SAU CHECK-IN — DÙNG CHUNG cho MỌI đường cho xe vào bãi.
   *
   * Máy chủ đã gộp sẵn: POST /sessions/checkin tự nhận diện biển số có đặt chỗ hay vé tháng
   * và định tuyến đúng loại. Nhưng giao diện trước đây có 2 cửa riêng — check-in thường và
   * "Đặt chỗ vào" — mà chỉ cửa thứ nhất mở màn nhập ảnh. Xe vào bằng cửa đặt chỗ tạo phiên
   * KHÔNG CÓ ẢNH NÀO, ra cổng bị chặn mà nhân viên không hiểu vì sao.
   *
   * Gom về một hàm để không còn cửa nào quên bước ảnh.
   */
  const afterCheckinSuccess = async (session) => {
    setLastCheckin(session);
    const info = await loadPhotoInfo(session.session_id);
    toast.success(`Cho xe vào bãi thành công — ${SESSION_TYPE_NOTE[session.session_type] || 'khách vãng lai'}`);

    // Bãi đang bắt buộc ảnh vào → mở luôn màn nhập, nhân viên khỏi phải nhớ bấm.
    if (info?.entryRequired) {
      setPhotoTarget({
        sessionId: session.session_id,
        plateNumber: session.plate_number,
        phase: 'entry',
        requiredKinds: info.entryProgress?.required || ['front', 'left', 'rear', 'right', 'driver'],
      });
    }
    loadActive();
    loadAvailability();
  };

  const openCapture = async (session, phase) => {
    const info = (await loadPhotoInfo(session.session_id)) || {};
    const progress = phase === 'entry' ? info.entryProgress : info.exitProgress;
    setPhotoTarget({
      sessionId: session.session_id,
      plateNumber: session.plate_number,
      phase,
      requiredKinds: progress?.required || ['front', 'left', 'rear', 'right', 'driver'],
    });
  };

  const handleCaptureDone = async () => {
    const finished = photoTarget;
    setPhotoTarget(null);
    if (!finished) return;
    toast.success(`Đã đủ ảnh hiện trạng ${finished.phase === 'entry' ? 'lúc vào' : 'lúc ra'}`);
    if (finished.phase === 'entry') {
      await loadPhotoInfo(finished.sessionId);
    } else {
      // Chụp xong ảnh RA → nạp lại để bảng đối chiếu VÀO/RA hiện đủ 2 cột.
      setBoothPhotos(await fetchPhotoInfo(finished.sessionId));
    }
    loadActive();
  };

  /**
   * Đối chiếu ảnh thấy chênh lệch → lập khiếu nại hư hại NGAY tại quầy, gắn sẵn phiên.
   * Gắn phiên là bắt buộc: Manager mở sự cố ra phải thấy được cả 2 bộ ảnh VÀO/RA làm bằng chứng.
   */
  /**
   * Thấy chênh lệch lúc đối chiếu ảnh → sang thẳng tab Sự cố với form đã điền sẵn.
   *
   * Trước đây dùng window.prompt: hộp thoại trần của trình duyệt, không nhìn được lại bộ ảnh
   * đang mở, gõ được đúng một dòng, không chọn được loại sự cố. Khiếu nại hư hại là thứ đi
   * thẳng lên Admin làm bằng chứng đối chất — đáng để nhân viên ngồi viết cho tử tế.
   */
  const openDamageIncident = (session) => {
    setIncForm({
      type: 'vehicle_damage',
      sessionId: String(session.session_id),
      description: `Đối chiếu ảnh xe ${session.plate_number}: `,
    });
    setIncFieldErrors({});
    setIncError('');
    setTab('incident');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Đã mở phiếu sự cố — mô tả chênh lệch rồi bấm Gửi', { icon: '📝' });
  };

  // Khi đổi tầng: nạp cổng IN của tầng đó, reset cổng đã chọn.
  const onFloorChange = async (floorId) => {
    setForm((f) => ({ ...f, floorId, gateId: '' }));
    if (!floorId) {
      setGates([]);
      return;
    }
    try {
      const gRes = await gatesApi.list(floorId);
      const inGates = (gRes.data.data || []).filter((g) => g.direction === 'in' && g.is_active);
      setGates(inGates);
      // BE tự suy cổng khi tầng chỉ có 1 cổng IN -> tự điền sẵn, staff khỏi chọn.
      if (inGates.length === 1) setForm((f) => ({ ...f, gateId: String(inGates[0].gate_id) }));
    } catch {
      toast.error('Không tải được cổng của tầng');
    }
  };

  const handleCheckin = async (e) => {
    e.preventDefault();
    const errors = validateCheckinForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setCheckinError('');
    setSubmitting(true);
    try {
      const payload = {
        plateNumber: normalizePlateOrKeep(form.plateNumber),
        vehicleTypeId: Number(form.vehicleTypeId),
        floorId: Number(form.floorId),
        ...(form.gateId ? { gateId: Number(form.gateId) } : {}), // BE tự suy nếu bỏ trống
      };
      const { data } = await sessionsApi.checkin(payload);
      await afterCheckinSuccess(data.data);
      setForm((f) => ({ ...emptyCheckin, floorId: f.floorId, gateId: f.gateId })); // giữ tầng/cổng cho lượt sau
      setCiQrInfo(null); // xe sau là khách khác — không để lại nhận diện của khách vừa rồi
    } catch (err) {
      // Nói rõ sai Ở ĐÂU (hết chỗ / ngoài khung giờ / chưa tới giờ đơn) thay vì ném nguyên
      // câu thô của BE.
      setCheckinError(friendlyCheckinError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── [1] Giá trị dẫn xuất — CHẠY NGAY lúc render, nên phải khai báo theo đúng
  //    thứ tự phụ thuộc: floorMetaFor -> freeFor / floorServesType -> visibleFloors.

  // Số chỗ trống cho tầng đang chọn (theo loại xe nếu đã chọn) — dùng cho dropdown + panel.
  const floorMetaFor = (floorId) => availability.find((f) => String(f.floorId) === String(floorId)) || null;
  const freeFor = (floorMeta, vehicleTypeId) => {
    if (!floorMeta) return null;
    if (!vehicleTypeId) return { available: floorMeta.available, total: floorMeta.total };
    const zs = (floorMeta.zones || []).filter((z) => String(z.vehicleTypeId) === String(vehicleTypeId));
    return {
      available: zs.reduce((s, z) => s + (z.available || 0), 0),
      total: zs.reduce((s, z) => s + (z.total || 0), 0),
    };
  };
  // Tầng có phục vụ loại xe đang chọn không (theo availability). Chưa chọn loại xe HOẶC chưa
  // tải được availability -> coi như CÓ, tránh ẩn nhầm sạch tầng khi dữ liệu chưa về.
  const floorServesType = (floorId, vehicleTypeId) => {
    if (!vehicleTypeId) return true;
    const meta = floorMetaFor(floorId);
    if (!meta) return true;
    return (meta.zones || []).some((z) => String(z.vehicleTypeId) === String(vehicleTypeId));
  };
  // Chỉ hiện tầng phục vụ loại xe đang chọn: tầng riêng xe máy không hiện khi chọn ô tô
  // (trước đây vẫn hiện kèm "0 trống" + báo "Tầng đầy 0/0" -> staff tưởng chờ lát có chỗ).
  const visibleFloors = floors.filter((f) => floorServesType(f.floor_id, form.vehicleTypeId));
  const selectedFloorMeta = floorMetaFor(form.floorId);
  const selectedFloorFree = freeFor(selectedFloorMeta, form.vehicleTypeId);
  const selectedVtName = vehicleTypes.find((v) => String(v.vehicle_type_id) === String(form.vehicleTypeId))?.type_name;

  /* ==========================================================================
     [2] TAB PHIEN HOAT DONG — state + logic
         Giao dien o duoi: tim "[2] TAB PHIEN HOAT DONG" phan JSX.
     ========================================================================== */

  const [active, setActive] = useState([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [fees, setFees] = useState({}); // { [sessionId]: feeResult } — cột "Phí tạm tính" của [2]
  const [loadingFees, setLoadingFees] = useState(false);
  const [activeSearch, setActiveSearch] = useState(''); // ô lọc biển số của bảng [2]

  // Phí tạm tính hiện SẴN ở mọi dòng (bỏ nút "Xem phí" phải bấm từng xe — staff luôn phải bấm
  // hết bảng nên nút chỉ là thao tác thừa). BE không có API tính phí hàng loạt, phải gọi
  // preview-fee cho từng phiên → chạy theo lô 5 request để bãi đông không bắn cả trăm request
  // cùng lúc. Điền dần từng lô, bảng không phải chờ tính xong hết mới hiện.
  const loadFees = async (sessions) => {
    setLoadingFees(true);
    const next = {};
    const BATCH = 5;
    // Xe còn ở 'checked_in' chưa qua cổng vào bãi → CHƯA GỬI PHÚT NÀO, không có phí để tính.
    // Trước đây vẫn gọi và bảng hiện "15.000đ" cho xe chưa vào — vừa sai nghiệp vụ vừa tốn
    // một lượt gọi vô ích cho mỗi dòng như vậy.
    const billable = sessions.filter((s) => s.gate_stage !== 'checked_in');
    try {
      for (let i = 0; i < billable.length; i += BATCH) {
        const part = await Promise.all(
          billable.slice(i, i + BATCH).map(async (s) => {
            try {
              const { data } = await sessionsApi.previewFee({ sessionId: s.session_id });
              return [s.session_id, data.data];
            } catch {
              return [s.session_id, null]; // 1 xe tính lỗi không được chặn cả bảng
            }
          }),
        );
        part.forEach(([id, fee]) => { next[id] = fee; });
        setFees({ ...next });
      }
    } finally {
      setLoadingFees(false);
    }
  };

  const loadActive = async () => {
    setLoadingActive(true);
    try {
      const { data } = await sessionsApi.listActive();
      // listActive trả phân trang { items, total, ... }
      const items = data.data?.items || [];
      setActive(items);
      loadFees(items); // không await: bảng hiện ngay, cột phí điền dần
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Không tải được danh sách xe đang đỗ');
    } finally {
      setLoadingActive(false);
    }
  };

  // Lọc bảng ngay tại FE (danh sách phiên đã tải sẵn, không gọi lại API). Dùng nhiều nhất khi
  // khách mất ảnh QR: staff gõ biển số, tìm đúng dòng xe rồi bấm "Hiện QR" vẽ lại mã cho khách.
  const activeSearchKey = plateKey(activeSearch);
  const visibleActive = activeSearchKey
    ? active.filter((s) => plateKey(s.plate_number).includes(activeSearchKey))
    : active;

  /* ── Sửa biển số: modal thay cho window.prompt ──────────────────────────────
     Hộp thoại trần không có gợi ý định dạng, không báo lỗi tại chỗ, và từ khi biển gõ liền
     không dấu có thể đọc thành hai loại xe thì nó càng nguy: nhân viên gõ xong bấm OK là ghi
     đè biển của một lượt gửi đang chạy, sai thì lúc ra không tra được xe.                 */
  const [plateEdit, setPlateEdit] = useState(null); // { session, value, error }
  const [plateSaving, setPlateSaving] = useState(false);

  const openPlateEdit = (session) => {
    setPlateEdit({ session, value: session.plate_number, error: '' });
  };

  // Loại xe của CHÍNH lượt gửi này dùng để gỡ nhập nhằng — không phải đoán, đã ghi lúc vào.
  const plateEditPrefer = () => categoryOfVehicleType(plateEdit?.session?.vehicleType?.type_code);

  const submitPlateEdit = async () => {
    if (!plateEdit || plateSaving) return;
    const prefer = plateEditPrefer();
    const check = validateAndNormalizePlateVN(plateEdit.value, prefer);
    if (!check.valid) {
      setPlateEdit((s) => ({ ...s, error: check.error }));
      return;
    }
    if (check.normalized === plateEdit.session.plate_number) {
      setPlateEdit((s) => ({ ...s, error: 'Biển số không đổi so với hiện tại.' }));
      return;
    }
    setPlateSaving(true);
    try {
      await sessionsApi.correctPlate(plateEdit.session.session_id, check.normalized);
      toast.success(`Đã sửa biển số thành ${check.normalized}`);
      setPlateEdit(null);
      loadActive();
    } catch (err) {
      setPlateEdit((s) => ({ ...s, error: plainApiError(err, 'Sửa biển số thất bại') }));
    } finally {
      setPlateSaving(false);
    }
  };

  /**
   * Gỡ "phiên ma": phiên đã tạo ở booth nhưng xe CHƯA qua cổng vào — thường do chụp ảnh
   * hỏng giữa chừng hoặc khách đổi ý. Không gỡ thì slot bị giữ và biển số bị khóa
   * (check-in lại báo "xe đã có trong bãi"). BE chỉ cho hủy khi xe chưa vào bãi.
   */
  const [cancelTarget, setCancelTarget] = useState(null); // { session, reason, error }
  const [cancelSaving, setCancelSaving] = useState(false);

  const openCancelEntry = (session) => {
    setCancelTarget({ session, reason: 'Khách đổi ý không gửi nữa', error: '' });
  };

  const submitCancelEntry = async () => {
    if (!cancelTarget || cancelSaving) return;
    const { session, reason } = cancelTarget;
    setCancelSaving(true);
    try {
      await sessionsApi.cancelEntry(session.session_id, reason.trim());
      toast.success(
        session.reservation_id
          ? 'Đã hủy phiên — chỗ đỗ đã trả lại, đơn đặt chỗ của khách dùng lại được'
          : 'Đã hủy phiên — chỗ đỗ đã trả lại, biển số dùng lại được',
      );
      setCancelTarget(null);
      loadActive();
      loadAvailability();
      if (lastCheckin?.session_id === session.session_id) {
        setLastCheckin(null);
        setPhotoInfo(null);
      }
    } catch (err) {
      setCancelTarget((s) => ({ ...s, error: plainApiError(err, 'Hủy phiên thất bại') }));
    } finally {
      setCancelSaving(false);
    }
  };

  /* ==========================================================================
     [3] TAB DAT CHO VAO (RESERVATION CHECK-IN) — state + logic
         Giao dien o duoi: tim "[3] TAB DAT CHO VAO" phan JSX.
     ========================================================================== */

  const [resQr, setResQr] = useState(''); // mã QR nhập/quét để tra cứu
  const [resLookupError, setResLookupError] = useState('');
  const [resLooking, setResLooking] = useState(false);
  const [upcoming, setUpcoming] = useState([]); // đơn confirmed chờ vào
  const [loadingUpcoming, setLoadingUpcoming] = useState(true);

  const loadUpcoming = async () => {
    setLoadingUpcoming(true);
    try {
      const { data } = await staffReservationsApi.upcoming();
      setUpcoming(data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Không tải được danh sách đặt chỗ');
    } finally {
      setLoadingUpcoming(false);
    }
  };

  // Tra cứu đơn theo mã QR (từ ô nhập tay HOẶC camera) rồi mở modal cho vào.
  const runReservationLookup = async (raw) => {
    const token = String(raw || '').trim();
    if (!token) return;
    setResLookupError('');
    setResLooking(true);
    try {
      const { data } = await staffReservationsApi.lookup(token);
      setResQr('');
      openReservationCheckin(data.data);
    } catch (err) {
      setResLookupError(friendlyReservationError(err));
    } finally {
      setResLooking(false);
    }
  };

  const handleReservationLookup = (e) => {
    e.preventDefault();
    runReservationLookup(resQr);
  };

  /* ==========================================================================
     [3M] MODAL CHO XE DAT CHO VAO
          Giao dien o duoi: tim "[3M] MODAL CHO XE DAT CHO VAO" phan JSX.
     ========================================================================== */

  const [ciRes, setCiRes] = useState(null); // đơn đang cho vào (null = đóng modal)
  const [ciGates, setCiGates] = useState([]); // cổng IN của tầng đã đặt
  const [ciGateId, setCiGateId] = useState('');
  const [ciError, setCiError] = useState('');
  const [ciSubmitting, setCiSubmitting] = useState(false);

  // Mở modal "Cho xe vào" cho 1 đơn đặt chỗ: nạp cổng VÀO (IN) cùng tầng đã đặt.
  const openReservationCheckin = async (reservation) => {
    setCiRes(reservation);
    setCiGateId('');
    setCiError('');
    setCiGates([]);
    const floorId = reservationFloorId(reservation);
    if (!floorId) return;
    try {
      const gRes = await gatesApi.list(floorId);
      const inGates = (gRes.data.data || []).filter((g) => g.direction === 'in' && g.is_active);
      setCiGates(inGates);
      if (inGates.length === 1) setCiGateId(String(inGates[0].gate_id)); // 1 cổng IN -> tự chọn
    } catch {
      setCiError('Không tải được cổng vào của tầng đã đặt');
    }
  };

  const handleReservationCheckin = async (e) => {
    e.preventDefault();
    setCiError('');
    setCiSubmitting(true);
    try {
      const { data } = await staffReservationsApi.checkin({
        reservationId: ciRes.reservation_id,
        ...(ciGateId ? { gateId: Number(ciGateId) } : {}), // BE tự suy cổng IN nếu bỏ trống
      });
      setCiRes(null);
      loadUpcoming();
      // Đi qua ĐÚNG bước sau-check-in như cửa check-in thường: nạp cấu hình ảnh, mở màn
      // nhập ảnh nếu bãi đang bắt buộc. Trước đây thiếu chỗ này nên xe đặt chỗ vào bãi mà
      // không có ảnh, tới cổng ra mới phát hiện.
      if (data?.data?.session) await afterCheckinSuccess(data.data.session);
      else { loadActive(); loadAvailability(); }
    } catch (err) {
      setCiError(friendlyReservationError(err));
    } finally {
      setCiSubmitting(false);
    }
  };

  /* ==========================================================================
     [5] TAB THU TIEN MAT (XE RA) — state + logic
         Giao dien o duoi: tim "[5] TAB THU TIEN MAT" phan JSX.
     ========================================================================== */

  // Booth thu tiền mặt (xe ra) — tra cứu bằng QR HOẶC biển số (khi khách mất vé). BE tự suy cổng.
  const [boothQr, setBoothQr] = useState('');
  const [boothPlate, setBoothPlate] = useState(''); // tra theo biển số khi khách MẤT VÉ (không có QR)
  const [boothLost, setBoothLost] = useState(false);
  // Giay to nhan vien doi chieu khi khach khong co ma QR — bat buoc, ghi vao phieu su co.
  const [boothLostNote, setBoothLostNote] = useState('');
  const [boothOverstay, setBoothOverstay] = useState(false); // phụ thu lố giờ (staff chủ động tick)
  const [boothLooking, setBoothLooking] = useState(false);
  const [boothError, setBoothError] = useState('');
  const [boothPreview, setBoothPreview] = useState(null); // { session, fee } sau khi tra cứu
  const [boothSubmitting, setBoothSubmitting] = useState(false);
  const [boothResult, setBoothResult] = useState(null); // kết quả sau khi thu tiền mặt
  // Ảnh hiện trạng của phiên đang cho ra — nguồn cho bảng đối chiếu VÀO/RA.
  const [boothPhotos, setBoothPhotos] = useState(null);
  // Kết quả barie mở từ phía kiosk: khi khách trả PayOS ở cổng, staff thấy luôn trên màn hình.
  const [boothPaidByGate, setBoothPaidByGate] = useState(false);

  // Auto-polling: khi đang preview xe ra (boothPreview đang hiển thị), poll exitStatus
  // mỗi 3 giây. Nếu phiên chuyển sang 'completed' (khách đã trả PayOS ở cổng kiosk hoặc
  // staff khác thu tiền mặt), hiển thị thông báo barie mở và reset form tự động.
  useEffect(() => {
    const sessionId = boothPreview?.session?.session_id;
    if (!sessionId) return undefined;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const { data } = await kioskApi.exitStatus(sessionId);
        if (!active) return;
        if (data.data?.paid) {
          clearInterval(timer);
          setBoothPaidByGate(true);
          toast.success('Khách đã thanh toán online tại cổng — barie mở tự động!');
          loadActive();
          loadAvailability();
        }
      } catch {
        // lỗi 1 nhịp poll không sao — nhịp sau thử lại
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [boothPreview?.session?.session_id]);

  // Booth: tra cứu phí xe ra. Hỗ trợ QR (thường) HOẶC biển số (khi khách MẤT VÉ).
  // lookup = { qrToken } | { plateNumber } | { sessionId }. lost = tính phụ thu mất vé.
  const lookupBooth = async (lookup, lost = boothLost, over = boothOverstay) => {
    const key = (lookup.qrToken ?? lookup.plateNumber ?? lookup.sessionId ?? '').toString().trim();
    if (!key) return;
    setBoothError('');
    setBoothResult(null);
    setBoothLooking(true);
    try {
      const { data } = await sessionsApi.previewFee({ ...lookup, lostTicket: lost, overstayCharge: over });
      setBoothPreview(data.data);
      if (data.data?.session) {
        setBoothLost(Boolean(data.data.session.lost_ticket));
        setBoothOverstay(Boolean(data.data.session.overstay_charge));
      }
      // Kéo luôn ảnh hiện trạng để staff đối chiếu VÀO/RA trước khi mở barie.
      setBoothPhotos(await fetchPhotoInfo(data.data.session.session_id));
    } catch (err) {
      setBoothPreview(null);
      setBoothPhotos(null);
      setBoothError(plainApiError(err, 'Không tra cứu được — kiểm tra lại mã QR / biển số'));
    } finally {
      setBoothLooking(false);
    }
  };

  // previewFee (BE) chỉ trả phiên TRẦN, không kèm loại xe / chỗ đỗ / khu — trong khi danh sách
  // "Phiên hoạt động" đã tải sẵn phiên ĐẦY ĐỦ. Ghép lại theo session_id để khối thu tiền mặt
  // hiện đủ thông tin xe (thay cho tab Tra cứu QR đã bỏ) mà không phải gọi thêm API.
  const boothFullSession = (() => {
    const id = boothPreview?.session?.session_id;
    if (!id) return null;
    return active.find((s) => s.session_id === id) || null;
  })();

  /**
   * Xe tra ra còn ở 'checked_in' = mới ghi nhận ở quầy, CHƯA qua cổng vào bãi.
   * Khi đó KHÔNG được hiện bảng thu phí: xe chưa gửi phút nào thì không có gì để thu, mà
   * bày ra số tiền rồi lại báo "không thu được" là tự mâu thuẫn ngay trên màn hình.
   * Việc đúng duy nhất ở tình huống này là hủy phiên.
   */
  const boothNotEntered = boothPreview?.session?.gate_stage === 'checked_in';

  const lookupBoothByQr = (e) => {
    if (e?.preventDefault) e.preventDefault();
    lookupBooth({ qrToken: boothQr.trim() });
  };

  // Mất vé: khách không có QR → tra theo biển số.
  const lookupBoothByPlate = (e) => {
    if (e?.preventDefault) e.preventDefault();
    lookupBooth({ plateNumber: boothPlate.trim().toUpperCase() });
  };

  // Toggle "mất vé": tra lại phí theo CHÍNH phiên đang xem (sessionId) — không phụ thuộc cách tra.
  const toggleBoothLost = async (checked) => {
    setBoothLost(checked);
    const sid = boothPreview?.session?.session_id;
    if (sid) {
      try {
        await sessionsApi.updateCheckoutOptions(sid, { lostTicket: checked });
      } catch (err) {
        toast.error('Không thể lưu trạng thái mất vé');
      }
      lookupBooth({ sessionId: sid }, checked, boothOverstay);
    }
  };

  // Toggle "phụ thu lố giờ": tra lại phí (cộng overstay_fee do Manager set) theo phiên đang xem.
  const toggleBoothOverstay = async (checked) => {
    setBoothOverstay(checked);
    const sid = boothPreview?.session?.session_id;
    if (sid) {
      try {
        await sessionsApi.updateCheckoutOptions(sid, { overstayCharge: checked });
      } catch (err) {
        toast.error('Không thể lưu trạng thái phụ thu lố giờ');
      }
      lookupBooth({ sessionId: sid }, boothLost, checked);
    }
  };

  // Booth: xác nhận đã thu tiền mặt -> BE ghi payment 'cash' + mở barie.
  // Dùng sessionId của phiên đã tra cứu → chạy đúng dù tra bằng QR hay biển số.
  const confirmBoothCash = async () => {
    const sessionId = boothPreview?.session?.session_id;
    if (!sessionId || boothSubmitting) return;
    setBoothError('');
    // Cho xe ra khi khách không có mã = bỏ qua thứ duy nhất chứng minh đúng người gửi xe.
    // Chặn ngay ở đây để nhân viên không bấm nhầm rồi mới bị BE trả lỗi.
    if (boothLost && boothLostNote.trim().length < 8) {
      setBoothError('Xe ra không có mã QR: phải ghi giấy tờ đã đối chiếu (loại giấy tờ, số, tên người nhận xe).');
      return;
    }
    setBoothSubmitting(true);
    try {
      const { data } = await sessionsApi.cashCheckout({
        sessionId,
        lostTicket: boothLost,
        lostTicketNote: boothLost ? boothLostNote.trim() : undefined,
        overstayCharge: boothOverstay,
      });
      setBoothResult(data.data);
      setBoothPreview(null);
      toast.success('Đã thu tiền mặt — barie mở');
      loadActive();
      loadAvailability();
    } catch (err) {
      setBoothError(plainApiError(err, 'Thu tiền mặt thất bại'));
    } finally {
      setBoothSubmitting(false);
    }
  };

  const resetBooth = () => {
    setBoothQr('');
    setBoothPlate('');
    setBoothLost(false);
    setBoothLostNote('');
    setBoothOverstay(false);
    setBoothPreview(null);
    setBoothResult(null);
    setBoothError('');
  };

  /* ==========================================================================
     [6] TAB SU CO — state + logic
         Giao dien o duoi: tim "[6] TAB SU CO" phan JSX.
     ========================================================================== */

  // Sự cố (incident) — Staff báo + xem sự cố của mình.
  const [incidents, setIncidents] = useState([]);
  const [incFilterStatus, setIncFilterStatus] = useState('all');
  const getTodayStr = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const [incFilterDate, setIncFilterDate] = useState(getTodayStr());
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [incForm, setIncForm] = useState({ type: '', description: '', sessionId: '' });
  const [incFieldErrors, setIncFieldErrors] = useState({});
  const [incError, setIncError] = useState('');
  const [incSubmitting, setIncSubmitting] = useState(false);
  const [incFile, setIncFile] = useState(null);
  const [incPreviewUrl, setIncPreviewUrl] = useState('');
  const [previewIncidentPhoto, setPreviewIncidentPhoto] = useState(null);

  const handleIncFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Chỉ chấp nhận ảnh (JPG, PNG, WebP...)');
      e.target.value = '';
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Ảnh không được vượt quá 3MB');
      e.target.value = '';
      return;
    }
    setIncFile(file);
    if (incPreviewUrl) URL.revokeObjectURL(incPreviewUrl);
    setIncPreviewUrl(URL.createObjectURL(file));
  };

  const removeIncFile = () => {
    setIncFile(null);
    if (incPreviewUrl) {
      URL.revokeObjectURL(incPreviewUrl);
      setIncPreviewUrl('');
    }
  };

  const openIncidentPhoto = async (inc) => {
    try {
      const url = await fetchIncidentPhotoBlobUrl(inc.incident_id);
      setPreviewIncidentPhoto({ incident: inc, url });
    } catch (err) {
      toast.error('Không tải được ảnh sự cố');
    }
  };

  useEffect(() => {
    return () => {
      if (incPreviewUrl) URL.revokeObjectURL(incPreviewUrl);
    };
  }, [incPreviewUrl]);

  // Sự cố do chính staff này báo (BE lọc theo reporter khi role = Staff).
  const loadIncidents = async () => {
    setLoadingIncidents(true);
    try {
      const { data } = await incidentsApi.list({ limit: 50 });
      setIncidents(data.data?.items || []);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Không tải được danh sách sự cố');
    } finally {
      setLoadingIncidents(false);
    }
  };

  // Gửi báo sự cố. Loại lost_ticket/wrong_info/overstay/wrong_zone BE bắt buộc gắn 1 phiên.
  const submitIncident = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!incForm.type) errs.type = 'Chọn loại sự cố';
    if (!incForm.description.trim()) errs.description = 'Nhập mô tả';
    const typeMeta = STAFF_INCIDENT_TYPES.find((t) => t.value === incForm.type);
    if (typeMeta?.needLink && !incForm.sessionId) errs.sessionId = 'Loại này cần gắn 1 xe đang đỗ';
    setIncFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setIncError('');
    setIncSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('type', incForm.type);
      formData.append('description', incForm.description.trim());
      if (incForm.sessionId) {
        formData.append('sessionId', String(incForm.sessionId));
      }
      if (incFile) {
        formData.append('photo', incFile);
      }

      await incidentsApi.create(formData);
      toast.success('Đã báo sự cố');
      setIncForm({ type: '', description: '', sessionId: '' });
      removeIncFile();
      setIncFieldErrors({});
      loadIncidents();
    } catch (err) {
      setIncError(err.response?.data?.error?.message || 'Báo sự cố thất bại');
    } finally {
      setIncSubmitting(false);
    }
  };

  /* ==========================================================================
     [7] TAB VE THANG — state + logic
         Giao dien o duoi: tim "[7] TAB VE THANG" phan JSX.
     ========================================================================== */

  // Vé tháng — tab tra cứu (danh sách phân trang + bộ lọc trạng thái/tầng/biển số).
  const [passes, setPasses] = useState({ items: [], total: 0, page: 1, limit: 50, pages: 0 });
  const [passLoading, setPassLoading] = useState(false);
  const [passFilters, setPassFilters] = useState({ status: '', floorId: '', plate: '' });

  // Tra cứu vé tháng (Staff) — lọc trạng thái/tầng/biển số, phân trang.
  const loadPasses = async (f = passFilters, page = 1) => {
    setPassLoading(true);
    try {
      const params = { page };
      if (f.status) params.status = f.status;
      if (f.floorId) params.floorId = f.floorId;
      if (f.plate.trim()) params.plate = f.plate.trim();
      const { data } = await staffPassesApi.list(params);
      setPasses(data.data);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Không tải được danh sách vé tháng');
    } finally {
      setPassLoading(false);
    }
  };

  const handlePassSearch = (e) => {
    e.preventDefault();
    loadPasses(passFilters, 1);
  };

  /* ==========================================================================
     GIAO DIEN — thu tu duoi day khop DUNG thu tu cac muc tren sidebar:
     [1] Check-in -> [2] Phien hoat dong -> [3] Dat cho vao
     -> [5] Thu tien mat -> [6] Su co -> [7] Ve thang -> cac modal.
     ========================================================================== */

  // Tiêu đề trang + dãy tab ngang đã bỏ: sidebar bên trái (StaffLayout) vừa là tên khu vực
  // vừa là nơi chuyển mục, để lại ở đây là lặp hai lần cùng một thông tin.
  return (
    <div>
      {/* ═══════════════════ [1] TAB CHECK-IN (XE VAO) ═══════════════════
          Thu tu tren man hinh: [1.1] bien so -> [1.2] loai xe -> [1.3] tang
          -> [1.4] cong vao (IN) -> [1.5] bang so cho trong -> [1.6] nut gui.
          State + logic: tim "[1] TAB CHECK-IN (XE VAO)" phia tren.        */}
      {tab === 'checkin' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-800">Ghi nhận xe vào</h2>
            <ErrorAlert message={checkinError} className="mb-4" />
            <form onSubmit={handleCheckin} className="space-y-4">
              {/* [1Q] Khách có QR (đặt chỗ / vé tháng) → quét là điền sẵn, khỏi đọc biển số.
                  Khách vãng lai không có QR → gõ biển số ở dưới. Cùng một luồng check-in. */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Khách có <b>đặt chỗ</b> hoặc <b>vé tháng</b> — quét mã QR để điền sẵn:
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className={inputClass}
                    value={ciQr}
                    onChange={(e) => setCiQr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); applyCheckinQr(ciQr); }
                    }}
                    placeholder="Dán / quét mã QR của khách…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    loading={ciQrLoading}
                    disabled={!ciQr.trim()}
                    onClick={() => applyCheckinQr(ciQr)}
                  >
                    Đọc mã
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => setScanTarget('checkin')}
                    title="Quét QR bằng camera"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>

                {ciQrInfo && (
                  <p className="mt-2 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
                    ✓ Nhận diện <b>{ciQrInfo.label}</b> — biển{' '}
                    <span className="font-mono font-semibold">{ciQrInfo.plateNumber}</span>.
                    Đối chiếu với xe trước mặt rồi bấm Check-in.
                  </p>
                )}

                {!ciQrInfo && (
                  <p className="mt-2 text-xs text-slate-500">
                    Khách vãng lai không có mã — gõ thẳng biển số bên dưới. Hệ thống tự nhận diện
                    diện khách theo biển số nên <b>cả ba loại đều đi chung một luồng này</b>.
                  </p>
                )}
              </div>

              {/* [1.1] Biển số xe */}
              <Field label="Biển số xe" required error={fieldErrors.plateNumber} hint={PLATE_VN_HINT}>
                <input
                  className={inputClass}
                  value={form.plateNumber}
                  // Sửa biển số bằng tay = không còn khớp mã QR vừa quét nữa → bỏ khối chỉ-đọc,
                  // trả lại các ô chọn. Giữ lại là hiện thông tin của chiếc xe khác.
                  onChange={(e) => {
                    setForm({ ...form, plateNumber: cleanPlateInput(e.target.value) });
                    if (ciQrInfo) setCiQrInfo(null);
                    // Đang gõ dở thì đừng để câu đỏ cũ nằm đó — chờ rời ô rồi mới chấm lại.
                    setFieldErrors((err) => ({ ...err, plateNumber: undefined }));
                  }}
                  // Rời ô là chuẩn hóa về dạng BE lưu (51F12345 -> 51F-123.45) để staff thấy đúng
                  // biển sẽ được ghi nhận, không phải đoán cách chấm/gạch — rồi TRA LUÔN xem
                  // biển đó có đặt chỗ / vé tháng không.
                  // Rời ô là chốt luôn: chuẩn hoá theo LOẠI XE đã chọn (nhân viên chọn "Ô tô"
                  // thì 51A12345 đọc theo cách ô tô), rồi báo lỗi NGAY nếu vẫn không đọc được.
                  // Để im tới lúc bấm Check-in mới báo là bắt người ta điền xong hết mới biết sai.
                  onBlur={() => {
                    const prefer = categoryOfVehicleType(
                      vehicleTypes.find((v) => String(v.vehicle_type_id) === String(form.vehicleTypeId))?.type_code,
                    );
                    const plate = normalizePlateOrKeep(form.plateNumber, prefer);
                    setForm((f) => ({ ...f, plateNumber: plate }));
                    if (!plate) return;
                    const check = validateAndNormalizePlateVN(plate, prefer);
                    setFieldErrors((e) => ({ ...e, plateNumber: check.valid ? undefined : check.error }));
                    if (check.valid) identifyPlate(plate);
                  }}
                  placeholder="51F-123.45"
                  required
                />
              </Field>
              {/* [1.2b] Khách ĐÃ nhận diện qua QR: loại xe + tầng đã ghi sẵn trong vé / đơn của
                  họ, nhân viên không được đổi (đổi là check-in fail). Thu 3 ô chọn + băng đếm
                  chỗ trống thành một khối chỉ-đọc: bày ô chọn tầng và "còn 2/8 chỗ" ra ở đây
                  làm nhân viên tưởng phải đi giành chỗ mới, trong khi khách đã có suất rồi. */}
              {ciQrInfo && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm">
                  <p className="mb-1.5 text-xs font-medium text-emerald-800">
                    Theo {ciQrInfo.kind === 'pass' ? 'vé tháng' : 'đơn đặt chỗ'} của khách — không cần chọn lại
                  </p>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Loại xe</span>
                    <span>{vehicleTypes.find((v) => String(v.vehicle_type_id) === String(ciQrInfo.vehicleTypeId))?.type_name || '—'}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Tầng</span>
                    <span className="font-medium">
                      {(() => {
                        const f = floors.find((x) => String(x.floor_id) === String(ciQrInfo.floorId));
                        return f ? `${f.floor_code}${f.label ? ` — ${f.label}` : ''}` : '—';
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Chỗ đỗ</span>
                    <span className="text-slate-600">hệ thống cấp khi bấm Check-in</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCiQrInfo(null)}
                    className="mt-1.5 text-xs font-medium text-slate-500 hover:underline"
                  >
                    Bỏ nhận diện — tự chọn tầng và loại xe
                  </button>
                </div>
              )}

              {/* [1.2] Loại xe — đổi loại xe sẽ lọc lại danh sách tầng ở [1.3] */}
              <Field label="Loại xe" required error={fieldErrors.vehicleTypeId} className={ciQrInfo ? 'hidden' : undefined}>
                <select
                  className={inputClass}
                  value={form.vehicleTypeId}
                  onChange={(e) => {
                    const vehicleTypeId = e.target.value;
                    setForm((f) => ({ ...f, vehicleTypeId }));
                    // Tầng đang chọn không phục vụ loại xe mới -> bỏ chọn tầng (kéo theo cổng),
                    // nếu không form sẽ giữ 1 tầng đã bị ẩn khỏi dropdown.
                    if (form.floorId && !floorServesType(form.floorId, vehicleTypeId)) onFloorChange('');
                    // Biển gõ liền không dấu đang mắc nhập nhằng: vừa chọn loại xe là gỡ được
                    // ngay, khỏi bắt nhân viên quay lại sửa ô biển số.
                    if (!form.plateNumber) return;
                    const prefer = categoryOfVehicleType(
                      vehicleTypes.find((v) => String(v.vehicle_type_id) === String(vehicleTypeId))?.type_code,
                    );
                    const plate = normalizePlateOrKeep(form.plateNumber, prefer);
                    const check = validateAndNormalizePlateVN(plate, prefer);
                    setForm((f) => ({ ...f, plateNumber: plate }));
                    setFieldErrors((err) => ({ ...err, plateNumber: check.valid ? undefined : check.error }));
                  }}
                  required
                >
                  <option value="">— Chọn loại xe —</option>
                  {vehicleTypes.map((v) => (
                    <option key={v.vehicle_type_id} value={v.vehicle_type_id}>{v.type_name}</option>
                  ))}
                </select>
              </Field>
              {/* [1.3] Tầng — chỉ hiện tầng phục vụ loại xe đã chọn; tầng kín thì khóa luôn */}
              <Field
                label="Tầng"
                required
                className={ciQrInfo ? 'hidden' : undefined}
                error={fieldErrors.floorId}
                hint={
                  form.vehicleTypeId && visibleFloors.length === 0
                    ? (
                      // To do — khong the check-in loai xe nay. Bo mau xam mac dinh cua Field
                      // (text-slate-400) de staff thay ngay thay vi tuong chi la chu thich.
                      <span className="font-medium text-red-600">
                        Chưa có tầng nào phục vụ loại xe này — báo Manager tạo khu cho loại xe.
                      </span>
                    )
                    : undefined
                }
              >
                <select className={inputClass} value={form.floorId} onChange={(e) => onFloorChange(e.target.value)} required>
                  <option value="">— Chọn tầng —</option>
                  {visibleFloors.map((f) => {
                    const fr = freeFor(floorMetaFor(f.floor_id), form.vehicleTypeId);
                    // Tầng hết chỗ thì khóa luôn: cho chọn rồi mới báo đầy là bắt staff thao tác thừa.
                    const full = fr ? fr.available === 0 : false;
                    return (
                      <option key={f.floor_id} value={f.floor_id} disabled={full}>
                        {f.floor_code} — {f.label}
                        {fr ? (full ? ' — đã kín, không nhận thêm xe' : ` (còn ${fr.available} chỗ)`) : ''}
                      </option>
                    );
                  })}
                </select>
              </Field>
              {/* [1.4] Cổng vào (IN) — nạp theo tầng ở [1.3]; 1 cổng thì tự chọn */}
              <Field
                label="Cổng vào (IN)"
                error={fieldErrors.gateId}
                className={ciQrInfo ? 'hidden' : undefined}
                hint={form.floorId ? 'Cổng do hệ thống tự chọn theo tầng' : 'Chọn tầng trước'}
              >
                {!form.floorId ? (
                  <div className={`${inputClass} text-slate-400`}>— Chọn tầng trước —</div>
                ) : gates.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Tầng chưa có cổng vào — báo Manager tạo cổng chiều IN.</p>
                ) : gates.length === 1 ? (
                  <div className={`${inputClass} flex items-center justify-between bg-slate-50`}>
                    <span className="font-medium text-slate-700">{gates[0].gate_code}</span>
                    <span className="text-xs text-slate-400">tự chọn</span>
                  </div>
                ) : (
                  <select className={inputClass} value={form.gateId} onChange={(e) => setForm({ ...form, gateId: e.target.value })} required>
                    <option value="">— Chọn cổng vào —</option>
                    {gates.map((g) => (
                      <option key={g.gate_id} value={g.gate_id}>{g.gate_code}</option>
                    ))}
                  </select>
                )}
              </Field>
              {/* [1.5] Băng số chỗ trống của tầng đang chọn — CHỈ cho khách vãng lai. Khách vé
                  tháng / đặt chỗ đã có suất riêng, đếm chỗ trống của diện vãng lai ở đây là
                  thông tin của người khác. */}
              {!ciQrInfo && form.floorId && selectedFloorFree && (
                <div className={`rounded-lg px-3 py-2 text-sm ${selectedFloorFree.available === 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                  {selectedFloorFree.available === 0
                    ? `Tầng này đã kín — ${selectedFloorFree.total} chỗ${selectedVtName ? ` dành cho ${selectedVtName}` : ''} đều không nhận thêm được. Chọn tầng khác.`
                    : `Còn ${selectedFloorFree.available}/${selectedFloorFree.total} chỗ${selectedVtName ? ` cho ${selectedVtName}` : ''}`}
                </div>
              )}
              {/* [1.6] Nút gửi -> handleCheckin. Khóa khi tầng chưa có cổng IN hoặc đã kín chỗ */}
              <Button
                type="submit"
                className="brand-gradient w-full border-0 shadow-(--shadow-soft)"
                loading={submitting}
                // Khóa vì "tầng đã kín" CHỈ áp cho khách vãng lai. Vé tháng và đặt chỗ có suất
                // giữ riêng, số chỗ trống của diện vãng lai bằng 0 không có nghĩa là họ hết chỗ —
                // khóa nút ở đây là chặn đúng người đã trả tiền để có chỗ.
                disabled={
                  (!!form.floorId && gates.length === 0)
                  || (!ciQrInfo && selectedFloorFree?.available === 0)
                }
              >
                Check-in xe vào
              </Button>
            </form>
          </Card>

          {/* [1.7] Kết quả check-in gần nhất (cột phải) — QR làm vé cho khách */}
          <div>
            {lastCheckin ? (
              <Card className="border-brand/30 bg-brand-light/40">
                <h2 className="text-lg font-semibold text-slate-800">Check-in thành công ✓</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Biển số</dt><dd className="font-mono font-medium">{lastCheckin.plate_number}</dd></div>
                  {/* Cho nhân viên thấy hệ thống đã tự nhận ra loại nào — bằng chứng là một
                      cửa check-in lo được cả ba, không cần tách tab. */}
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Diện khách</dt>
                    <dd className="font-medium">
                      {SESSION_TYPE_NOTE[lastCheckin.session_type] || 'Khách vãng lai'}
                    </dd>
                  </div>
                  <div className="flex justify-between"><dt className="text-slate-500">Loại xe</dt><dd>{lastCheckin.vehicleType?.type_name || '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Chỗ đỗ</dt><dd className="font-medium text-brand">{lastCheckin.slot?.slot_code || '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Khu / Tầng</dt><dd>{lastCheckin.slot?.zone?.label || '—'}{lastCheckin.slot?.zone?.floor ? ` · ${lastCheckin.slot.zone.floor.floor_code}` : ''}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Giờ vào</dt><dd>{lastCheckin.time_in ? new Date(lastCheckin.time_in).toLocaleString('vi-VN') : '—'}</dd></div>
                </dl>
                {lastCheckin.qr_token && (
                  <div className="mt-3 flex flex-col items-center gap-2 border-t border-slate-200 pt-3">
                    <QRCodeSVG value={lastCheckin.qr_token} size={140} aria-label="Mã QR vé ra cổng" />
                    <span
                      className="max-w-35 cursor-default select-all break-all font-mono text-[10px] text-slate-400"
                      title={lastCheckin.qr_token}
                    >
                      {lastCheckin.qr_token}
                    </span>
                    <p className="text-xs text-slate-500">Khách chụp mã này làm vé — xuất trình khi ra cổng</p>
                  </div>
                )}

                {/* [1P] Ảnh hiện trạng — chỉ hiện khi bãi đang bật yêu cầu ảnh vào */}
                {photoInfo?.entryRequired && photoInfo.sessionId === lastCheckin.session_id && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    {photoInfo.entryProgress?.complete ? (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        <p className="font-medium">
                          ✓ Đủ {photoInfo.entryProgress.total} ảnh hiện trạng — xe được phép qua cổng
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-amber-50 px-3 py-2">
                        <p className="text-sm font-medium text-amber-800">
                          Thiếu ảnh hiện trạng ({photoInfo.entryProgress?.captured || 0}/
                          {photoInfo.entryProgress?.total || 0}) — barie sẽ KHÔNG mở
                        </p>
                        <button
                          type="button"
                          onClick={() => openCapture(lastCheckin, 'entry')}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                        >
                          <Camera className="h-4 w-4" /> Chụp ảnh hiện trạng
                        </button>
                        {/* Lối thoát khi không chụp được (camera hỏng, khách đổi ý): hủy phiên
                            để trả lại chỗ, không thì phiên kẹt và biển số bị khóa. */}
                        <button
                          type="button"
                          onClick={() => openCancelEntry(lastCheckin)}
                          className="mt-2 w-full text-xs font-medium text-red-600 hover:underline"
                        >
                          Không chụp được — hủy phiên này
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="flex h-full items-center justify-center text-center text-sm text-slate-400">
                Kết quả check-in sẽ hiển thị ở đây (chỗ đỗ được gán tự động).
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ [2] TAB PHIEN HOAT DONG ═══════════════════
          Bang xe dang trong bai (xem + bao lo gio + sua bien so).
          Cho xe ra: tab [5] Thu tien mat.
          State + logic: tim "[2] TAB PHIEN HOAT DONG" phia tren.        */}
      {tab === 'active' && (
        <Card padding={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-800">
              Xe đang trong bãi
              {activeSearchKey && (
                <span className="ml-2 text-sm font-normal text-slate-400">
                  {visibleActive.length}/{active.length} xe khớp
                </span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              <input
                className={`${inputClass} w-52`}
                value={activeSearch}
                onChange={(e) => setActiveSearch(cleanPlateInput(e.target.value))}
                placeholder="Lọc biển số: 51F-123.45"
                aria-label="Lọc theo biển số"
              />
              {activeSearch && (
                <Button variant="secondary" size="sm" onClick={() => setActiveSearch('')}>Xóa lọc</Button>
              )}
              <Button variant="secondary" size="sm" onClick={loadActive} loading={loadingActive}>Làm mới</Button>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Biển số</th>
                  <th className="px-4 py-3 font-medium">Loại xe</th>
                  <th className="px-4 py-3 font-medium">Chỗ đỗ</th>
                  <th className="px-4 py-3 font-medium">Giờ vào</th>
                  <th className="px-4 py-3 font-medium">Đã đỗ</th>
                  <th className="px-4 py-3 font-medium">Phí tạm tính</th>
                  <th className="px-4 py-3 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loadingActive ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Đang tải...</td></tr>
                ) : visibleActive.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    {activeSearchKey
                      ? 'Không có xe nào trong bãi khớp biển số này — kiểm tra lại biển hoặc bấm "Làm mới".'
                      : 'Không có xe nào trong bãi'}
                  </td></tr>
                ) : (
                  visibleActive.map((s) => (
                    <tr key={s.session_id} className={`border-t border-slate-100 hover:bg-slate-50/60 ${s.overstay ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 font-mono font-medium text-slate-800">
                        {s.plate_number}
                        {/* Bảng này gộp 2 nhóm rất khác nhau: xe ĐANG gửi trong bãi, và xe MỚI
                            ghi nhận ở quầy nhưng chưa qua cổng. Không gắn nhãn thì nhân viên
                            đọc dòng nào cũng tưởng xe đang nằm trong bãi. */}
                        {s.gate_stage === 'checked_in' && (
                          <span
                            className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                            title="Đã ghi nhận ở quầy nhưng xe chưa qua cổng vào bãi"
                          >
                            Chưa vào bãi
                          </span>
                        )}
                        {s.overstay && (
                          <span
                            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700"
                            title={`Lý do: ${overstayLabel(s.overstayReason)}`}
                          >
                            Quá giờ
                          </span>
                        )}
                        {sessionTypeNote(s) && (
                          <span className="mt-0.5 block font-sans text-xs font-normal text-slate-400">
                            {sessionTypeNote(s)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{s.vehicleType?.type_name || '—'}</td>
                      <td className="px-4 py-3">{s.slot?.slot_code || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{s.time_in ? new Date(s.time_in).toLocaleString('vi-VN') : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {s.gate_stage === 'checked_in' ? (
                          // Chưa qua cổng thì đây là thời gian CHỜ VÀO, không phải thời gian đỗ.
                          <span className="text-slate-400">chờ vào cổng · {fmtElapsed(s.time_in)}</span>
                        ) : (
                          <>
                            {fmtElapsed(s.time_in)}
                            {s.overstay && s.overstayHours > 0 && (
                              <span className="ml-1 text-xs font-medium text-red-600">(+{s.overstayHours}h)</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-brand">
                        {s.gate_stage === 'checked_in' ? (
                          // Xe chưa vào bãi thì chưa phát sinh phí — hiện số tiền ở đây là sai
                          // nghiệp vụ, và dễ khiến nhân viên tưởng thu được.
                          <span className="text-slate-400" title="Xe chưa vào bãi nên chưa có phí">—</span>
                        ) : fees[s.session_id] ? (
                          fmtMoney(fees[s.session_id].fee)
                        ) : (
                          <span className="text-slate-400">{loadingFees ? 'Đang tính…' : '—'}</span>
                        )}
                      </td>
                      <td className="space-x-3 px-4 py-3 text-right whitespace-nowrap">
                        {/* Vẽ lại QR ngay tại bảng: khách mất ảnh QR thì staff mở đúng dòng xe đó cho khách chụp lại. */}
                        <button type="button" onClick={() => setQrSession(s)} className="font-medium text-brand hover:underline">Hiện QR</button>
                        {/* Không còn nút "Báo lố giờ" báo tay: lúc xe ra, nếu có thu phụ thu lố giờ thì BE
                            tự ghi sự cố (reportOverstayCharge) — báo tay chỉ tạo bản ghi trùng. Cột "Đã đỗ"
                            vẫn tô đỏ + (+Nh) để staff thấy xe đang quá giờ. */}
                        <button type="button" onClick={() => openPlateEdit(s)} className="font-medium text-slate-500 hover:underline">Sửa biển số</button>
                        {/* Xe chưa qua cổng vào -> vẫn còn phải nhập đủ ảnh mới mở được barie.
                            Trước đây màn nhập ảnh CHỈ mở được từ panel hiện ngay sau check-in:
                            bấm làm mới / đổi tab / F5 là mất panel, xe kẹt lại không có đường
                            nhập ảnh, mà hủy phiên thì phá luôn đơn đặt chỗ của khách. */}
                        {s.gate_stage === 'checked_in' && (
                          <button
                            type="button"
                            onClick={() => openCapture(s, 'entry')}
                            className="font-medium text-brand hover:underline"
                            title="Mở lại màn nhập ảnh hiện trạng lúc vào cho xe này"
                          >
                            Bổ sung ảnh
                          </button>
                        )}
                        {/* Xe CHƯA qua cổng vào -> cho hủy để trả lại chỗ + mở khóa biển số.
                            Xe đã vào bãi thì không hiện nút này (phải cho ra bằng luồng xe ra). */}
                        {s.gate_stage === 'checked_in' && (
                          <button
                            type="button"
                            onClick={() => openCancelEntry(s)}
                            className="font-medium text-red-600 hover:underline"
                            title="Xe chưa qua cổng vào — hủy phiên và trả lại chỗ đỗ"
                          >
                            Hủy phiên
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════ [3] TAB DAT CHO VAO (RESERVATION CHECK-IN) ═══════════════
          Quet/nhap QR dat cho -> mo modal [3M]. Bang duoi CHI DE THEO DOI, khong co
          nut cho vao: muon cho xe vao BAT BUOC quet QR cua khach, khong bam theo ten
          trong danh sach (tranh cho nham xe / cho vao khi khach chua toi).
          State + logic: tim "[3] TAB DAT CHO VAO" phia tren.                    */}
      {tab === 'reservation' && (
        <div className="space-y-6">
          {/* Tra cứu bằng mã QR */}
          <Card>
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Quét / nhập mã QR đặt chỗ</h2>
            <p className="mb-4 text-sm text-slate-500">Nhập mã QR trên vé của khách để tra cứu và cho xe vào.</p>
            <ErrorAlert message={resLookupError} className="mb-4" />
            <form onSubmit={handleReservationLookup} className="flex flex-col gap-3 sm:flex-row">
              <input
                className={inputClass}
                value={resQr}
                onChange={(e) => setResQr(e.target.value)}
                placeholder="Dán hoặc quét mã QR..."
              />
              <Button type="submit" className="brand-gradient shrink-0 border-0" loading={resLooking}>
                Tra cứu
              </Button>
              <Button type="button" variant="secondary" className="shrink-0" onClick={() => setScanTarget('reservation')}>
                <Camera className="h-4 w-4" /> Quét camera
              </Button>
            </form>
          </Card>

          {/* Đặt chỗ sắp tới (đã thanh toán, chờ vào) */}
          <Card padding={false}>
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-800">Đặt chỗ chờ vào bãi</h2>
              <Button variant="secondary" size="sm" onClick={loadUpcoming} loading={loadingUpcoming}>Làm mới</Button>
            </div>
            <div className="overflow-x-auto border-t border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Biển số</th>
                    <th className="px-4 py-3 font-medium">Loại xe</th>
                    <th className="px-4 py-3 font-medium">Tầng · Chỗ</th>
                    <th className="px-4 py-3 font-medium">Khung giờ</th>
                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingUpcoming ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Đang tải...</td></tr>
                  ) : upcoming.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Chưa có đặt chỗ nào chờ vào</td></tr>
                  ) : (
                    upcoming.map((r) => {
                      const badge = reservationCheckinBadge(r);
                      return (
                        <tr key={r.reservation_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-mono font-medium text-slate-800">{r.plate_number}</td>
                          <td className="px-4 py-3">{r.vehicleType?.type_name || '—'}</td>
                          <td className="px-4 py-3">{r.floor?.floor_code || '—'}{r.slot?.slot_code ? ` · ${r.slot.slot_code}` : ''}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {r.start_time ? new Date(r.start_time).toLocaleString('vi-VN') : '—'}
                            {r.end_time ? ` → ${new Date(r.end_time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ''}
                          </td>
                          <td className="px-4 py-3">
                            {badge ? <span className={badge.className}>{badge.label}</span> : <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════ [5] TAB THU TIEN MAT (XE RA) ═══════════════
          Chot BLD-OUT: tra cuu bang QR hoac bien so; cong do BE tu suy.
          State + logic: tim "[5] TAB THU TIEN MAT" phia tren.          */}
      {tab === 'booth' && (
        <div className="max-w-xl">
          <Card>
            <h2 className="text-lg font-semibold text-slate-800">Thu tiền mặt xe ra</h2>
            <p className="mt-1 mb-4 text-sm text-slate-500">
              Khách đưa mã QR tại chốt ra → tra cứu phí → thu tiền mặt mở barie. (Khách trả online thì tự quét ở kiosk cổng ra.)
            </p>
            <ErrorAlert message={boothError} className="mb-4" />

            {boothPaidByGate ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-4">
                  <p className="flex items-center gap-2 font-semibold text-emerald-800">
                    <span className="text-xl">🚧</span> Barie đã mở!
                  </p>
                  <p className="mt-1 text-sm text-emerald-700">
                    Khách đã thanh toán online tại cổng kiosk — hệ thống tự động mở barie cho xe ra.
                  </p>
                </div>
                <Button className="brand-gradient w-full border-0" onClick={() => { setBoothPaidByGate(false); resetBooth(); }}>Tiếp tục thu xe khác</Button>
              </div>
            ) : boothResult ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  ✓ Đã thu tiền mặt {fmtMoney(boothResult.fee)} — barie mở.
                </div>
                <Button className="brand-gradient w-full border-0" onClick={resetBooth}>Thu xe khác</Button>
              </div>
            ) : (
              <>
                <form onSubmit={lookupBoothByQr} className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className={inputClass}
                    value={boothQr}
                    onChange={(e) => setBoothQr(e.target.value)}
                    placeholder="Dán / quét mã QR của khách..."
                  />
                  <Button type="submit" variant="secondary" className="shrink-0" loading={boothLooking}>Tra cứu</Button>
                  <Button type="button" variant="secondary" className="shrink-0" onClick={() => setScanTarget('booth')}>
                    <Camera className="h-4 w-4" /> Quét camera
                  </Button>
                </form>

                {/* Mất vé: khách không có QR → tra theo BIỂN SỐ */}
                <div className="my-3 flex items-center gap-3 text-xs text-slate-400">
                  <span className="h-px flex-1 bg-slate-200" /> hoặc khách MẤT VÉ <span className="h-px flex-1 bg-slate-200" />
                </div>
                <form onSubmit={lookupBoothByPlate} className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className={inputClass}
                    value={boothPlate}
                    onChange={(e) => setBoothPlate(e.target.value.toUpperCase())}
                    placeholder="Tra theo biển số xe (vd 51F-12345)..."
                  />
                  <Button type="submit" variant="secondary" className="shrink-0" loading={boothLooking}>Tra biển số</Button>
                </form>

                {boothPreview && (
                  <div className="mt-4 space-y-4">
                    {/* Chỉ thị auto-polling: hệ thống đang giám sát nếu khách tự quét ở kiosk */}
                    <div className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-600">
                      <span className="inline-block h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                      Đang giám sát: nếu khách tự quét QR trả online ở cổng, barie sẽ mở và màn hình tự cập nhật.
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Biển số</span>
                        <span className="font-mono font-medium">{boothPreview.session?.plate_number || '—'}</span>
                      </div>
                      {/* Thông tin xe gộp từ tab "Tra cứu xe (QR)" cũ — chỉ hiện khi ghép được phiên đầy đủ */}
                      {boothFullSession && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Loại xe</span>
                            <span>{boothFullSession.vehicleType?.type_name || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Chỗ đỗ</span>
                            <span className="font-medium text-brand">{boothFullSession.slot?.slot_code || '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Khu / Tầng</span>
                            <span>
                              {boothFullSession.slot?.zone?.label || '—'}
                              {boothFullSession.slot?.zone?.floor ? ` · ${boothFullSession.slot.zone.floor.floor_code}` : ''}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Diện</span>
                            <span>{SESSION_TYPE_NOTE[boothFullSession.session_type] || boothFullSession.session_type || '—'}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">{boothNotEntered ? 'Giờ ghi nhận' : 'Giờ vào'}</span>
                        <span>{boothPreview.session?.time_in ? new Date(boothPreview.session.time_in).toLocaleString('vi-VN') : '—'}</span>
                      </div>
                      {/* Xe chưa qua cổng thì KHÔNG hiện "Đã đỗ" và "Phí phải thu":
                          chưa gửi phút nào nên hai dòng này đều vô nghĩa. */}
                      {!boothNotEntered && (
                        <>
                          <div className="flex justify-between"><span className="text-slate-500">Đã đỗ</span><span>{fmtElapsed(boothPreview.session?.time_in)}</span></div>
                          {/* Khách đặt chỗ / vé tháng đã trả trước một khoản — nói rõ khoản đó là
                              gì, không thì cả khách lẫn nhân viên mới đều tưởng đang bị thu 2 lần. */}
                          {boothPreview.prepaid && (() => {
                            // 'missing' = đơn đặt chỗ không có khoản giữ chỗ nào đã trả. Tô xanh
                            // như hai trường hợp kia thì đọc thành "đã trả rồi" — phải khác màu.
                            const miss = boothPreview.prepaid.state === 'missing';
                            const box = miss ? 'bg-amber-50' : 'bg-emerald-50';
                            const head = miss ? 'text-amber-800' : 'text-emerald-800';
                            const val = miss ? 'text-amber-900' : 'text-emerald-900';
                            const sub = miss ? 'text-amber-700' : 'text-emerald-700';
                            return (
                              <div className={`mt-1 rounded-md px-2 py-1.5 ${box}`}>
                                <div className="flex justify-between">
                                  <span className={head}>{boothPreview.prepaid.label}</span>
                                  <span className={`font-medium ${val}`}>
                                    {boothPreview.prepaid.amount != null
                                      ? fmtMoney(boothPreview.prepaid.amount)
                                      : (miss ? 'chưa có' : '✓')}
                                  </span>
                                </div>
                                <p className={`mt-0.5 text-xs ${sub}`}>{boothPreview.prepaid.note}</p>
                              </div>
                            );
                          })()}
                          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                            <span className="text-slate-500">Phí phải thu</span>
                            <span className="text-lg font-bold text-brand">{fmtMoney(boothPreview.fee)}</span>
                          </div>
                        </>
                      )}
                      {boothNotEntered && (
                        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                          <span className="text-slate-500">Trạng thái</span>
                          <span className="font-medium text-amber-700">Chưa vào bãi</span>
                        </div>
                      )}
                    </div>

                    {/* ── XE CHƯA VÀO BÃI: không có gì để thu, chỉ còn một việc đúng là hủy phiên.
                        Ẩn hẳn phần phụ thu + nút thu tiền thay vì hiện ra rồi khóa lại. ── */}
                    {boothNotEntered ? (
                      <>
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
                          <p className="text-sm font-semibold text-amber-900">
                            Xe này chưa qua cổng vào bãi
                          </p>
                          <p className="mt-1 text-xs text-amber-800">
                            Phiên mới được ghi nhận ở quầy, xe chưa thực sự vào nên chưa phát sinh
                            phí. Nếu khách đổi ý không gửi nữa thì hủy phiên để trả lại chỗ đỗ;
                            nếu khách vẫn gửi thì mời cho xe qua cổng vào trước.
                          </p>
                          <button
                            type="button"
                            onClick={() => openCancelEntry(boothPreview.session)}
                            className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                          >
                            Hủy phiên này — trả lại chỗ đỗ
                          </button>
                        </div>
                        <Button type="button" variant="secondary" className="w-full" onClick={resetBooth}>
                          Đóng
                        </Button>
                      </>
                    ) : (
                      <>
                        {boothPreview.overstay && (
                          <p className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                            ⚠ Xe {boothPreview.session?.plate_number} {overstayLabel(boothPreview.overstayReason)}{boothPreview.overstayHours > 0 ? ` (~${boothPreview.overstayHours}h)` : ''} — BẮT BUỘC thu phụ thu {fmtMoney(boothPreview.overstayFee)} (đã tính vào phí).
                          </p>
                        )}
                        {/* "Vé" ở đây là mã QR trên điện thoại khách, không phải cuống vé giấy: mất
                        thì bấm "Hiện QR" vẽ lại, mà không có mã vẫn ra được bằng biển số. Nên ô
                        này KHÔNG còn là ô thu tiền — nó ghi nhận việc nhân viên đã đối chiếu
                        giấy tờ trước khi thả xe cho người không cầm mã (chống trộm xe), và lập
                        phiếu sự cố làm dấu vết. Có thu tiền hay không do Manager đặt. */}
                        <label className="flex items-start gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={boothLost}
                            onChange={(e) => toggleBoothLost(e.target.checked)}
                          />
                          <span>
                            Khách không xuất trình được mã — đã kiểm giấy tờ xe
                            <span className="block text-xs text-slate-500">
                              {boothPreview.lostTicketFee > 0
                                ? `Ghi phiếu sự cố + thu thêm ${fmtMoney(boothPreview.lostTicketFee)}`
                                : 'Ghi phiếu sự cố để truy vết — không thu thêm tiền'}
                            </span>
                          </span>
                        </label>
                        {/* Mã QR là thứ DUY NHẤT chứng minh người đang lấy xe đúng là người đã gửi.
                        Bỏ qua nó thì phải thay bằng bằng chứng khác — không thì "báo mất thẻ"
                        thành lối đi thẳng cho kẻ trộm. Ghi nguyên văn vào phiếu sự cố. */}
                        {boothLost && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                            <p className="text-xs font-semibold text-amber-900">
                              Bắt buộc: ghi giấy tờ đã đối chiếu trước khi thả xe
                            </p>
                            <input
                              className={`${inputClass} mt-2`}
                              value={boothLostNote}
                              onChange={(e) => setBoothLostNote(e.target.value)}
                              placeholder="VD: CCCD 001203004567 — Nguyễn Văn A, khớp tên trên cà vẹt"
                            />
                            <p className="mt-1.5 text-xs text-amber-800">
                              Nội dung này vào thẳng phiếu sự cố gửi Quản lý. Nếu sau có tranh chấp
                              mất xe, đây là bằng chứng bãi đã giao xe cho ai. Ảnh người lái lúc ra
                              (bắt buộc) là lớp đối chiếu thứ hai.
                            </p>
                          </div>
                        )}
                        {boothPreview.overstayEnforced ? (
                          <p className="text-sm font-medium text-red-700">
                            ↳ Đã tự cộng phụ thu lố giờ{boothPreview.overstayFee > 0 ? ` (+${fmtMoney(boothPreview.overstayFee)})` : ''} — bắt buộc, không bỏ được.
                          </p>
                        ) : (
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={boothOverstay}
                              onChange={(e) => toggleBoothOverstay(e.target.checked)}
                            />
                            Phụ thu lố giờ{boothPreview.overstayFee > 0 ? ` (+${fmtMoney(boothPreview.overstayFee)})` : ''}
                          </label>
                        )}

                        {/* [5P] Ảnh hiện trạng lúc RA + đối chiếu với lúc VÀO */}
                        {boothPhotos?.exitRequired && (
                          <div className="space-y-3">
                            {!boothPhotos.exitProgress?.complete && (
                              <div className="rounded-lg bg-amber-50 px-3 py-2">
                                <p className="text-sm font-medium text-amber-800">
                                  Chưa chụp đủ ảnh lúc ra ({boothPhotos.exitProgress?.captured || 0}/
                                  {boothPhotos.exitProgress?.total || 0}) — barie sẽ KHÔNG mở
                                </p>
                                <button
                                  type="button"
                                  onClick={() => openCapture(boothPreview.session, 'exit')}
                                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                                >
                                  <Camera className="h-4 w-4" /> Chụp ảnh hiện trạng lúc ra
                                </button>
                              </div>
                            )}
                            <PhotoCompare
                              sessionId={boothPreview.session.session_id}
                              data={boothPhotos}
                              onOpenIncident={() => openDamageIncident(boothPreview.session)}
                            />
                          </div>
                        )}

                        <div className="flex gap-3">
                          <Button className="brand-gradient flex-1 border-0" loading={boothSubmitting} onClick={confirmBoothCash}>
                            Đã thu tiền mặt → mở barie
                          </Button>
                          {/* Hủy: xóa sạch ô nhập + kết quả tra cứu, khỏi phải F5 khi tra nhầm xe */}
                          <Button type="button" variant="secondary" onClick={resetBooth} disabled={boothSubmitting}>
                            Hủy
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* ═══════════════════════ [6] TAB SU CO ═══════════════════════
          Staff bao su co + xem su co cua minh. Nut "Bao lo gio" o [2] nhay vao day.
          State + logic: tim "[6] TAB SU CO" phia tren.                          */}
      {tab === 'incident' && (
        <div className="grid gap-6 lg:grid-cols-2 animate-fadeIn">
          {/* Báo sự cố mới */}
          <Card className="border-t-4 border-t-brand/80 shadow-md">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-800">Báo cáo sự cố</h2>
              <p className="text-xs text-slate-500 mt-1">Ghi nhận sự cố tại bãi đỗ để gửi yêu cầu hỗ trợ tới Admin.</p>
            </div>

            <ErrorAlert message={incError} className="mb-4" />

            <form onSubmit={submitIncident} className="space-y-4">
              <Field label="Loại sự cố" required error={incFieldErrors.type}>
                <select className={`${inputClass} transition-all duration-200 focus:ring-brand/40`} value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })} required>
                  <option value="">— Chọn loại sự cố —</option>
                  {STAFF_INCIDENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="Xe liên quan"
                error={incFieldErrors.sessionId}
                hint="Bắt buộc với mất thẻ / sai thông tin / quá hạn / sai khu"
              >
                <select className={`${inputClass} transition-all duration-200 focus:ring-brand/40`} value={incForm.sessionId} onChange={(e) => setIncForm({ ...incForm, sessionId: e.target.value })}>
                  <option value="">— Không gắn xe —</option>
                  {active.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.plate_number}{s.slot?.slot_code ? ` · ${s.slot.slot_code}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Ảnh minh họa" hint="Đính kèm bằng chứng hình ảnh (không bắt buộc, ≤3MB)">
                {incFile ? (
                  <div className="relative mt-1 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/30 p-3 transition-all duration-200">
                    <div className="flex items-center gap-3 overflow-hidden">
                      {incPreviewUrl && (
                        <img
                          src={incPreviewUrl}
                          alt="Xem trước sự cố"
                          className="h-12 w-16 rounded-lg object-cover border border-emerald-100 shadow-sm"
                        />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm text-slate-700 font-semibold">
                          {incFile.name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {(incFile.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeIncFile}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      title="Xóa ảnh"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 py-6 text-sm text-slate-400 transition hover:border-brand hover:text-brand bg-slate-50/40 hover:bg-slate-50/80">
                    <Upload className="h-5 w-5 text-slate-400 group-hover:text-brand transition-colors" />
                    <span className="font-medium text-slate-500">Nhấp để chọn ảnh minh họa</span>
                    <span className="text-[10px] text-slate-400">Chấp nhận JPG, PNG, WebP (tối đa 3MB)</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleIncFileChange}
                    />
                  </label>
                )}
              </Field>

              <Field label="Mô tả chi tiết" required error={incFieldErrors.description}>
                <textarea
                  className={`${inputClass} min-h-28 transition-all duration-200 focus:ring-brand/40 resize-y`}
                  value={incForm.description}
                  onChange={(e) => setIncForm({ ...incForm, description: e.target.value })}
                  placeholder="Mô tả cụ thể diễn biến sự cố..."
                  required
                />
              </Field>

              <Button type="submit" className="brand-gradient w-full py-2.5 font-bold border-0 rounded-xl hover:opacity-90 active:scale-98 transition-all shadow-md shadow-brand/10" loading={incSubmitting}>
                Gửi báo cáo sự cố
              </Button>
            </form>
          </Card>

          {/* Sự cố tôi đã báo */}
          <Card className="shadow-md">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Sự cố tôi đã báo</h2>
                <p className="text-xs text-slate-500 mt-1">Theo dõi trạng thái các báo cáo sự cố tại bãi đỗ.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={loadIncidents} loading={loadingIncidents} className="shadow-sm">
                Làm mới
              </Button>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 my-4">
              {/* Filter pills */}
              <div className="flex gap-1 p-1 bg-slate-100/80 rounded-xl text-xs font-semibold w-full sm:w-auto max-w-sm border border-slate-200/40">
                <button
                  type="button"
                  onClick={() => setIncFilterStatus('all')}
                  className={`flex-1 text-center py-1.5 px-2.5 rounded-lg transition-all duration-200 ${incFilterStatus === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Tất cả ({incidents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setIncFilterStatus('open')}
                  className={`flex-1 text-center py-1.5 px-2.5 rounded-lg transition-all duration-200 ${incFilterStatus === 'open' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Chưa xử lý ({incidents.filter(i => i.status !== 'resolved').length})
                </button>
                <button
                  type="button"
                  onClick={() => setIncFilterStatus('resolved')}
                  className={`flex-1 text-center py-1.5 px-2.5 rounded-lg transition-all duration-200 ${incFilterStatus === 'resolved' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Đã giải quyết ({incidents.filter(i => i.status === 'resolved').length})
                </button>
              </div>

              {/* Date Filter input */}
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={incFilterDate}
                  onChange={(e) => setIncFilterDate(e.target.value)}
                  className={`${inputClass} !py-1 !px-2.5 !text-xs !h-8 w-36 cursor-pointer border border-slate-200 focus:border-brand focus:ring-1 focus:ring-brand/30 rounded-xl`}
                  title="Lọc theo ngày báo cáo"
                />
                {incFilterDate && (
                  <button
                    type="button"
                    onClick={() => setIncFilterDate('')}
                    className="text-xs text-rose-500 hover:text-rose-700 font-semibold transition-colors px-1"
                    title="Xóa bộ lọc ngày"
                  >
                    Xóa lọc
                  </button>
                )}
              </div>
            </div>

            {/* Incident Cards list */}
            <div className="space-y-4 max-h-[560px] overflow-y-auto pr-1 select-none scrollbar-thin">
              {loadingIncidents ? (
                <div className="py-20 text-center text-sm text-slate-400">Đang tải danh sách sự cố...</div>
              ) : incidents.filter(inc => {
                const matchesStatus = incFilterStatus === 'all' || (incFilterStatus === 'open' && inc.status !== 'resolved') || (incFilterStatus === 'resolved' && inc.status === 'resolved');
                const matchesDate = !incFilterDate || (inc.created_at && new Date(inc.created_at).toISOString().split('T')[0] === incFilterDate);
                return matchesStatus && matchesDate;
              }).length === 0 ? (
                <div className="py-20 text-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                  <span className="text-slate-400 text-sm">Chưa có sự cố nào trong danh mục này</span>
                </div>
              ) : (
                incidents
                  .filter(inc => {
                    const matchesStatus = incFilterStatus === 'all' || (incFilterStatus === 'open' && inc.status !== 'resolved') || (incFilterStatus === 'resolved' && inc.status === 'resolved');
                    const matchesDate = !incFilterDate || (inc.created_at && new Date(inc.created_at).toISOString().split('T')[0] === incFilterDate);
                    return matchesStatus && matchesDate;
                  })
                  .map((inc) => {
                    const typeStyle = getIncidentTypeStyles(inc.type);
                    const statusStyle = getStatusStyles(inc.status);
                    return (
                      <div key={inc.incident_id} className="group relative rounded-2xl border border-slate-100 bg-white p-4.5 shadow-sm transition-all hover:shadow-md hover:border-slate-200/80 flex flex-col gap-3">
                        {/* Header */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold border ${typeStyle.bg}`}>
                              {inc.typeLabel}
                            </span>
                            {inc.session?.plate_number && (
                              <span className="inline-flex items-center justify-center px-2 py-0.5 font-mono text-[11px] font-bold border border-slate-300 rounded bg-white text-slate-800 shadow-sm tracking-wider" title="Biển số xe liên quan">
                                {inc.session.plate_number}
                              </span>
                            )}
                            {inc.slot?.slot_code && (
                              <span className="inline-flex items-center justify-center px-2 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-500 border border-slate-200">
                                {inc.slot.slot_code}
                              </span>
                            )}
                          </div>

                          {/* Status Badge */}
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border ${statusStyle.badge}`}>
                            <span className="relative flex h-1.5 w-1.5">
                              {statusStyle.ping && (
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusStyle.pingBg}`}></span>
                              )}
                              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusStyle.dot}`}></span>
                            </span>
                            {inc.statusLabel}
                          </span>
                        </div>

                        {/* Description & Photo */}
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm text-slate-600 leading-relaxed font-normal flex-1">
                            {inc.description}
                          </p>

                          {inc.image_path && (
                            <button
                              type="button"
                              onClick={() => openIncidentPhoto(inc)}
                              className="mt-1 flex items-center gap-1 self-start rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100/60 hover:text-amber-800 transition-all shadow-sm shrink-0"
                            >
                              <Images className="h-3.5 w-3.5" />
                              <span>Ảnh đính kèm</span>
                            </button>
                          )}
                        </div>

                        {/* Date & Resolution */}
                        <div className="text-[11px] text-slate-400 border-t border-slate-50 pt-2 flex items-center justify-between">
                          <span>Phiếu #{inc.incident_id}</span>
                          <span>{inc.created_at ? new Date(inc.created_at).toLocaleString('vi-VN') : '—'}</span>
                        </div>

                        {/* Resolution notes */}
                        {inc.status === 'resolved' && inc.resolution && (
                          <div className="rounded-xl bg-slate-50 border border-slate-100/80 p-3 text-xs text-slate-600 mt-1">
                            <div className="font-semibold text-slate-800 flex items-center gap-1 mb-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              <span>Kết luận xử lý từ Admin:</span>
                            </div>
                            <p className="italic leading-relaxed">{inc.resolution}</p>
                            {inc.resolved_at && (
                              <span className="block mt-1 text-[10px] text-slate-400 text-right">
                                Duyệt lúc: {new Date(inc.resolved_at).toLocaleString('vi-VN')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════════════ [7] TAB VE THANG ═══════════════════════
          Staff tra cuu ve thang theo trang thai / tang / bien so.
          State + logic: tim "[7] TAB VE THANG" phia tren.                */}
      {tab === 'passes' && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Tra cứu vé tháng</h2>
            <p className="mb-4 text-sm text-slate-500">Xem vé tháng của khách theo trạng thái, tầng hoặc biển số.</p>
            <form onSubmit={handlePassSearch} className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-600">Trạng thái</span>
                <select className={inputClass} value={passFilters.status} onChange={(e) => setPassFilters({ ...passFilters, status: e.target.value })}>
                  <option value="">— Tất cả —</option>
                  {PASS_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-600">Tầng</span>
                <select className={inputClass} value={passFilters.floorId} onChange={(e) => setPassFilters({ ...passFilters, floorId: e.target.value })}>
                  <option value="">— Tất cả —</option>
                  {floors.map((f) => <option key={f.floor_id} value={f.floor_id}>{f.floor_code} — {f.label}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-600">Biển số</span>
                <input className={inputClass} value={passFilters.plate} onChange={(e) => setPassFilters({ ...passFilters, plate: e.target.value.toUpperCase() })} placeholder="51A-12345" />
              </label>
              <Button type="submit" className="brand-gradient border-0" loading={passLoading}>Lọc</Button>
            </form>
          </Card>

          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Biển số</th>
                    <th className="px-4 py-3 font-medium">Loại xe</th>
                    <th className="px-4 py-3 font-medium">Tầng</th>
                    <th className="px-4 py-3 font-medium">Hiệu lực</th>
                    <th className="px-4 py-3 font-medium">Khung giờ</th>
                    <th className="px-4 py-3 font-medium">Chủ vé</th>
                    {/* Hai cột TÁCH BIỆT vì rất dễ nhầm: "Vé" là vé còn hạn dùng hay không (vé
                        tháng xanh suốt 30 ngày, ra vào bao nhiêu lượt cũng không đổi); "Xe" là
                        xe có đang nằm trong bãi lúc này hay không. Gộp một cột "Trạng thái" thì
                        nhân viên nhìn thấy xanh lại tưởng xe đang gửi, đem ra chốt thu tiền
                        không được rồi tưởng hệ thống hỏng. */}
                    <th className="px-4 py-3 font-medium">Vé</th>
                    <th className="px-4 py-3 font-medium">Xe lúc này</th>
                  </tr>
                </thead>
                <tbody>
                  {passLoading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Đang tải...</td></tr>
                  ) : passes.items.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Không có vé tháng nào khớp</td></tr>
                  ) : (
                    passes.items.map((p) => {
                      const parked = active.find((s) => s.plate_number === p.plate_number);
                      return (
                        <tr key={p.pass_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-mono font-medium text-slate-800">{p.plate_number}</td>
                          <td className="px-4 py-3">{p.vehicleType?.type_name || '—'}</td>
                          <td className="px-4 py-3">{p.floor?.floor_code || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{fmtPassDate(p.start_date)} → {fmtPassDate(p.end_date)}</td>
                          <td className="px-4 py-3 text-slate-600">{hhmm(p.valid_from_time)}–{hhmm(p.valid_to_time)}</td>
                          <td className="px-4 py-3 text-slate-600">{p.user?.full_name || p.user?.username || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PASS_BADGE[p.status] || 'bg-slate-100 text-slate-600'}`}>
                              {PASS_LABEL[p.status] || p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {parked ? (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                                Đang trong bãi{parked.slot?.slot_code ? ` · ${parked.slot.slot_code}` : ''}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">Không trong bãi</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {passes.pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                <span>Trang {passes.page}/{passes.pages} · {passes.total} vé</span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => loadPasses(passFilters, passes.page - 1)} disabled={passLoading || passes.page <= 1}>← Trước</Button>
                  <Button variant="secondary" size="sm" onClick={() => loadPasses(passFilters, passes.page + 1)} disabled={passLoading || passes.page >= passes.pages}>Sau →</Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ═══════════ [3M] MODAL CHO XE DAT CHO VAO — mo tu tab [3] ═══════════
          State + logic: tim "[3M] MODAL CHO XE DAT CHO VAO" phia tren.      */}
      <Modal
        open={!!ciRes}
        title={`Cho xe vào — ${ciRes?.plate_number || ''}`}
        onClose={() => setCiRes(null)}
      >
        <ErrorAlert message={ciError} className="mb-4" />
        <form onSubmit={handleReservationCheckin} className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Loại xe</span><span>{ciRes?.vehicleType?.type_name || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Tầng · Chỗ</span><span>{ciRes?.floor?.floor_code || '—'}{ciRes?.slot?.slot_code ? ` · ${ciRes.slot.slot_code}` : ''}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Khung giờ</span><span>{ciRes?.start_time ? new Date(ciRes.start_time).toLocaleString('vi-VN') : '—'}</span></div>
          </div>

          <Field label="Cổng vào (IN)" hint="Cổng do hệ thống tự chọn theo tầng đã đặt">
            {ciGates.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Tầng đã đặt chưa có cổng vào — Manager cần tạo cổng chiều IN.</p>
            ) : ciGates.length === 1 ? (
              <div className={`${inputClass} flex items-center justify-between bg-slate-50`}>
                <span className="font-medium text-slate-700">{ciGates[0].gate_code}</span>
                <span className="text-xs text-slate-400">tự chọn</span>
              </div>
            ) : (
              <select className={inputClass} value={ciGateId} onChange={(e) => setCiGateId(e.target.value)} required>
                <option value="">— Chọn cổng vào —</option>
                {ciGates.map((g) => (
                  <option key={g.gate_id} value={g.gate_id}>{g.gate_code}</option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCiRes(null)}>Hủy</Button>
            <Button type="submit" className="brand-gradient border-0" loading={ciSubmitting} disabled={!ciGates.length}>
              Xác nhận cho vào
            </Button>
          </div>
        </form>
      </Modal>

      {/* ═════════ [0S] MODAL SUA BIEN SO ═════════
          Ghi đè biển của một lượt gửi ĐANG CHẠY: sai là lúc ra không tra được xe. Nên phải
          thấy biển cũ, có gợi ý định dạng, và lỗi hiện ngay tại ô — chứ không phải một dòng
          trống trong hộp thoại trần của trình duyệt.                                      */}
      <Modal
        open={!!plateEdit}
        title={`Sửa biển số — ${plateEdit?.session?.plate_number || ''}`}
        onClose={() => setPlateEdit(null)}
        size="sm"
        footer={(
          <ModalActions
            onCancel={() => setPlateEdit(null)}
            onConfirm={submitPlateEdit}
            confirmLabel="Lưu biển số"
            loading={plateSaving}
          />
        )}
      >
        {plateEdit && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Biển hiện tại</span>
                <span className="font-mono font-medium">{plateEdit.session.plate_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Chỗ đỗ</span>
                <span>{plateEdit.session.slot?.slot_code || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Loại xe</span>
                <span>{plateEdit.session.vehicleType?.type_name || '—'}</span>
              </div>
            </div>
            <Field label="Biển số mới" required error={plateEdit.error} hint={PLATE_VN_HINT}>
              <input
                className={inputClass}
                value={plateEdit.value}
                autoFocus
                onChange={(e) => setPlateEdit((s) => ({ ...s, value: cleanPlateInput(e.target.value), error: '' }))}
                // Rời ô là chuẩn hoá theo ĐÚNG loại xe của lượt gửi này, khỏi mắc nhập nhằng.
                onBlur={() => setPlateEdit((s) => ({ ...s, value: normalizePlateOrKeep(s.value, plateEditPrefer()) }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPlateEdit(); } }}
              />
            </Field>
            <p className="text-xs text-slate-500">
              Chỉ sửa khi gõ nhầm lúc check-in. Biển mới sẽ dùng để tra xe lúc ra cổng.
            </p>
          </div>
        )}
      </Modal>

      {/* ═════════ [0H] MODAL HUY PHIEN CHUA QUA CONG ═════════
          Thao tác XOÁ một lượt gửi. Nhồi cả đoạn nhắc dài vào window.prompt thì không ai đọc,
          mà đây đúng là chỗ cần đọc: rất nhiều lần nhân viên chỉ cần nhập thêm ảnh.        */}
      <Modal
        open={!!cancelTarget}
        title={`Hủy phiên — ${cancelTarget?.session?.plate_number || ''}`}
        onClose={() => setCancelTarget(null)}
        size="sm"
        footer={(
          <ModalActions
            onCancel={() => setCancelTarget(null)}
            onConfirm={submitCancelEntry}
            confirmLabel="Xác nhận hủy phiên"
            cancelLabel="Không hủy"
            loading={cancelSaving}
          />
        )}
      >
        {cancelTarget && (
          <div className="space-y-3">
            <ErrorAlert message={cancelTarget.error} />
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-900">Chỉ cần nhập thêm ảnh thôi?</p>
              <p className="mt-1 text-xs text-amber-800">
                Vậy thì đóng cửa sổ này và bấm <b>“Bổ sung ảnh”</b> ở cùng dòng xe —
                không cần hủy phiên.
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="text-slate-600">Hủy phiên sẽ:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
                <li>trả lại chỗ đỗ {cancelTarget.session.slot?.slot_code ? <b>{cancelTarget.session.slot.slot_code}</b> : ''} cho bãi</li>
                <li>mở khóa biển số để check-in lại được</li>
                {cancelTarget.session.reservation_id && <li>trả đơn đặt chỗ của khách về dùng lại được</li>}
                <li>ghi một phiếu sự cố để Admin biết ai hủy và vì sao</li>
              </ul>
            </div>
            <Field label="Lý do hủy" required>
              <input
                className={inputClass}
                value={cancelTarget.reason}
                autoFocus
                onChange={(e) => setCancelTarget((s) => ({ ...s, reason: e.target.value, error: '' }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCancelEntry(); } }}
                placeholder="VD: khách đổi ý không gửi nữa"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ═════════ [0M] MODAL VE LAI MA QR — mo tu [1.8] va tu bang [2] ═════════
          Ma QR chi la chuoi token BE da tra san trong danh sach phien dang do, nen ve lai
          duoc hoan toan o FE (qrcode.react) — khong can BE cap lai ma, khong doi token cu.
          Quet lai ma nay o cong ra van dung phien do (BE tra phien theo qr_token).        */}
      <Modal
        open={!!qrSession}
        title={`Mã QR ra cổng — ${qrSession?.plate_number || ''}`}
        onClose={() => setQrSession(null)}
        size="sm"
      >
        {qrSession?.qr_token ? (
          <div className="flex flex-col items-center gap-3">
            <QRCodeSVG value={qrSession.qr_token} size={200} aria-label="Mã QR ra cổng" />
            <span
              className="max-w-60 cursor-default select-all break-all text-center font-mono text-[11px] text-slate-400"
              title={qrSession.qr_token}
            >
              {qrSession.qr_token}
            </span>
            <dl className="w-full space-y-1 border-t border-slate-200 pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Loại xe</dt><dd>{qrSession.vehicleType?.type_name || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Chỗ đỗ</dt><dd className="font-medium text-brand">{qrSession.slot?.slot_code || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Giờ vào</dt><dd>{qrSession.time_in ? new Date(qrSession.time_in).toLocaleString('vi-VN') : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Diện</dt><dd>{SESSION_TYPE_NOTE[qrSession.session_type] || '—'}</dd></div>
            </dl>
            <p className="text-xs text-slate-500">Khách chụp lại mã này để quét khi ra cổng.</p>
          </div>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Phiên này không có mã QR — cho xe ra bằng tab "Thu tiền mặt (ra)".
          </p>
        )}
      </Modal>

      {/* Overlay quét QR bằng camera — dùng chung cho tab [3] Đặt chỗ vào và [5] Thu tiền mặt */}
      {scanTarget && (
        <QrScanner
          onClose={() => setScanTarget(null)}
          onScan={(token) => {
            const target = scanTarget;
            setScanTarget(null);
            if (target === 'reservation') {
              setResQr(token);
              runReservationLookup(token);
            } else if (target === 'booth') {
              setBoothQr(token);
              lookupBooth({ qrToken: token });
            } else if (target === 'checkin') {
              applyCheckinQr(token);
            }
          }}
        />
      )}

      {/* [1P] Chụp ảnh hiện trạng — ép đủ từng góc, không có nút bỏ qua */}
      {photoTarget && (
        <PhotoCapture
          sessionId={photoTarget.sessionId}
          plateNumber={photoTarget.plateNumber}
          phase={photoTarget.phase}
          requiredKinds={photoTarget.requiredKinds}
          onDone={handleCaptureDone}
          onClose={() => setPhotoTarget(null)}
        />
      )}

      {/* Xem ảnh sự cố */}
      <Modal
        open={Boolean(previewIncidentPhoto)}
        size="md"
        title={`Ảnh sự cố (phiếu #${previewIncidentPhoto?.incident?.incident_id || ''})`}
        onClose={() => {
          if (previewIncidentPhoto?.url) {
            URL.revokeObjectURL(previewIncidentPhoto.url);
          }
          setPreviewIncidentPhoto(null);
        }}
      >
        {previewIncidentPhoto?.url ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={previewIncidentPhoto.url}
              alt="Ảnh sự cố"
              className="max-h-[60vh] w-full rounded-lg object-contain shadow-sm border border-slate-100"
            />
            <p className="text-sm text-slate-500 italic text-center">
              {previewIncidentPhoto.incident?.description}
            </p>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">Đang tải ảnh…</p>
        )}
      </Modal>

    </div>
  );
}
