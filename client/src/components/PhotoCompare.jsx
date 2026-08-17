import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, ImageOff } from 'lucide-react';
import { fetchPhotoBlobUrl } from '../api/sessionPhotos';
import { kindLabel, KIND_ORDER } from '../lib/photoKinds';

// Đối chiếu ảnh VÀO ↔ RA theo từng góc. Đây là màn giải quyết tranh chấp:
// staff nhìn 2 cột cạnh nhau, thấy ngay xe vào có gương mà ra mất gương hay không.

/**
 * Ảnh phải tải qua axios (route có Authorization) rồi hiển thị bằng blob URL —
 * gán thẳng vào <img src> sẽ bị 401 vì trình duyệt gọi trần không kèm token.
 */
function AuthPhoto({ sessionId, photo, onOpen, onIntegrity }) {
  const [state, setState] = useState({ url: null, intact: true, failed: false });

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    if (!photo) return undefined;
    (async () => {
      try {
        const { url, intact } = await fetchPhotoBlobUrl(sessionId, photo.photoId);
        objectUrl = url;
        if (alive) {
          setState({ url, intact, failed: false });
          // Cờ toàn vẹn chỉ có ở HEADER lúc tải file, không có trong API danh sách —
          // báo ngược lên cha để cha tổng hợp huy hiệu "có ảnh bị sửa".
          if (!intact) onIntegrity?.(photo.photoId);
        } else {
          URL.revokeObjectURL(url);
        }
      } catch {
        if (alive) setState({ url: null, intact: true, failed: true });
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl); // không revoke là rò bộ nhớ khi đổi phiên
    };
  }, [sessionId, photo, onIntegrity]);

  if (!photo) {
    return (
      <div className="flex aspect-4/3 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        <ImageOff className="mr-1.5 h-4 w-4" /> chưa có
      </div>
    );
  }
  if (state.failed) {
    return (
      <div className="flex aspect-4/3 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-xs text-red-500">
        lỗi tải ảnh
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => state.url && onOpen?.({ url: state.url, photo })}
      className="group relative block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900"
    >
      {state.url ? (
        <img
          src={state.url}
          alt={kindLabel(photo.kind)}
          className="aspect-4/3 w-full object-contain transition group-hover:opacity-90"
        />
      ) : (
        <div className="aspect-4/3 animate-pulse bg-slate-200" />
      )}
      {/* Ảnh do nhân viên nhập tệp, không phải máy tự chụp — người xử lý khiếu nại cần biết
          để cân nhắc giá trị đối chất. */}
      <span className="absolute left-1 top-1 rounded bg-sky-400/90 px-1.5 py-0.5 text-[10px] font-bold text-sky-950">
        NHẬP TỆP
      </span>
      {/* Đúng tệp ảnh này còn được nhập cho lượt gửi khác — dấu hiệu bộ ảnh không đáng tin.
          Hệ thống KHÔNG chặn, chỉ báo để người xử lý cân nhắc. */}
      {photo.reusedInSessions?.length > 0 && (
        <span
          className="absolute bottom-1 left-1 right-1 rounded bg-red-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white"
          title={`Cùng tệp ảnh này đã dùng cho lượt gửi: #${photo.reusedInSessions.join(', #')}`}
        >
          ⚠ DÙNG LẠI Ở {photo.reusedInSessions.length} LƯỢT KHÁC
        </span>
      )}
      {!state.intact && (
        <span className="absolute right-1 top-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
          ĐÃ BỊ SỬA
        </span>
      )}
    </button>
  );
}

export default function PhotoCompare({ sessionId, data, onOpenIncident }) {
  const [lightbox, setLightbox] = useState(null);
  const [tampered, setTampered] = useState([]);
  const markTampered = useCallback(
    (photoId) => setTampered((prev) => (prev.includes(photoId) ? prev : [...prev, photoId])),
    [],
  );

  if (!data) return null;

  const byKind = (list, kind) => list.find((p) => p.kind === kind) || null;
  const kinds = data.entryProgress?.required?.length
    ? [...data.entryProgress.required].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
    : KIND_ORDER;

  const anyTampered = tampered.length > 0;
  // Số tấm bị dùng lại ở lượt gửi khác — gom lên đầu bảng để người xử lý thấy ngay,
  // khỏi phải soi từng ô ảnh.
  const reusedCount = [...data.entry, ...data.exit].filter(
    (p) => p.reusedInSessions?.length > 0,
  ).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">Đối chiếu hiện trạng xe</h3>
          <p className="text-xs text-slate-500">
            So từng góc giữa lúc vào và lúc ra trước khi mở barie.
          </p>
        </div>
        {anyTampered ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
            <ShieldAlert className="h-3.5 w-3.5" /> Có ảnh bị sửa
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Ảnh toàn vẹn
          </span>
        )}
      </div>

      {reusedCount > 0 && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          ⚠ {reusedCount} tấm trong bộ ảnh này còn được nhập cho lượt gửi khác. Ảnh dùng lại
          không phản ánh hiện trạng thật của xe — cân nhắc kỹ trước khi kết luận.
        </p>
      )}

      <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-sm">
        <div />
        <div className="rounded-md bg-slate-100 py-1 text-center text-xs font-semibold text-slate-600">
          LÚC VÀO ({data.entryProgress?.captured || 0}/{data.entryProgress?.total || 0})
        </div>
        <div className="rounded-md bg-slate-100 py-1 text-center text-xs font-semibold text-slate-600">
          LÚC RA ({data.exitProgress?.captured || 0}/{data.exitProgress?.total || 0})
        </div>

        {kinds.map((k) => (
          <FragmentRow
            key={k}
            kind={k}
            sessionId={sessionId}
            entry={byKind(data.entry, k)}
            exit={byKind(data.exit, k)}
            onOpen={setLightbox}
            onIntegrity={markTampered}
          />
        ))}
      </div>


      {onOpenIncident && (
        <button
          type="button"
          onClick={onOpenIncident}
          className="mt-4 w-full rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Có chênh lệch — tạo khiếu nại hư hại
        </button>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setLightbox(null)}
          role="presentation"
        >
          <div className="max-h-full max-w-4xl">
            <img src={lightbox.url} alt={kindLabel(lightbox.photo.kind)} className="max-h-[80vh] rounded-lg" />
            <p className="mt-2 text-center text-sm text-slate-300">
              {kindLabel(lightbox.photo.kind)} · {lightbox.photo.phase === 'entry' ? 'lúc vào' : 'lúc ra'} ·
              {' '}{new Date(lightbox.photo.capturedAt).toLocaleString('vi-VN')}
            </p>
            <p className="mt-1 text-center font-mono text-[10px] text-slate-500">
              sha256: {lightbox.photo.sha256Stored}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ kind, sessionId, entry, exit, onOpen, onIntegrity }) {
  return (
    <>
      <div className="flex items-center justify-end pr-1 text-xs font-medium text-slate-600">
        {kindLabel(kind)}
      </div>
      <AuthPhoto sessionId={sessionId} photo={entry} onOpen={onOpen} onIntegrity={onIntegrity} />
      <AuthPhoto sessionId={sessionId} photo={exit} onOpen={onOpen} onIntegrity={onIntegrity} />
    </>
  );
}
