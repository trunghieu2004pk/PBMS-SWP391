import { useEffect, useState } from "react";
import { auditApi } from "../../api/admin";
import { ErrorAlert } from "../../components/ui/Field";
import { inputClass } from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/ui/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import {
  Calendar,
  User,
  Search,
  Trash2,
  ArrowRightLeft,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  Clock,
  Database,
} from "lucide-react";

const emptyFilters = { action: "", actorId: "", from: "", to: "" };

const ACTION_LABEL = {
  "user.create": "Tạo tài khoản",
  "user.update": "Cập nhật tài khoản",
  RESERVATION_REFUND_OWED: "Ghi nợ hoàn tiền đặt chỗ",
  PASS_REFUND_OWED: "Ghi nợ hoàn tiền vé tháng",
  SESSION_PHOTO_VIEW: "Xem ảnh giám sát",
  cancel_entry: "Hủy phiên chưa vào bãi",
  "reservation.no_show": "Hết hạn đặt chỗ",
};
const actionText = (a) => ACTION_LABEL[a] || a;

const ACTION_OPTIONS = [
  ["", "Tất cả hành động"],
  ["user.create", "Tạo tài khoản"],
  ["user.update", "Cập nhật tài khoản"],
  ["cancel_entry", "Hủy phiên chưa vào bãi"],
  ["reservation.no_show", "Hết hạn đặt chỗ"],
];

const FIELD_LABEL = {
  is_active: "trạng thái hoạt động",
  role_id: "vai trò",
  full_name: "họ tên",
  email: "email",
  phone: "số điện thoại",
};

const PHOTO_KIND_LABELS = {
  front: "đầu xe",
  left: "bên trái",
  rear: "đuôi xe",
  right: "bên phải",
  driver: "người lái",
};

// Sử dụng nhãn hành động đơn giản từ actionText(action) với thiết kế nhất quán.

// Mô tả chi tiết dạng chuỗi thuần túy (dùng làm tooltip HTML "title")
const describe = (action, raw) => {
  let d;
  try {
    if (typeof raw === "object" && raw !== null) {
      d = raw;
    } else {
      d = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return String(raw || "—");
  }

  // Đảm bảo d là object hợp lệ và không phải array/null
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    return String(raw || "—");
  }

  const who =
    d.targetUsername ||
    d.username ||
    (d.targetUserId ? `#${d.targetUserId}` : "—");
  if (action === "user.create") {
    return `Tạo tài khoản "${who}" — vai trò ${d.role || "—"}`;
  }
  if (action === "user.update") {
    if (
      d.isActive !== undefined &&
      (d.fields || []).length === 1 &&
      d.fields[0] === "is_active" &&
      !d.passwordChanged
    ) {
      return `${d.isActive ? "Mở khóa" : "Khóa"} tài khoản "${who}"`;
    }
    const parts = (d.fields || []).map((f) => FIELD_LABEL[f] || f);
    if (d.passwordChanged) parts.push("mật khẩu");
    return `Cập nhật "${who}": ${parts.length ? parts.join(", ") : "—"}`;
  }
  if (action === "RESERVATION_REFUND_OWED") {
    return `Đặt chỗ #${d.reservationId || "—"} — Số tiền: ${Number(d.amount || 0).toLocaleString("vi-VN")}đ — ${(d.note || "—").replace("cutoff", "thời hạn quy định")}`;
  }
  if (action === "PASS_REFUND_OWED") {
    return `Vé tháng #${d.passId || "—"} — Số tiền: ${Number(d.amount || 0).toLocaleString("vi-VN")}đ — ${(d.note || "—").replace("cutoff", "thời hạn quy định")}`;
  }
  if (action === "SESSION_PHOTO_VIEW") {
    const phaseLabel =
      d.phase === "entry"
        ? "lúc vào"
        : d.phase === "exit"
          ? "lúc ra"
          : d.phase || "—";
    const kindLabel = PHOTO_KIND_LABELS[d.kind] || d.kind || "—";
    return `Xem ảnh lượt gửi xe #${d.sessionId || "—"} (${phaseLabel}, góc ${kindLabel}) — ${d.intact ? "khớp mã hash" : "lệch mã hash"}`;
  }

  // Fallback: hiện gọn key=value.
  const s = Object.entries(d)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(", ");
  return s || "—";
};

// Trực quan hóa chi tiết của Log dưới dạng các phần tử giao diện JSX sắc nét.
const renderDetails = (action, raw) => {
  let d;
  try {
    if (typeof raw === "object" && raw !== null) {
      d = raw;
    } else {
      d = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return (
      <span className="text-slate-500 font-mono text-xs">
        {String(raw || "—")}
      </span>
    );
  }

  if (!d || typeof d !== "object" || Array.isArray(d)) {
    return (
      <span className="text-slate-500 font-mono text-xs">
        {String(raw || "—")}
      </span>
    );
  }

  const who =
    d.targetUsername ||
    d.username ||
    (d.targetUserId ? `#${d.targetUserId}` : "");

  if (action === "user.create") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-slate-700">
        <span>Tạo tài khoản</span>
        {who && (
          <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-slate-800 text-[11px] font-semibold border border-slate-200">
            {who}
          </span>
        )}
        <span>vai trò</span>
        <span className="font-semibold text-indigo-900 bg-indigo-50 border border-indigo-150 px-2 py-0.5 rounded text-[11px]">
          {d.role || "—"}
        </span>
      </div>
    );
  }

  if (action === "user.update") {
    if (
      d.isActive !== undefined &&
      (d.fields || []).length === 1 &&
      d.fields[0] === "is_active" &&
      !d.passwordChanged
    ) {
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-slate-700">
          <span
            className={
              d.isActive
                ? "text-emerald-900 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]"
                : "text-rose-900 font-bold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-[11px]"
            }
          >
            {d.isActive ? "Mở khóa" : "Khóa"}
          </span>
          <span>tài khoản</span>
          <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-slate-800 text-[11px] font-semibold border border-slate-200">
            {who}
          </span>
        </div>
      );
    }
    const parts = (d.fields || []).map((f) => FIELD_LABEL[f] || f);
    if (d.passwordChanged) parts.push("mật khẩu");
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Cập nhật tài khoản</span>
          <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-slate-800 text-[11px] font-semibold border border-slate-200">
            {who}
          </span>
        </div>
        {parts.length > 0 && (
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            <span>Danh sách sửa đổi:</span>
            <span className="font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded text-[10px]">
              {parts.join(", ")}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (action === "RESERVATION_REFUND_OWED") {
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Đặt chỗ</span>
          <span className="font-mono bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-semibold">
            #{d.reservationId}
          </span>
          <span>hoàn tiền</span>
          <span className="font-bold text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[11px]">
            {Number(d.amount || 0).toLocaleString("vi-VN")}đ
          </span>
        </div>
        {d.note && (
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/60 px-2 py-1 rounded italic break-words whitespace-pre-wrap leading-relaxed max-w-md">
            {d.note.replace("cutoff", "thời hạn quy định")}
          </div>
        )}
      </div>
    );
  }

  if (action === "PASS_REFUND_OWED") {
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Vé tháng</span>
          <span className="font-mono bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-semibold">
            #{d.passId}
          </span>
          <span>hoàn tiền</span>
          <span className="font-bold text-orange-900 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded text-[11px]">
            {Number(d.amount || 0).toLocaleString("vi-VN")}đ
          </span>
        </div>
        {d.note && (
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/60 px-2 py-1 rounded italic break-words whitespace-pre-wrap leading-relaxed max-w-md">
            {d.note.replace("cutoff", "thời hạn quy định")}
          </div>
        )}
      </div>
    );
  }

  if (action === "SESSION_PHOTO_VIEW") {
    const phaseLabel =
      d.phase === "entry"
        ? "Lúc vào"
        : d.phase === "exit"
          ? "Lúc ra"
          : d.phase || "—";
    const kindLabel = PHOTO_KIND_LABELS[d.kind] || d.kind || "—";
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Xem ảnh giám sát lượt</span>
          <span className="font-mono bg-slate-50 px-2 py-0.5 rounded text-slate-800 text-[11px] font-semibold border border-slate-200">
            #{d.sessionId}
          </span>
          <span className="text-xs text-slate-400 font-medium">
            ({phaseLabel} · {kindLabel})
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {d.intact ? (
            <span className="inline-flex items-center gap-1 text-emerald-900 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.2 rounded">
              <ShieldCheck className="h-3 w-3 text-emerald-700" /> Ảnh gốc toàn
              vẹn (Khớp hash)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-rose-900 font-bold bg-rose-50 border border-rose-200 px-2 py-0.2 rounded animate-pulse">
              <AlertTriangle className="h-3 w-3 text-rose-700" /> Ảnh đã chỉnh
              sửa sau khi lưu (Lệch hash!)
            </span>
          )}
        </div>
      </div>
    );
  }

  if (action === "cancel_entry") {
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>Hủy phiên chưa vào bãi</span>
          {d.plate && (
            <span className="font-mono bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-semibold">
              {d.plate}
            </span>
          )}
          {d.sessionId && (
            <span className="text-[10px] text-slate-400">
              (phiên #{d.sessionId})
            </span>
          )}
        </div>
        {d.reason && (
          <div className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200/60 px-2 py-1 rounded italic break-words whitespace-pre-wrap leading-relaxed max-w-md">
            Lý do: {d.reason}
          </div>
        )}
      </div>
    );
  }

  if (action === "reservation.no_show") {
    return (
      <div className="flex flex-col gap-1 text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-slate-800">
            Đặt chỗ hết ca không đến
          </span>
          {d.plate && (
            <span className="font-mono bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 text-[11px] font-semibold">
              {d.plate}
            </span>
          )}
          {d.reservationId && (
            <span className="text-[10px] text-slate-400">
              (đơn #{d.reservationId})
            </span>
          )}
        </div>
        {d.detail && (
          <div className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200/60 px-2 py-1 rounded italic break-words whitespace-pre-wrap leading-relaxed max-w-md">
            {d.detail}
          </div>
        )}
      </div>
    );
  }

  // Fallback: hiện gọn dạng các nhãn nhỏ
  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {Object.entries(d).map(([k, v]) => {
        const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 font-mono text-[10px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded border border-slate-150 shadow-2xs"
          >
            <span className="font-semibold text-slate-400">{k}:</span>
            <span
              className="text-slate-800 break-all whitespace-pre-wrap max-w-xs"
              title={valStr}
            >
              {valStr}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default function AuditLogsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [data, setData] = useState({
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    pages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (page = 1, f = filters) => {
    setLoading(true);
    setError("");
    try {
      const params = { page };
      if (f.action && f.action.trim()) params.action = f.action.trim();
      if (f.actorId && String(f.actorId).trim() !== "")
        params.actorId = Number(f.actorId);
      if (f.from) params.from = f.from;
      if (f.to) params.to = f.to;

      const { data: res } = await auditApi.list(params);
      setData(res.data);
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "Không tải được nhật ký hệ thống",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, []);

  const applyFilters = (e) => {
    e.preventDefault();
    load(1);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    load(1, emptyFilters);
  };

  const { items, page, pages, total } = data;

  const formatDate = (dateStr) => {
    if (!dateStr) return { date: "—", time: "—" };
    const date = new Date(dateStr);
    const datePart = date.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timePart = date.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return { date: datePart, time: timePart };
  };

  const headerActions = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => load(page)}
      loading={loading}
      className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 shadow-sm transition-all duration-150 cursor-pointer"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      Làm mới
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhật ký hệ thống"
        description="Lịch sử ghi vết toàn bộ hoạt động quản lý, cấu hình và bảo mật nhạy cảm (chỉ xem)."
        actions={headerActions}
      />

      {error && <ErrorAlert message={error} className="mb-4 shadow-2xs" />}

      {/* Bộ lọc thiết kế dạng Card sang trọng */}
      <Card className="bg-white border border-slate-200/80 shadow-sm p-5 relative overflow-visible">
        <form
          onSubmit={applyFilters}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" /> Hành
              động
            </span>
            <div className="relative">
              <select
                className={`${inputClass} w-full pr-10 appearance-none bg-white border border-slate-200 hover:border-slate-350 focus:border-brand transition-all`}
                value={filters.action}
                onChange={(e) =>
                  setFilters({ ...filters, action: e.target.value })
                }
              >
                {ACTION_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-450">
                <svg
                  className="fill-current h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-slate-400" /> Người thực hiện
              (ID)
            </span>
            <input
              type="number"
              min="1"
              className={`${inputClass} border border-slate-200 hover:border-slate-350 focus:border-brand`}
              value={filters.actorId}
              onChange={(e) =>
                setFilters({ ...filters, actorId: e.target.value })
              }
              placeholder="Ví dụ: 1"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" /> Từ ngày
            </span>
            <input
              type="date"
              className={`${inputClass} border border-slate-200 hover:border-slate-350 focus:border-brand`}
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" /> Đến ngày
            </span>
            <input
              type="date"
              className={`${inputClass} border border-slate-200 hover:border-slate-350 focus:border-brand`}
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              className="flex-1 brand-gradient text-white border-0 shadow-(--shadow-soft) hover:opacity-95 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer"
              loading={loading}
            >
              <Search className="h-4 w-4" /> Lọc
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={resetFilters}
              className="flex-1 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer"
            >
              <Trash2 className="h-4 w-4 text-slate-500" /> Xóa lọc
            </Button>
          </div>
        </form>
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-400">
          <Info className="h-4 w-4 text-slate-400" />
          <span>
            Để lọc chính xác theo ngày, vui lòng điền đầy đủ cả hai mốc{" "}
            <b>"Từ ngày"</b> và <b>"Đến ngày"</b>.
          </span>
        </div>
      </Card>

      {/* Bảng nhật ký với thiết kế phẳng hiện đại */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Thời gian
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Người thực hiện
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Hành động
                </th>
                <th className="px-6 py-4 font-semibold">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Spinner size="md" />
                      <span className="text-slate-400 text-sm font-semibold">
                        Đang tải lịch sử nhật ký...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12">
                    <EmptyState
                      icon={Database}
                      title="Không tìm thấy nhật ký"
                      description="Không có bản ghi nào trùng khớp với bộ lọc hiện tại của bạn."
                    />
                  </td>
                </tr>
              ) : (
                items.map((log) => {
                  const { date, time } = formatDate(log.created_at);
                  return (
                    <tr
                      key={log.log_id}
                      className="hover:bg-slate-50/40 transition-colors duration-150"
                    >
                      <td className="px-6 py-4.5 whitespace-nowrap text-xs text-slate-500 font-medium">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-slate-700 font-bold">
                            {time}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span className="text-slate-500">{date}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="h-8.5 w-8.5 rounded-full bg-slate-100 flex items-center justify-center text-slate-655 font-bold text-xs border border-slate-200 uppercase shadow-sm">
                            {log.actor?.full_name?.charAt(0) ||
                              log.actor?.username?.charAt(0) ||
                              "H"}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-800 text-sm leading-tight">
                              {log.actor?.full_name ||
                                log.actor?.username ||
                                "Hệ thống"}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1">
                              <span>ID:</span>
                              <span className="bg-slate-50 px-1.5 py-0.2 rounded border border-slate-200/60 font-bold">
                                #{log.actor_id}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4.5 whitespace-nowrap">
                        <span className="inline-block rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand">
                          {actionText(log.action)}
                        </span>
                      </td>
                      <td
                        className="px-6 py-4.5 text-slate-650 max-w-lg"
                        title={describe(log.action, log.details)}
                      >
                        {renderDetails(log.action, log.details)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Thanh phân trang thiết kế lại */}
      <div className="flex flex-wrap items-center justify-between border-t border-slate-100 pt-4 gap-4 text-sm text-slate-500">
        <span className="font-medium">
          {total > 0 ? (
            <>
              Hiển thị trang{" "}
              <span className="text-slate-800 font-bold">{page}</span> trên tổng
              số <span className="text-slate-800 font-bold">{pages}</span> trang
              · <span className="text-slate-800 font-bold">{total}</span> bản
              ghi
            </>
          ) : (
            "Không có bản ghi nào"
          )}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => load(page - 1)}
            disabled={loading || page <= 1}
            className="flex items-center gap-1 border border-slate-200 hover:bg-slate-50 px-3 cursor-pointer shadow-2xs"
          >
            <ChevronLeft className="h-4 w-4" /> Trước
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => load(page + 1)}
            disabled={loading || page >= pages}
            className="flex items-center gap-1 border border-slate-200 hover:bg-slate-50 px-3 cursor-pointer shadow-2xs"
          >
            Sau <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
