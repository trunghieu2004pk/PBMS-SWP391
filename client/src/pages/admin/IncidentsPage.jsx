import { useEffect, useState } from "react";
import {
  Images,
  Image as ImageIcon,
  MessageSquare,
  AlertTriangle,
  FileText,
  CheckCircle,
  Clock,
  SlidersHorizontal,
  RotateCcw,
  User,
  Eye,
  Camera,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  ChevronRight,
  Info,
  RefreshCw,
  Sliders,
  Trash2,
  Search,
  Phone,
} from "lucide-react";
import { incidentsApi, fetchIncidentPhotoBlobUrl } from "../../api/incidents";
import { sessionPhotosApi } from "../../api/sessionPhotos";
import { ErrorAlert } from "../../components/ui/Field";
import { inputClass } from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import PageHeader from "../../components/ui/PageHeader";
import Modal from "../../components/ui/Modal";
import PhotoCompare from "../../components/PhotoCompare";
import { toast } from "../../components/ui/toast";

// Mirror nhãn server (INCIDENT_TYPE_LABELS) cho dropdown lọc loại.
const TYPE_OPTIONS = [
  ["", "Tất cả loại sự cố"],
  ["vehicle_damage", "Hư hại xe (Vehicle Damage)"],
  ["feedback", "Phản hồi khách"],
  ["wrong_floor", "Sai tầng"],
  ["duplicate_session", "Trùng phiên"],
  ["window_violation", "Vi phạm khung giờ"],
  ["slot_conflict", "Xung đột slot"],
  ["lost_ticket", "Mất thẻ"],
  ["wrong_info", "Sai thông tin xe"],
  ["overstay", "Quá hạn gửi"],
  ["wrong_zone", "Sai khu vực"],
  ["other", "Khác"],
];

const CATEGORY_OPTIONS = [
  ["", "Tất cả danh mục"],
  ["vehicle_damage", "Hư hại xe (Vehicle Damage)"],
  ["lost_card", "Mất thẻ / QR"],
  ["wrong_fee", "Sai phí"],
  ["hard_to_find", "Khó tìm xe"],
  ["slot_taken", "Slot bị chiếm"],
  ["other", "Khác"],
];

const STATUS_OPTIONS = [
  ["", "Tất cả trạng thái"],
  ["open", "Mới"],
  ["investigating", "Đang xử lý"],
  ["resolved", "Đã xử lý"],
];

const STATUS_BADGE = {
  open: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/25",
  investigating: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/25",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/25",
};

const emptyFilters = { status: "", type: "", category: "" };

export default function IncidentsPage() {
  const [data, setData] = useState({
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    pages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [updatingId, setUpdatingId] = useState(null);

  // Xem bộ ảnh VÀO/RA của phiên gắn với phiếu
  const [photoModal, setPhotoModal] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  // Xem ảnh khách hàng đính kèm khi gửi phản hồi / khiếu nại
  const [customerPhotoModal, setCustomerPhotoModal] = useState(null);

  // Đóng phiếu bắt buộc ghi kết luận.
  const [resolveFor, setResolveFor] = useState(null);
  const [resolutionText, setResolutionText] = useState("");
  const [resolving, setResolving] = useState(false);

  const openPhotos = async (inc) => {
    const sessionId = inc.session?.session_id;
    if (!sessionId) return;
    setPhotoLoading(true);
    setPhotoModal({ incident: inc, data: null });
    try {
      const { data: res } = await sessionPhotosApi.list(sessionId);
      setPhotoModal({ incident: inc, data: res.data });
    } catch (err) {
      setPhotoModal(null);
      toast.error(
        err.response?.data?.error?.message ||
          "Không tải được ảnh của lượt gửi này",
      );
    } finally {
      setPhotoLoading(false);
    }
  };

  const openCustomerPhoto = async (inc) => {
    try {
      const paths = inc.image_path ? inc.image_path.split(",") : [];
      const urls = await Promise.all(
        paths.map((_, index) =>
          fetchIncidentPhotoBlobUrl(inc.incident_id, index),
        ),
      );
      setCustomerPhotoModal({ urls, incident: inc, currentIndex: 0 });
    } catch {
      toast.error("Không tải được ảnh đính kèm của phiếu này");
    }
  };

  const load = async (page = 1, f = filters) => {
    setLoading(true);
    setError("");
    try {
      const params = { page };
      if (f.status) params.status = f.status;
      if (f.type) params.type = f.type;
      if (f.category) params.category = f.category;
      const { data: res } = await incidentsApi.list(params);
      setData(res.data);
    } catch (err) {
      setError(
        err.response?.data?.error?.message || "Không tải được danh sách sự cố",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyFilters = (e) => {
    if (e) e.preventDefault();
    load(1);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    load(1, emptyFilters);
  };

  const changeStatus = async (inc, status) => {
    if (status === inc.status) return;
    if (status === "resolved") {
      setResolutionText("");
      setResolveFor(inc);
      return;
    }
    setUpdatingId(inc.incident_id);
    try {
      await incidentsApi.updateStatus(inc.incident_id, status);
      toast.success("Đã cập nhật trạng thái sự cố");
      load(data.page);
    } catch (err) {
      toast.error(
        err.response?.data?.error?.message || "Cập nhật trạng thái thất bại",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const submitResolution = async () => {
    if (!resolveFor || !resolutionText.trim()) return;
    setResolving(true);
    try {
      await incidentsApi.updateStatus(
        resolveFor.incident_id,
        "resolved",
        resolutionText.trim(),
      );
      toast.success("Đã đóng phiếu kèm kết luận");
      setResolveFor(null);
      load(data.page);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || "Đóng phiếu thất bại");
    } finally {
      setResolving(false);
    }
  };

  const { items, page, pages, total } = data;
  const resolvedCount = items.filter((i) => i.status === "resolved").length;
  const pendingCount = items.filter(
    (i) => i.status === "open" || i.status === "investigating",
  ).length;

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
        title="Quản lý Sự cố & Khiếu nại"
        description="Giám sát, xử lý các sự cố vận hành từ nhân viên báo cáo và quản lý ý kiến đóng góp, khiếu nại đền bù từ phía khách hàng."
        actions={headerActions}
      />

      {error && <ErrorAlert message={error} className="mb-4 shadow-2xs" />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <FileText size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Tổng số sự cố (Bộ lọc)
            </p>
            <h3 className="text-2xl font-bold text-slate-800">{total}</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Đã giải quyết (Trang này)
            </p>
            <h3 className="text-2xl font-bold text-slate-800">
              {resolvedCount}
            </h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Chờ xử lý / Mới (Trang này)
            </p>
            <h3 className="text-2xl font-bold text-slate-800">
              {pendingCount}
            </h3>
          </div>
        </div>
      </div>

      <Card className="bg-white border border-slate-200/80 shadow-sm p-5 relative overflow-visible">
        <form
          onSubmit={handleApplyFilters}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-slate-400" /> Trạng thái
            </span>
            <div className="relative">
              <select
                className={`${inputClass} w-full pr-10 appearance-none bg-white border border-slate-200 hover:border-slate-350 focus:border-brand transition-all`}
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                {STATUS_OPTIONS.map(([v, label]) => (
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
              <AlertTriangle className="h-3.5 w-3.5 text-slate-400" /> Loại sự
              cố
            </span>
            <div className="relative">
              <select
                className={`${inputClass} w-full pr-10 appearance-none bg-white border border-slate-200 hover:border-slate-350 focus:border-brand transition-all`}
                value={filters.type}
                onChange={(e) =>
                  setFilters({ ...filters, type: e.target.value })
                }
              >
                {TYPE_OPTIONS.map(([v, label]) => (
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
              <MessageSquare className="h-3.5 w-3.5 text-slate-400" /> Danh mục
              phản hồi
            </span>
            <div className="relative">
              <select
                className={`${inputClass} w-full pr-10 appearance-none bg-white border border-slate-200 hover:border-slate-350 focus:border-brand transition-all`}
                value={filters.category}
                onChange={(e) =>
                  setFilters({ ...filters, category: e.target.value })
                }
              >
                {CATEGORY_OPTIONS.map(([v, label]) => (
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

          <div className="flex gap-2">
            <Button
              type="submit"
              className="flex-1 brand-gradient text-white border-0 shadow-sm hover:opacity-95 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer"
              loading={loading}
            >
              <Search className="h-4 w-4" /> Lọc
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={clearFilters}
              className="flex-1 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 flex items-center justify-center gap-1.5 transition-all duration-150 cursor-pointer"
            >
              <Trash2 className="h-4 w-4 text-slate-500" /> Xóa lọc
            </Button>
          </div>
        </form>
      </Card>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Thời gian
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Loại / Danh mục
                </th>
                <th className="px-6 py-4 font-semibold">Mô tả & Minh chứng</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Người gửi / Báo
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Liên quan
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Trạng thái
                </th>
                <th className="px-6 py-4 font-semibold">Xử lý / Kết luận</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-brand mb-2" />
                    <p className="text-xs">Đang tải danh sách sự cố...</p>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    Không tìm thấy sự cố nào khớp bộ lọc
                  </td>
                </tr>
              ) : (
                items.map((inc) => (
                  <tr
                    key={inc.incident_id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Cột 1: Thời gian */}
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500 text-xs">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {inc.created_at
                          ? new Date(inc.created_at).toLocaleString("vi-VN")
                          : "—"}
                      </div>
                    </td>

                    {/* Cột 2: Loại / Danh mục */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                            inc.type === "vehicle_damage" ||
                            inc.category === "vehicle_damage"
                              ? "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20"
                              : "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                          }`}
                        >
                          {inc.typeLabel}
                        </span>
                        {inc.categoryLabel &&
                          inc.categoryLabel !== inc.typeLabel && (
                            <span className="inline-block rounded px-1.5 py-0.2 text-[10px] font-semibold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/10">
                              {inc.categoryLabel}
                            </span>
                          )}
                      </div>
                    </td>

                    {/* Cột 3: Mô tả & Minh chứng */}
                    <td className="px-6 py-4 max-w-sm">
                      <div className="space-y-1.5">
                        <p
                          className="text-slate-700 text-xs leading-relaxed font-medium"
                          title={inc.description}
                        >
                          {inc.description}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          {inc.image_path && (
                            <button
                              type="button"
                              onClick={() => openCustomerPhoto(inc)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-600 hover:text-sky-700 hover:underline bg-sky-50 px-2 py-0.5 rounded border border-sky-100 cursor-pointer"
                            >
                              <ImageIcon className="h-3.5 w-3.5" /> Ảnh đính kèm
                            </button>
                          )}

                          {inc.session?.session_id && (
                            <button
                              type="button"
                              onClick={() => openPhotos(inc)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:text-brand-dark hover:underline bg-brand/5 px-2 py-0.5 rounded border border-brand/10 cursor-pointer"
                            >
                              <Images className="h-3.5 w-3.5" /> Đối chiếu 5 góc
                            </button>
                          )}
                        </div>

                        {inc.claimWindow && (
                          <div>
                            {inc.claimWindow.filedAfterExit ? (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
                                title="Xe đã rời bãi trước khi báo cáo được gửi"
                              >
                                Gửi sau khi xe ra{" "}
                                {inc.claimWindow.minutesAfterExit} phút
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                Lập khi xe còn trong bãi
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Cột 4: Người gửi / Báo */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-slate-100 rounded-lg text-slate-500">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="text-xs">
                          {/* Ưu tiên kiểm tra nhân viên báo trước */}
                          {inc.reporter?.full_name || inc.reporter?.username ? (
                            <div>
                              <p className="font-semibold text-slate-800">
                                {inc.reporter.full_name ||
                                  inc.reporter.username}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-slate-400">
                                  Nhân viên
                                </span>
                                {/* SĐT Nhân viên (Nếu có) */}
                                {(inc.reporter.phone ||
                                  inc.reporter.phone_number) && (
                                  <>
                                    <span className="text-slate-300">•</span>
                                    <span className="text-[10px] text-slate-500 font-medium flex items-center gap-0.5">
                                      <Phone className="h-2.5 w-2.5" />{" "}
                                      {inc.reporter.phone ||
                                        inc.reporter.phone_number}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : inc.user &&
                            (inc.type === "feedback" || inc.image_path) ? (
                            // Nếu không có nhân viên báo, mà là feedback hoặc có ảnh đính kèm -> Khách tự báo
                            <div>
                              <p className="font-semibold text-slate-800">
                                {inc.user.full_name || inc.user.username}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-slate-400">
                                  Khách hàng
                                </span>
                              </div>
                            </div>
                          ) : (
                            // Các trường hợp còn lại (Quá giờ, Sai tầng, Trùng phiên...)
                            <p className="text-slate-500 italic">Hệ thống</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Cột 5: Liên quan (Nơi hiển thị biển số xe & SĐT Chủ xe) */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="space-y-2">
                        {/* Box 1: Biển số & Chỗ đỗ */}
                        <div className="space-y-1">
                          {inc.session?.plate_number ? (
                            <span className="inline-block font-mono font-bold bg-slate-150 px-2 py-0.5 rounded text-slate-800 text-xs border border-slate-200">
                              {inc.session.plate_number}
                            </span>
                          ) : (
                            <span className="text-slate-450 text-xs">—</span>
                          )}
                          {inc.slot?.slot_code && (
                            <span className="block text-[11px] text-slate-400 font-semibold flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {inc.slot.slot_code}
                            </span>
                          )}
                        </div>

                        {/* Box 2: Thông tin SĐT CHỦ XE */}
                        {inc.user && (
                          <div className="pt-1.5 border-t border-slate-100">
                            <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold block mb-0.5">
                              Thông tin chủ xe
                            </span>
                            <div className="text-[11px] text-slate-700 font-medium">
                              {inc.user.full_name || inc.user.username}
                            </div>
                            {(inc.user.phone || inc.user.phone_number) && (
                              <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <Phone className="h-3 w-3 text-slate-400" />
                                {inc.user.phone || inc.user.phone_number}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Cột 6: Trạng thái */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="relative inline-block">
                        <select
                          className={`rounded-lg border border-slate-200 py-1 pl-2.5 pr-7 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-brand/40 shadow-2xs cursor-pointer appearance-none bg-white ${STATUS_BADGE[inc.status] || "bg-slate-105 text-slate-600"}`}
                          value={inc.status}
                          disabled={updatingId === inc.incident_id}
                          onChange={(e) => changeStatus(inc, e.target.value)}
                        >
                          {STATUS_OPTIONS.slice(1).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-slate-450">
                          <svg
                            className="fill-current h-3.5 w-3.5"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                          >
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                          </svg>
                        </div>
                      </div>
                    </td>

                    {/* Cột 7: Người xử lý / Kết luận */}
                    <td className="px-6 py-4 text-xs max-w-xs">
                      {inc.status === "resolved" ? (
                        <div className="space-y-1">
                          {inc.resolver && (
                            <div className="text-slate-500 font-medium">
                              <span>
                                Bởi:{" "}
                                {inc.resolver.full_name ||
                                  inc.resolver.username}
                              </span>
                            </div>
                          )}
                          {inc.resolution ? (
                            <p
                              className="text-[11px] text-slate-650 italic bg-slate-50 p-2 rounded border border-slate-100 break-words"
                              title={inc.resolution}
                            >
                              {inc.resolution}
                            </p>
                          ) : (
                            <span className="text-slate-400 italic">
                              Không ghi kết luận
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-405 italic">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span>
            {total > 0
              ? `Trang ${page}/${pages} · Tổng cộng ${total} sự cố`
              : "Không có sự cố"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => load(page - 1)}
              disabled={loading || page <= 1}
              className="border border-slate-200 hover:bg-slate-50 transition-all duration-150 cursor-pointer"
            >
              ← Trước
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => load(page + 1)}
              disabled={loading || page >= pages}
              className="border border-slate-200 hover:bg-slate-50 transition-all duration-150 cursor-pointer"
            >
              Sau →
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(photoModal)}
        size="lg"
        title={
          photoModal
            ? `Ảnh đối chiếu hiện trạng — ${photoModal.incident.session?.plate_number || "lượt gửi"} (phiếu #${photoModal.incident.incident_id})`
            : ""
        }
        onClose={() => setPhotoModal(null)}
      >
        {photoLoading || !photoModal?.data ? (
          <div className="py-12 text-center text-sm text-slate-450">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-brand/30 border-t-brand mb-2" />
            <p>Đang tải ảnh đối chiếu…</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-650 border border-slate-200">
              <span className="font-bold text-slate-700">Mô tả sự cố:</span>{" "}
              <span className="italic">
                &ldquo;{photoModal.incident.description}&rdquo;
              </span>
            </div>
            <PhotoCompare
              sessionId={photoModal.data.sessionId}
              data={photoModal.data}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(customerPhotoModal)}
        size="lg"
        title={
          customerPhotoModal?.incident?.user
            ? `Ảnh minh chứng khách hàng — Phiếu #${customerPhotoModal?.incident?.incident_id || ""}`
            : `Ảnh minh họa sự cố — Phiếu #${customerPhotoModal?.incident?.incident_id || ""}`
        }
        onClose={() => {
          if (customerPhotoModal?.urls) {
            customerPhotoModal.urls.forEach((url) => URL.revokeObjectURL(url));
          }
          setCustomerPhotoModal(null);
        }}
      >
        {customerPhotoModal?.urls && customerPhotoModal.urls.length > 0 && (
          <div className="space-y-4">
            <div className="relative w-full flex items-center justify-center min-h-[300px]">
              {customerPhotoModal.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute left-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() =>
                    setCustomerPhotoModal((prev) => ({
                      ...prev,
                      currentIndex:
                        (prev.currentIndex - 1 + prev.urls.length) %
                        prev.urls.length,
                    }))
                  }
                >
                  &larr;
                </button>
              )}
              <div className="overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center max-h-[70vh] w-full border border-slate-800 shadow-lg">
                <img
                  src={customerPhotoModal.urls[customerPhotoModal.currentIndex]}
                  alt="Ảnh đính kèm"
                  className="max-h-[68vh] w-auto object-contain transition-all duration-300 hover:scale-105"
                />
              </div>
              {customerPhotoModal.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute right-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() =>
                    setCustomerPhotoModal((prev) => ({
                      ...prev,
                      currentIndex: (prev.currentIndex + 1) % prev.urls.length,
                    }))
                  }
                >
                  &rarr;
                </button>
              )}
            </div>
            {customerPhotoModal.urls.length > 1 && (
              <p className="text-sm text-slate-500 font-semibold text-center">
                Ảnh {customerPhotoModal.currentIndex + 1} /{" "}
                {customerPhotoModal.urls.length}
              </p>
            )}
            <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-755 border border-slate-200 space-y-1.5 shadow-2xs">
              <p>
                <strong>Người gửi:</strong>{" "}
                {customerPhotoModal.incident?.user
                  ? `${customerPhotoModal.incident.user.full_name || customerPhotoModal.incident.user.username} (Khách hàng)`
                  : customerPhotoModal.incident?.reporter
                    ? `${customerPhotoModal.incident.reporter.full_name || customerPhotoModal.incident.reporter.username} (Nhân viên)`
                    : "Hệ thống"}
              </p>
              <p className="leading-relaxed">
                <strong>Nội dung:</strong> &ldquo;
                {customerPhotoModal.incident?.description}&rdquo;
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(resolveFor)}
        title={`Đóng phiếu sự cố #${resolveFor?.incident_id || ""}`}
        onClose={() => setResolveFor(null)}
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button
              variant="secondary"
              onClick={() => setResolveFor(null)}
              disabled={resolving}
              className="cursor-pointer"
            >
              Hủy bỏ
            </Button>
            <Button
              onClick={submitResolution}
              loading={resolving}
              disabled={!resolutionText.trim()}
              className="cursor-pointer"
            >
              Đóng phiếu & Lưu kết luận
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-650 leading-relaxed">
            Ghi rõ kết luận giải quyết và căn cứ liên quan (ví dụ: bồi thường
            bao nhiêu, dựa vào ảnh đối chiếu hay biên bản thỏa thuận). Kết luận
            này sẽ được lưu cố định để tra cứu về sau.
          </p>
          <div>
            <textarea
              className={`${inputClass} w-full min-h-28 transition-all duration-200 focus:ring-brand/35 rounded-xl`}
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              maxLength={500}
              placeholder="Ví dụ: Đối chiếu ảnh lúc vào gương trái nguyên vẹn, lúc ra bị nứt vỡ. Bãi đỗ xe đã thỏa thuận và đền bù cho khách hàng số tiền 800.000đ."
            />
            <p className="mt-1 text-right text-xs text-slate-400">
              {resolutionText.length}/500 ký tự
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
