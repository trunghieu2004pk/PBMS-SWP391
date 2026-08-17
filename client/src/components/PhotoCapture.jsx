import { useRef, useState } from 'react';
import { Check, RotateCcw, X, AlertTriangle, Upload } from 'lucide-react';
import { sessionPhotosApi } from '../api/sessionPhotos';
import { kindLabel, PHOTO_KIND_HINTS, PHASE_LABEL, sortKinds } from '../lib/photoKinds';

// Ghi ảnh hiện trạng xe + người lái, ÉP ĐỦ từng góc theo thứ tự — không có nút bỏ qua.
// Nhân viên CHỌN TỆP ẢNH từ máy (bãi chụp bằng máy ảnh rời rồi nhập vào).
//
// Ảnh đi qua <canvas> trước khi gửi: tệp 8MB từ máy ảnh cũng được thu về ≤1280px nên không
// bao giờ chạm giới hạn 3MB của máy chủ, và mọi tệp đều thành JPEG cùng chuẩn.

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.8;

/** Vẽ ảnh lên canvas, co về cạnh dài <= MAX_EDGE. */
const drawToCanvas = (canvas, source, srcW, srcH) => {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
};

/**
 * Độ sáng trung bình (0..255) trên bản thu nhỏ. Ảnh quá tối/quá cháy là bằng chứng vô giá trị
 * lúc đối chất, nên cảnh báo ngay thay vì để phát hiện khi đã tranh chấp.
 */
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

export default function PhotoCapture({
  sessionId,
  plateNumber,
  phase = 'entry',
  requiredKinds = ['front', 'left', 'rear', 'right', 'driver'],
  onDone,
  onClose,
}) {
  const kinds = sortKinds(requiredKinds);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState([]); // các góc đã gửi xong
  const [preview, setPreview] = useState(null); // dataURL đang chờ xác nhận
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const canvasRef = useRef(null);
  const fileRef = useRef(null);

  const kind = kinds[index];
  const isLast = index >= kinds.length - 1;

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset để chọn lại đúng tệp đó vẫn kích hoạt onChange
    if (!file) return;
    setError('');
    setWarning('');

    if (!file.type.startsWith('image/')) {
      setError('Tệp đã chọn không phải ảnh. Chọn tệp JPG/PNG/WebP.');
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawToCanvas(canvas, img, img.naturalWidth, img.naturalHeight);
      const lum = averageLuminance(canvas);
      if (lum < 32) setWarning('Ảnh khá tối — nên chọn ảnh rõ hơn để đối chiếu về sau.');
      else if (lum > 242) setWarning('Ảnh bị cháy sáng — nên chọn ảnh rõ hơn.');
      setFileName(file.name);
      setPreview(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    } catch {
      setError('Không đọc được tệp ảnh này. Thử tệp khác.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Xác nhận: canvas -> blob -> gửi lên. Gửi xong mới sang góc kế tiếp.
  const confirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      );
      if (!blob) throw new Error('Không tạo được ảnh từ canvas');

      const { data } = await sessionPhotosApi.upload(sessionId, { blob, phase, kind });

      setDone((prev) => [...new Set([...prev, kind])]);
      setPreview(null);
      setWarning('');
      setFileName('');

      if (isLast) onDone?.(data.data?.progress || null);
      else setIndex((i) => i + 1);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Gửi ảnh thất bại — thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const progressPct = Math.round((done.length / kinds.length) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Đầu: tiến độ + đóng */}
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">
                Ảnh hiện trạng {PHASE_LABEL[phase]}
                {plateNumber ? ` — ${plateNumber}` : ''}
              </h3>
              <p className="text-sm text-slate-500">
                Bước {index + 1}/{kinds.length}:{' '}
                <span className="font-medium text-slate-700">{kindLabel(kind)}</span>
                {' · '}
                {PHOTO_KIND_HINTS[kind]}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Đóng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {kinds.map((k, i) => (
              <span
                key={k}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  done.includes(k)
                    ? 'bg-emerald-100 text-emerald-700'
                    : i === index
                      ? 'bg-brand-light text-brand ring-1 ring-brand/40'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done.includes(k) && <Check className="h-3 w-3" />}
                {kindLabel(k)}
              </span>
            ))}
          </div>
        </div>

        {/* Giữa: khung chọn ảnh / xem trước */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-900 p-4">
          <div className="relative mx-auto flex aspect-4/3 w-full max-w-lg items-center justify-center overflow-hidden rounded-xl bg-black">
            {preview ? (
              <img
                src={preview}
                alt={`Xem trước ${kindLabel(kind)}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-full w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-600 text-slate-300 transition hover:border-brand hover:text-white"
              >
                <Upload className="h-10 w-10" />
                <span className="text-base font-medium">Chọn ảnh {kindLabel(kind)}</span>
                <span className="max-w-xs text-center text-xs text-slate-400">
                  {PHOTO_KIND_HINTS[kind]}
                </span>
              </button>
            )}
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />

          <p className="mx-auto mt-3 max-w-lg rounded-lg bg-sky-500/15 px-3 py-2 text-center text-xs text-sky-300">
            Hệ thống đóng dấu biển số, mã lượt gửi và thời điểm lên từng tấm ảnh.
            {fileName && <span className="mt-1 block text-sky-200">Tệp: {fileName}</span>}
          </p>

          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Cuối: thao tác */}
        <div className="shrink-0 border-t border-slate-200 px-5 py-4">
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {warning && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {warning}
            </p>
          )}

          {preview ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setWarning('');
                  setFileName('');
                }}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Chọn tệp khác
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="flex flex-2 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {busy
                  ? 'Đang lưu…'
                  : isLast
                    ? 'Lưu ảnh cuối & hoàn tất'
                    : `Dùng ảnh này → ${kindLabel(kinds[index + 1])}`}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Upload className="h-5 w-5" /> Chọn ảnh {kindLabel(kind)}
            </button>
          )}

          <p className="mt-2 text-center text-xs text-slate-400">
            Phải đủ {kinds.length} ảnh thì barie mới mở — không có bước bỏ qua.
          </p>
        </div>
      </div>
    </div>
  );
}
