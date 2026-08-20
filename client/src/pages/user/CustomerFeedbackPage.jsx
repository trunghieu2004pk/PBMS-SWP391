import { useEffect, useRef, useState, useCallback } from 'react';
import {
  MessageSquarePlus,
  Upload,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Car,
  Image as ImageIcon,
  Send,
  HelpCircle,
  ShieldAlert,
  SearchX,
  History,
  X,
} from 'lucide-react';
import { incidentsApi, fetchIncidentPhotoBlobUrl } from '../../api/incidents';
import { sessionsApi } from '../../api/sessions';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { ErrorAlert } from '../../components/ui/Field';
import { inputClass } from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { toast } from '../../components/ui/toast';

const MAX_BYTES = 3 * 1024 * 1024; // 3MB (đồng bộ theo backend photoUpload.js)
const MAX_EDGE = 1280; // Chuẩn nén từ staff-side PhotoCapture
const JPEG_QUALITY = 0.8;

const CATEGORIES = [
  { value: 'vehicle_damage', label: 'Hư hại xe (Vehicle Damage)', desc: 'Xước sơn, vỡ gương, va chạm trong lúc gửi xe' },
  { value: 'lost_card', label: 'Mất thẻ / Thất lạc vé QR', desc: 'Không tìm thấy thẻ hoặc mất mã QR gửi xe' },
  { value: 'wrong_fee', label: 'Thắc mắc cước phí', desc: 'Phí tính sai lệch hoặc cần giải đáp về giá' },
  { value: 'hard_to_find', label: 'Khó tìm vị trí xe', desc: 'Cần hỗ trợ định vị xe trong bãi' },
  { value: 'slot_taken', label: 'Chỗ đỗ đã có xe khác', desc: 'Chỗ đỗ được phân bổ đang bị xe khác chiếm' },
  { value: 'other', label: 'Ý kiến đóng góp khác', desc: 'Các ý kiến, góp ý dịch vụ khác' },
];

const STATUS_CONFIG = {
  open: { label: 'Mới gửi', badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20', icon: Clock },
  investigating: { label: 'Đang xử lý', badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20', icon: ShieldAlert },
  resolved: { label: 'Đã giải quyết', badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20', icon: CheckCircle2 },
};

/** Vẽ ảnh lên canvas thu nhỏ về <= MAX_EDGE */
const drawToCanvas = (canvas, source, srcW, srcH) => {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
};

/** Độ sáng trung bình (0..255) */
const averageLuminance = (canvas) => {
  const s = document.createElement('canvas');
  s.width = 48;
  s.height = 36;
  const ctx = s.getContext('2d');
  ctx.drawImage(canvas, 0, 0, s.width, s.height);
  const { data } = ctx.getImageData(0, 0, s.width, s.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
};

export default function CustomerFeedbackPage() {
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'history'
  const [category, setCategory] = useState('vehicle_damage');
  const [description, setDescription] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [activeSessions, setActiveSessions] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Ảnh đính kèm (hỗ trợ tối đa 5 ảnh)
  const [photos, setPhotos] = useState([]); // [{ id, blob, preview, name, warning }]
  const [photoError, setPhotoError] = useState('');

  // Lịch sử phản hồi
  const [myIncidents, setMyIncidents] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [previewPhotoModal, setPreviewPhotoModal] = useState(null); // { url, incident }

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Tải danh sách phiên đang hoạt động của người dùng
  useEffect(() => {
    sessionsApi.mineActive()
      .then(({ data }) => {
        setActiveSessions(data.data || []);
        if (data.data && data.data.length > 0) {
          setSessionId(String(data.data[0].session_id));
        }
      })
      .catch(() => {});
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data } = await incidentsApi.listMine({ limit: 50 });
      setMyIncidents(data.data?.items || []);
    } catch {
      toast.error('Không thể tải lịch sử phản hồi');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    setPhotoError('');

    if (photos.length + selectedFiles.length > 5) {
      setPhotoError('Chỉ được upload tối đa 5 ảnh.');
      return;
    }

    const processedPhotos = [];
    const canvas = canvasRef.current;
    if (!canvas) return;

    for (const file of selectedFiles) {
      if (!file.type.startsWith('image/')) {
        setPhotoError('Một trong các tệp đã chọn không phải ảnh. Vui lòng chọn tệp JPG, PNG hoặc WebP.');
        continue;
      }

      if (file.size > MAX_BYTES) {
        setPhotoError(`Ảnh "${file.name}" vượt quá giới hạn 3MB. Vui lòng chọn ảnh nhỏ hơn.`);
        continue;
      }

      const objectUrl = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = objectUrl;
        await img.decode();

        drawToCanvas(canvas, img, img.naturalWidth, img.naturalHeight);
        const lum = averageLuminance(canvas);
        let warning = '';
        if (lum < 32) warning = 'Ảnh hơi tối — nên chụp nơi đủ sáng để đối chiếu hư hại rõ hơn.';
        else if (lum > 242) warning = 'Ảnh bị lóa/cháy sáng — nên chọn ảnh rõ chi tiết hơn.';

        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
        );

        if (!blob) throw new Error('Không tạo được ảnh từ canvas');

        processedPhotos.push({
          id: Math.random().toString(36).substring(2, 9),
          blob,
          name: file.name,
          preview: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
          warning,
        });
      } catch (err) {
        setPhotoError(`Không thể xử lý tệp ảnh "${file.name}". Vui lòng thử tệp khác.`);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    if (processedPhotos.length > 0) {
      setPhotos((prev) => [...prev, ...processedPhotos]);
    }
  };

  const removePhoto = (id) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const clearPhotos = () => {
    setPhotos([]);
    setPhotoError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!description.trim() || description.trim().length < 5) {
      setFormError('Vui lòng nhập nội dung phản hồi ít nhất 5 ký tự.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('description', description.trim());
      if (sessionId) {
        formData.append('sessionId', sessionId);
      }
      if (photos && photos.length > 0) {
        photos.forEach((p) => {
          formData.append('photos', p.blob, p.name || 'feedback.jpg');
        });
      }

      await incidentsApi.submitFeedback(formData);
      toast.success('Gửi phản hồi thành công! Đội ngũ quản lý sẽ kiểm tra và xử lý sớm nhất.');

      // Reset form
      setDescription('');
      clearPhotos();
      setActiveTab('history');
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Không thể gửi phản hồi. Vui lòng thử lại sau.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const openPhotoModal = async (inc) => {
    try {
      const paths = inc.image_path ? inc.image_path.split(',') : [];
      const urls = await Promise.all(
        paths.map((_, index) => fetchIncidentPhotoBlobUrl(inc.incident_id, index))
      );
      setPreviewPhotoModal({ urls, incident: inc, currentIndex: 0 });
    } catch {
      toast.error('Không thể tải ảnh đính kèm của phản hồi này');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phản hồi & Khiếu nại"
        description="Gửi phản hồi về dịch vụ hoặc báo cáo sự cố hư hại xe để được hỗ trợ nhanh chóng"
        actions={
          <div className="flex gap-2">
            <Button
              variant={activeTab === 'new' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('new')}
            >
              <MessageSquarePlus className="h-4 w-4 mr-1.5" />
              Tạo phản hồi
            </Button>
            <Button
              variant={activeTab === 'history' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('history')}
            >
              <History className="h-4 w-4 mr-1.5" />
              Lịch sử ({myIncidents.length})
            </Button>
          </div>
        }
      />

      {activeTab === 'new' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Form chính */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <form onSubmit={handleSubmit} className="space-y-6 p-2">
                {formError && <ErrorAlert message={formError} />}

                {/* Danh mục */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">
                    Danh mục phản hồi <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {CATEGORIES.map((cat) => {
                      const isSelected = category === cat.value;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setCategory(cat.value)}
                          className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                            isSelected
                              ? 'border-brand bg-brand-light/30 ring-2 ring-brand/30'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                isSelected ? 'bg-brand' : 'bg-slate-300'
                              }`}
                            />
                            <span className="text-sm font-semibold text-slate-800">
                              {cat.label}
                            </span>
                          </div>
                          <span className="mt-1 text-xs text-slate-500 pl-4.5">
                            {cat.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Gắn xe / Phiên gửi (nếu có) */}
                {activeSessions.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                      Liên quan đến lượt gửi xe
                    </label>
                    <select
                      className={inputClass}
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                    >
                      <option value="">— Không gắn phiên cụ thể —</option>
                      {activeSessions.map((s) => (
                        <option key={s.session_id} value={s.session_id}>
                          {s.plate_number} (Phiên #{s.session_id} · Vào lúc{' '}
                          {new Date(s.time_in).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          )
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">
                      Gắn phiên gửi giúp ban quản trị tra cứu đối chiếu ảnh vào/ra bãi nhanh chóng.
                    </p>
                  </div>
                )}

                {/* 1. TEXT BOX: Ô nhập nội dung */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-semibold text-slate-800">
                      Nội dung phản hồi / mô tả chi tiết <span className="text-red-500">*</span>
                    </label>
                    <span className="text-xs text-slate-400">
                      {description.length}/1000 ký tự
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    className={`${inputClass} resize-y`}
                    placeholder={
                      category === 'vehicle_damage'
                        ? 'Mô tả chi tiết vị trí hư hại trên xe (vd: vết xước ở cửa trước bên lái, gương chiếu hậu bị nứt…), thời gian phát hiện…'
                        : 'Nhập nội dung chi tiết phản hồi hoặc khiếu nại của bạn…'
                    }
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    required
                  />
                </div>

                {/* 2. SECTION UPLOAD ẢNH ĐÍNH KÈM: Trực tiếp bên dưới text content */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Ảnh đính kèm minh chứng (Tối đa 5 ảnh, mỗi ảnh ≤ 3MB)
                  </label>

                  {photoError && (
                    <div className="mb-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-600 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {photoError}
                    </div>
                  )}

                  {/* Hiển thị danh sách các ảnh đã chọn */}
                  {photos.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      {photos.map((p, idx) => (
                        <div key={p.id} className="relative rounded-2xl border border-slate-200 bg-slate-900/5 p-3">
                          <div className="flex items-center gap-3">
                            <div className="relative aspect-4/3 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-900 shadow-sm flex items-center justify-center">
                              <img
                                src={p.preview}
                                alt={`Preview ${idx + 1}`}
                                className="h-full w-full object-contain"
                              />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-xs font-semibold text-slate-800 truncate" title={p.name}>
                                {p.name}
                              </p>
                              {p.warning ? (
                                <p className="text-[10px] text-amber-600 leading-tight">
                                  ⚠ {p.warning}
                                </p>
                              ) : (
                                <p className="text-[10px] text-emerald-600 leading-tight">
                                  ✓ Ảnh đạt chuẩn HD.
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => removePhoto(p.id)}
                                className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 transition-colors flex items-center gap-0.5 pt-0.5"
                              >
                                <X className="h-3 w-3" />
                                <span>Xóa ảnh</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {photos.length < 5 && (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center transition hover:border-brand hover:bg-brand-light/10"
                    >
                      <div className="rounded-full bg-white p-3 shadow-xs ring-1 ring-slate-900/5 group-hover:scale-105 transition-transform">
                        <Upload className="h-6 w-6 text-slate-400 group-hover:text-brand" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-700 group-hover:text-brand">
                        Nhấn để chọn ảnh hoặc kéo thả vào đây ({photos.length}/5)
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Hỗ trợ định dạng JPG, PNG, WebP (Dung lượng tối đa 3MB)
                      </p>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Nút gửi */}
                <div className="pt-2">
                  <Button
                    type="submit"
                    className="w-full py-2.5 text-base font-semibold"
                    loading={submitting}
                    disabled={submitting}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Gửi phản hồi / khiếu nại
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* Cột hướng dẫn & Thông tin */}
          <div className="space-y-4">
            <Card>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-semibold">
                  <ShieldAlert className="h-5 w-5 text-brand" />
                  <h3>Quy trình xử lý hư hại xe</h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Khi nhận khiếu nại về <strong>Hư hại xe</strong>, ban quản lý sẽ lập tức đối chiếu:
                </p>
                <ul className="space-y-2 text-xs text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-brand-light p-0.5 text-brand">✓</span>
                    <span><strong>Bộ ảnh 5 góc</strong> (đầu xe, 2 bên sườn, đuôi xe, người lái) chụp lúc xe vào bãi.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-brand-light p-0.5 text-brand">✓</span>
                    <span><strong>Bộ ảnh lúc xe ra bãi</strong> và ảnh hiện trường do bạn cung cấp.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 rounded-full bg-brand-light p-0.5 text-brand">✓</span>
                    <span>Kết quả xử lý &amp; bồi thường (nếu có) sẽ được thông báo trực tiếp qua mục Lịch sử.</span>
                  </li>
                </ul>
              </div>
            </Card>

            <Card>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-800 font-semibold">
                  <HelpCircle className="h-5 w-5 text-slate-500" />
                  <h3>Lưu ý khi gửi ảnh</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  • Chụp rõ vị trí hư hại trong điều kiện đủ sáng.<br />
                  • Dung lượng tối đa: <strong>3MB</strong> / 1 ảnh.<br />
                  • Hệ thống tự động thu nhỏ và đóng dấu xác thực bảo mật.
                </p>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        /* TAB LỊCH SỬ PHẢN HỒI */
        <div className="space-y-4">
          {loadingHistory ? (
            <Card>
              <p className="py-10 text-center text-sm text-slate-400">Đang tải lịch sử phản hồi…</p>
            </Card>
          ) : myIncidents.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Chưa có phản hồi nào"
              description="Các phản hồi hoặc khiếu nại bạn đã gửi sẽ hiển thị tại đây để bạn tiện theo dõi tiến độ."
              action={
                <Button onClick={() => setActiveTab('new')}>
                  <MessageSquarePlus className="h-4 w-4 mr-1.5" />
                  Gửi phản hồi mới
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {myIncidents.map((inc) => {
                const statusMeta = STATUS_CONFIG[inc.status] || STATUS_CONFIG.open;
                const StatusIcon = statusMeta.icon;

                return (
                  <Card key={inc.incident_id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            Phiếu #{inc.incident_id}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {inc.categoryLabel || inc.typeLabel || 'Phản hồi'}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badge}`}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {inc.statusLabel || statusMeta.label}
                          </span>
                        </div>

                        <p className="text-sm text-slate-700 whitespace-pre-wrap">
                          {inc.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                          <span>
                            Gửi lúc: {inc.created_at ? new Date(inc.created_at).toLocaleString('vi-VN') : '—'}
                          </span>
                          {inc.session?.plate_number && (
                            <span className="flex items-center gap-1 font-mono text-slate-700">
                              <Car className="h-3.5 w-3.5 text-slate-400" />
                              Biển số: {inc.session.plate_number}
                            </span>
                          )}
                        </div>

                        {/* Kết luận xử lý của Admin / Manager */}
                        {inc.resolution && (
                          <div className="mt-3 rounded-xl bg-emerald-50/80 border border-emerald-100 p-3 text-xs text-emerald-900">
                            <p className="font-semibold flex items-center gap-1 text-emerald-800 mb-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              Kết luận từ Ban quản lý:
                            </p>
                            <p className="text-emerald-700 whitespace-pre-wrap">{inc.resolution}</p>
                            {inc.resolved_at && (
                              <p className="mt-1 text-[11px] text-emerald-600/80">
                                Đã xử lý vào {new Date(inc.resolved_at).toLocaleString('vi-VN')}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Nút xem ảnh nếu có đính kèm */}
                      {inc.image_path && (
                        <div className="shrink-0 pt-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openPhotoModal(inc)}
                          >
                            <ImageIcon className="h-3.5 w-3.5 mr-1" />
                            Xem ảnh đính kèm
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal xem ảnh đính kèm */}
      <Modal
        open={Boolean(previewPhotoModal)}
        size="lg"
        title={`Ảnh minh chứng — Phiếu #${previewPhotoModal?.incident?.incident_id || ''}`}
        onClose={() => {
          if (previewPhotoModal?.urls) {
            previewPhotoModal.urls.forEach(url => URL.revokeObjectURL(url));
          }
          setPreviewPhotoModal(null);
        }}
      >
        {previewPhotoModal?.urls && previewPhotoModal.urls.length > 0 && (
          <div className="space-y-3">
            <div className="relative w-full flex items-center justify-center min-h-[300px]">
              {previewPhotoModal.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute left-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() => setPreviewPhotoModal(prev => ({
                    ...prev,
                    currentIndex: (prev.currentIndex - 1 + prev.urls.length) % prev.urls.length
                  }))}
                >
                  &larr;
                </button>
              )}
              <div className="overflow-hidden rounded-xl bg-black flex items-center justify-center max-h-[70vh] w-full">
                <img
                  src={previewPhotoModal.urls[previewPhotoModal.currentIndex]}
                  alt="Ảnh phản hồi"
                  className="max-h-[68vh] w-auto object-contain"
                />
              </div>
              {previewPhotoModal.urls.length > 1 && (
                <button
                  type="button"
                  className="absolute right-2 z-10 p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors duration-200 focus:outline-none"
                  onClick={() => setPreviewPhotoModal(prev => ({
                    ...prev,
                    currentIndex: (prev.currentIndex + 1) % prev.urls.length
                  }))}
                >
                  &rarr;
                </button>
              )}
            </div>
            {previewPhotoModal.urls.length > 1 && (
              <p className="text-sm text-slate-500 font-semibold text-center">
                Ảnh {previewPhotoModal.currentIndex + 1} / {previewPhotoModal.urls.length}
              </p>
            )}
            <p className="text-xs text-slate-500 text-center">
              Mô tả: &ldquo;{previewPhotoModal.incident?.description}&rdquo;
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
