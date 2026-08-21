import { useEffect, useState } from 'react';
import { Images, CheckCircle2 } from 'lucide-react';
import { incidentsApi, fetchIncidentPhotoBlobUrl } from '../../api/incidents';
import { sessionPhotosApi } from '../../api/sessionPhotos';
import { ErrorAlert } from '../../components/ui/Field';
import { inputClass } from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PhotoCompare from '../../components/PhotoCompare';
import { toast } from '../../components/ui/toast';

// Quản lý sự cố (UC-09) — Admin xem TẤT CẢ sự cố + lọc + đổi trạng thái.
// Nguồn: GET /incidents (Admin thấy tất cả) + PATCH /incidents/:id/status.

// Mirror nhãn server (INCIDENT_TYPE_LABELS) cho dropdown lọc loại.
const TYPE_OPTIONS = [
  ['wrong_floor', 'Sai tầng'],
  ['duplicate_session', 'Trùng phiên'],
  ['window_violation', 'Vi phạm khung giờ'],
  ['slot_conflict', 'Xung đột slot'],
  ['lost_ticket', 'Mất thẻ'],
  ['wrong_info', 'Sai thông tin xe'],
  ['overstay', 'Quá hạn gửi'],
  ['wrong_zone', 'Sai khu vực'],
  ['feedback', 'Phản hồi khách'],
  ['vehicle_damage', 'Hư hại xe'],
  ['other', 'Khác'],
];

const STATUS_OPTIONS = [
  ['open', 'Mới'],
  ['investigating', 'Đang xử lý'],
  ['resolved', 'Đã xử lý'],
];

const STATUS_BADGE = {
  open: 'bg-amber-50 text-amber-700 border-amber-100',
  investigating: 'bg-blue-50 text-blue-700 border-blue-100',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

const getIncidentTypeStyles = (type) => {
  switch (type) {
    case 'lost_ticket': return 'bg-amber-50 text-amber-700 border-amber-200/60';
    case 'wrong_info': return 'bg-rose-50 text-rose-700 border-rose-200/60';
    case 'overstay': return 'bg-violet-50 text-violet-700 border-violet-200/60';
    case 'wrong_zone': return 'bg-sky-50 text-sky-700 border-sky-200/60';
    case 'vehicle_damage': return 'bg-red-50 text-red-700 border-red-200/60';
    default: return 'bg-slate-50 text-slate-700 border-slate-200/60';
  }
};

const getTodayStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const defaultFilters = { status: '', type: '', date: getTodayStr() };
const emptyFilters = { status: '', type: '', date: '' };

export default function IncidentsPage() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, limit: 50, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(defaultFilters);
  const [updatingId, setUpdatingId] = useState(null);
  
  // Xem bộ ảnh VÀO/RA của phiên gắn với phiếu
  const [photoModal, setPhotoModal] = useState(null); // { incident, data } | null
  const [photoLoading, setPhotoLoading] = useState(false);
  
  // Đóng phiếu bắt buộc ghi kết luận.
  const [resolveFor, setResolveFor] = useState(null); // incident đang chờ ghi kết luận
  const [resolutionText, setResolutionText] = useState('');
  const [previewIncidentPhoto, setPreviewIncidentPhoto] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [incidentPhotoLoading, setIncidentPhotoLoading] = useState(false);

  const openIncidentPhoto = async (inc) => {
    setIncidentPhotoLoading(true);
    try {
      const paths = inc.image_path ? inc.image_path.split(',') : [];
      const urls = await Promise.all(
        paths.map((_, index) => fetchIncidentPhotoBlobUrl(inc.incident_id, index))
      );
      setPreviewIncidentPhoto({ incident: inc, urls, currentIndex: 0 });
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Không tải được ảnh sự cố');
    } finally {
      setIncidentPhotoLoading(false);
    }
  };

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
      toast.error(err.response?.data?.error?.message || 'Không tải được ảnh của lượt gửi này');
    } finally {
      setPhotoLoading(false);
    }
  };

  const load = async (page = 1, f = filters) => {
    setLoading(true);
    setError('');
    try {
      const params = { page };
      if (f.status) params.status = f.status;
      if (f.type) params.type = f.type;
      if (f.date) params.date = f.date;
      const { data: res } = await incidentsApi.list(params);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Không tải được danh sách sự cố');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = (next) => {
    setFilters(next);
    load(1, next);
  };

  const changeStatus = async (inc, status) => {
    if (status === inc.status) return;
    // Đóng phiếu phải ghi kết luận → mở ô nhập trước, không gọi API ngay.
    if (status === 'resolved') {
      setResolutionText('');
      setResolveFor(inc);
      return;
    }
    setUpdatingId(inc.incident_id);
    try {
      await incidentsApi.updateStatus(inc.incident_id, status);
      toast.success('Đã cập nhật trạng thái sự cố');
      load(data.page);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Cập nhật trạng thái thất bại');
    } finally {
      setUpdatingId(null);
    }
  };

  const submitResolution = async () => {
    if (!resolveFor || !resolutionText.trim()) return;
    setResolving(true);
    try {
      await incidentsApi.updateStatus(resolveFor.incident_id, 'resolved', resolutionText.trim());
      toast.success('Đã đóng phiếu kèm kết luận');
      setResolveFor(null);
      load(data.page);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Đóng phiếu thất bại');
    } finally {
      setResolving(false);
    }
  };

  const { items, page, pages, total } = data;

  return (
    <div className="animate-fadeIn">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý sự cố</h1>
          <p className="mt-1 text-sm text-slate-500">Xem sự cố nhân viên báo & cập nhật trạng thái xử lý</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(page)} loading={loading} className="shadow-sm">
          Làm mới
        </Button>
      </div>

      {error && <ErrorAlert message={error} className="mb-4" />}

      {/* Bộ lọc */}
      <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Trạng thái</span>
            <select className={`${inputClass} !py-1.5 !px-3 !h-9 text-slate-700 transition-all focus:ring-brand/30 rounded-xl cursor-pointer`} value={filters.status} onChange={(e) => applyFilter({ ...filters, status: e.target.value })}>
              <option value="">— Tất cả —</option>
              {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Loại sự cố</span>
            <select className={`${inputClass} !py-1.5 !px-3 !h-9 text-slate-700 transition-all focus:ring-brand/30 rounded-xl cursor-pointer`} value={filters.type} onChange={(e) => applyFilter({ ...filters, type: e.target.value })}>
              <option value="">— Tất cả —</option>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Lọc theo ngày</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className={`${inputClass} !py-1.5 !px-3 !h-9 text-slate-700 cursor-pointer transition-all focus:ring-brand/30 rounded-xl w-38`}
                value={filters.date}
                onChange={(e) => applyFilter({ ...filters, date: e.target.value })}
              />
              {filters.date && (
                <button
                  type="button"
                  onClick={() => applyFilter({ ...filters, date: '' })}
                  className="text-xs text-rose-500 hover:text-rose-700 font-semibold transition-colors px-1"
                >
                  Xóa lọc
                </button>
              )}
            </div>
          </label>
        </div>
        
        {total > 0 && (
          <span className="text-xs text-slate-500 font-medium bg-slate-50 rounded-lg py-1.5 px-3 border border-slate-100">
            Tổng cộng: <strong className="text-slate-800 font-semibold">{total}</strong> sự cố
          </span>
        )}
      </div>

      {/* Bảng sự cố */}
      <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-5 py-3.5 font-semibold text-left whitespace-nowrap">Thời gian</th>
              <th className="px-5 py-3.5 font-semibold text-left">Loại</th>
              <th className="px-5 py-3.5 font-semibold text-left">Mô tả</th>
              <th className="px-5 py-3.5 font-semibold text-left">Người báo</th>
              <th className="px-5 py-3.5 font-semibold text-left">Liên quan</th>
              <th className="px-5 py-3.5 font-semibold text-left">Trạng thái</th>
              <th className="px-5 py-3.5 font-semibold text-left">Người xử lý</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">Đang tải...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400 animate-pulse">Không có sự cố nào khớp bộ lọc</td></tr>
            ) : (
              items.map((inc) => (
                <tr key={inc.incident_id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500 text-xs">{inc.created_at ? new Date(inc.created_at).toLocaleString('vi-VN') : '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold border whitespace-nowrap ${getIncidentTypeStyles(inc.type)}`}>
                      {inc.typeLabel}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-700">
                    <span className="block max-w-[240px] break-words whitespace-pre-wrap leading-normal" title={inc.description}>{inc.description}</span>
                    {/* Dữ kiện khách quan cho người xử lý */}
                    {inc.claimWindow?.filedAfterExit && (
                      <span
                        className="mt-1 inline-block rounded-md bg-rose-50 border border-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700"
                        title="Xe đã rời bãi trước khi phiếu được lập — bãi không kiểm soát được chiếc xe trong khoảng đó"
                      >
                        Lập SAU khi xe ra {inc.claimWindow.minutesAfterExit} phút
                      </span>
                    )}
                    {inc.claimWindow && !inc.claimWindow.filedAfterExit && (
                      <span className="mt-1 inline-block rounded-md bg-emerald-50 border border-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        Lập khi xe còn trong bãi
                      </span>
                    )}
                    {inc.resolution && (
                      <span className="mt-1 block max-w-[240px] break-words whitespace-pre-wrap text-[11px] text-emerald-700 font-medium" title={inc.resolution}>
                        Kết luận: {inc.resolution}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {inc.reporter ? (
                      inc.reporter.full_name || inc.reporter.username
                    ) : inc.user ? (
                      <span className="text-slate-600 font-medium" title="Khách hàng gửi báo cáo">
                        Khách: {inc.user.full_name || inc.user.username}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic text-xs">Hệ thống</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-col gap-1.5 items-start">
                      {inc.session?.plate_number ? (
                        <span className="inline-flex items-center justify-center px-2 py-0.5 font-mono text-[11px] font-bold border border-slate-300 rounded bg-white text-slate-800 shadow-sm tracking-wider" title="Biển số xe liên quan">
                          {inc.session.plate_number}
                        </span>
                      ) : null}
                      {inc.slot?.slot_code ? (
                        <span className="text-[10px] text-slate-400 font-medium bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">
                          Vị trí: {inc.slot.slot_code}
                        </span>
                      ) : null}
                      {!inc.session?.plate_number && !inc.slot?.slot_code && <span className="text-slate-400">—</span>}
                      
                      {/* Bằng chứng: mở bộ ảnh VÀO/RA của chính lượt gửi bị khiếu nại. */}
                      {inc.session?.session_id && (
                        <button
                          type="button"
                          onClick={() => openPhotos(inc)}
                          className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-brand hover:text-brand-dark transition-colors"
                        >
                          <Images className="h-3 w-3" /> Xem ảnh đối chiếu
                        </button>
                      )}
                      {inc.image_path && (
                        <button
                          type="button"
                          onClick={() => openIncidentPhoto(inc)}
                          className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700 transition-colors"
                        >
                          <Images className="h-3 w-3" /> Xem ảnh sự cố
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <select
                      className={`rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand/30 cursor-pointer transition-all ${STATUS_BADGE[inc.status] || 'bg-slate-100 text-slate-600'}`}
                      value={inc.status}
                      disabled={updatingId === inc.incident_id}
                      onChange={(e) => changeStatus(inc, e.target.value)}
                    >
                      {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {inc.status === 'resolved' && inc.resolver ? (
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-700">{inc.resolver.full_name || inc.resolver.username}</span>
                        {inc.resolved_at && <span className="block text-[10px] text-slate-400">{new Date(inc.resolved_at).toLocaleString('vi-VN')}</span>}
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>{total > 0 ? `Trang ${page}/${pages} · ${total} sự cố` : 'Không có sự cố'}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => load(page - 1)} disabled={loading || page <= 1}>← Trước</Button>
          <Button variant="secondary" size="sm" onClick={() => load(page + 1)} disabled={loading || page >= pages}>Sau →</Button>
        </div>
      </div>

      {/* Bằng chứng ảnh của lượt gửi bị khiếu nại */}
      <Modal
        open={Boolean(photoModal)}
        size="lg"
        title={
          photoModal
            ? `Ảnh hiện trạng — ${photoModal.incident.session?.plate_number || 'lượt gửi'} (phiếu #${photoModal.incident.incident_id})`
            : ''
        }
        onClose={() => setPhotoModal(null)}
      >
        {photoLoading || !photoModal?.data ? (
          <p className="py-8 text-center text-sm text-slate-400">Đang tải ảnh…</p>
        ) : (
          <>
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Nhân viên báo: <span className="italic">{photoModal.incident.description}</span>
            </p>
            <PhotoCompare sessionId={photoModal.data.sessionId} data={photoModal.data} />
          </>
        )}
      </Modal>

      {/* Đóng phiếu — bắt buộc ghi kết luận */}
      <Modal
        open={Boolean(previewIncidentPhoto) || incidentPhotoLoading}
        size="md"
        title={previewIncidentPhoto ? `Ảnh sự cố (phiếu #${previewIncidentPhoto.incident.incident_id})` : 'Ảnh sự cố'}
        onClose={() => {
          if (previewIncidentPhoto?.urls) {
            previewIncidentPhoto.urls.forEach(url => URL.revokeObjectURL(url));
          }
          setPreviewIncidentPhoto(null);
        }}
      >
        {incidentPhotoLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Đang tải ảnh…</p>
        ) : previewIncidentPhoto ? (
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-full flex items-center justify-center min-h-[300px]">
              {previewIncidentPhoto.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute left-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() => setPreviewIncidentPhoto(prev => ({
                    ...prev,
                    currentIndex: (prev.currentIndex - 1 + prev.urls.length) % prev.urls.length
                  }))}
                >
                  &larr;
                </button>
              )}
              <img
                src={previewIncidentPhoto.urls[previewIncidentPhoto.currentIndex]}
                alt="Ảnh sự cố"
                className="max-h-[500px] w-full rounded-lg object-contain border border-slate-100"
              />
              {previewIncidentPhoto.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute right-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() => setPreviewIncidentPhoto(prev => ({
                    ...prev,
                    currentIndex: (prev.currentIndex + 1) % prev.urls.length
                  }))}
                >
                  &rarr;
                </button>
              )}
            </div>
            {previewIncidentPhoto.urls.length > 1 && (
              <p className="text-sm text-slate-500 font-semibold">
                Ảnh {previewIncidentPhoto.currentIndex + 1} / {previewIncidentPhoto.urls.length}
              </p>
            )}
            <p className="w-full rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Mô tả: <span className="font-medium">{previewIncidentPhoto.incident.description}</span>
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(resolveFor)}
        title={`Đóng phiếu #${resolveFor?.incident_id || ''}`}
        onClose={() => setResolveFor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveFor(null)} disabled={resolving}>
              Hủy
            </Button>
            <Button onClick={submitResolution} loading={resolving} disabled={!resolutionText.trim()}>
              Đóng phiếu
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Ghi rõ đã kết luận thế nào và căn cứ vào đâu. Đây là thứ dùng lại khi khách khiếu nại
          lần hai hoặc khi rà soát về sau.
        </p>
        <textarea
          className={`${inputClass} mt-3 min-h-24`}
          value={resolutionText}
          onChange={(e) => setResolutionText(e.target.value)}
          maxLength={500}
          placeholder="VD: Đối chiếu ảnh — lúc vào gương trái còn nguyên, lúc ra đã mất. Bãi chịu trách nhiệm, đã bồi thường 800.000đ."
        />
        <p className="mt-1 text-right text-xs text-slate-400">{resolutionText.length}/500</p>
      </Modal>
    </div>
  );
}
