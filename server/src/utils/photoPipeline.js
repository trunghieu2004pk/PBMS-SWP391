import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Gốc lưu ảnh: server/uploads (đã .gitignore). Mọi file_path trong DB là tương đối với gốc này. */
export const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

const MAX_EDGE = 1280; // đủ đọc biển số + thấy gương, mà file chỉ ~150KB
const JPEG_QUALITY = 72;

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * dHash 64-bit — "vân tay" NỘI DUNG NHÌN THẤY của ảnh, khác hẳn sha256 (vân tay byte).
 *
 * Vì sao cần: hai lần bấm chụp CÙNG một cảnh cho ra byte khác nhau (nhiễu cảm biến, nén
 * JPEG) nên sha256 không bao giờ trùng ⇒ staff chụp 4 lần cùng một chỗ vẫn lọt hết.
 * dHash thì gần như y nguyên khi cảnh giống nhau, nên bắt được trò đó.
 *
 * Cách làm: xám hóa → co về 9×8 → so mỗi điểm với điểm bên phải nó → 8×8 = 64 bit.
 * Chỉ nhìn xu hướng SÁNG/TỐI theo chiều ngang nên miễn nhiễm với đổi kích thước, đổi
 * độ nén, lệch sáng nhẹ — đúng thứ ta cần bỏ qua.
 */
export const perceptualHash = async (buffer) => {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const i = row * 9 + col;
      bits += data[i] < data[i + 1] ? '1' : '0';
    }
  }
  // 64 bit -> 16 ký tự hex, cắt từng 4 bit.
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
};

/**
 * Khoảng cách Hamming giữa 2 dHash (0..64). Càng nhỏ càng giống.
 * Kinh nghiệm: 0 = trùng khít, ≤ 6 = cùng một cảnh, ≥ 20 = hai cảnh khác hẳn.
 */
export const hammingDistance = (hexA, hexB) => {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 64;
  let dist = 0;
  for (let i = 0; i < hexA.length; i += 1) {
    let xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
};

/** XML escape — biển số/tên cổng do người nhập, không được phá cấu trúc SVG watermark. */
const xmlEscape = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const formatStamp = (date) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);

/**
 * Dải watermark burn-in ở đáy ảnh. Đây là thứ khiến ảnh KHÔNG THỂ TRÁO giữa các phiên:
 * mỗi tấm mang sẵn biển số + mã phiên + giờ + cổng, in ra giấy vẫn còn giá trị đối chất.
 * Ảnh mô phỏng có thêm dòng cảnh báo — không được bỏ, nếu không thì lẫn với ảnh thật.
 */
const buildWatermarkSvg = ({ width, line1, line2 }) => {
  // Chừa đủ chỗ cho dấu tiếng Việt (Ả, Ổ, Ỏ) — sát đáy quá là bị cắt mất dấu.
  const barHeight = line2 ? 72 : 42;
  const fontSize = Math.max(13, Math.round(width / 46));
  return Buffer.from(
    `<svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${barHeight}" fill="black" fill-opacity="0.55"/>
      <text x="12" y="${line2 ? 28 : 27}" font-family="Segoe UI, Arial, DejaVu Sans, sans-serif"
            font-size="${fontSize}" fill="white">${xmlEscape(line1)}</text>
      ${
        line2
          ? `<text x="12" y="58" font-family="Segoe UI, Arial, DejaVu Sans, sans-serif"
                   font-size="${fontSize}" fill="#ffd166" font-weight="bold">${xmlEscape(line2)}</text>`
          : ''
      }
    </svg>`,
  );
};

/** Đường dẫn tương đối của 1 ảnh: sessions/YYYY/MM/DD/<sessionId>/<phase>-<kind>.jpg */
export const buildRelativePath = ({ sessionId, phase, kind, at = new Date() }) => {
  const yyyy = String(at.getFullYear());
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  return path.posix.join(
    'sessions',
    yyyy,
    mm,
    dd,
    String(sessionId),
    `${phase}-${kind}.jpg`,
  );
};

export const absolutePathOf = (relativePath) => path.join(UPLOAD_ROOT, relativePath);

/**
 * Xử lý 1 ảnh upload → file JPEG đã đóng dấu trên đĩa.
 *
 * THỨ TỰ BẮT BUỘC (đảo là hỏng cả tính năng):
 *   1. hash buffer GỐC  → sha256_raw  (dùng bắt dùng lại ảnh cũ)
 *   2. resize + nén
 *   3. burn watermark
 *   4. ghi file
 *   5. hash file ĐÃ GHI → sha256_stored (dùng chứng minh chưa bị sửa)
 *
 * Vì watermark chứa mã phiên + giờ nên MỌI ảnh sau bước 3 đều khác nhau — hash ở bước 5
 * không bao giờ bắt được ảnh trùng. Phải giữ nguyên bước 1.
 */
// Dòng thứ 2 của watermark: ảnh do nhân viên nhập tệp, không phải máy tự chụp tại cổng.
// Đóng dấu để người xem về sau không nhầm đây là ảnh máy chụp tự động ngay lúc xe qua.
const SOURCE_STAMP = 'ẢNH NHẬP TỪ TỆP';

export const processAndStorePhoto = async ({
  buffer,
  sessionId,
  phase,
  kind,
  plateNumber,
  /**
   * Giờ đóng lên ảnh và dùng đặt thư mục. PHẢI là giờ MÁY CHỦ, không được lấy giờ máy trạm:
   * đồng hồ máy quầy do người dùng chỉnh được, mà dấu thời gian trên ảnh chính là bằng chứng.
   * Máy quầy đặt sai ngày thì ảnh sẽ mang mốc thời gian sai và nằm nhầm thư mục ngày.
   */
  stampedAt = new Date(),
}) => {
  const sha256Raw = sha256(buffer);

  const resized = sharp(buffer, { failOn: 'error' })
    .rotate() // tôn trọng EXIF orientation TRƯỚC khi strip, ảnh điện thoại hay bị xoay 90°
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  const { data: resizedBuffer, info } = await resized
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
    .toBuffer({ resolveWithObject: true });

  // Tính TRƯỚC khi đóng dấu: watermark là dải đen ở đáy, giống nhau ở mọi ảnh nên sẽ
  // kéo các hash xích lại gần nhau một cách giả tạo, làm mờ khác biệt thật giữa các góc.
  const pHash = await perceptualHash(resizedBuffer);

  const line1 = [
    plateNumber || 'KHONG-RO',
    `#${sessionId}`,
    formatStamp(stampedAt),
  ]
    .filter(Boolean)
    .join('  •  ');

  const watermark = buildWatermarkSvg({
    width: info.width,
    line1,
    line2: SOURCE_STAMP,
  });

  // sharp không nhận metadata (width/height) từ chính pipeline đang dở → dựng instance mới.
  const stamped = await sharp(resizedBuffer)
    .composite([{ input: watermark, gravity: 'south' }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const relativePath = buildRelativePath({ sessionId, phase, kind, at: stampedAt });
  const absolutePath = absolutePathOf(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, stamped);

  return {
    filePath: relativePath,
    sha256Raw,
    sha256Stored: sha256(stamped),
    pHash,
    mime: 'image/jpeg',
    bytes: stamped.length,
    width: info.width,
    height: info.height,
  };
};

/** Đối chiếu file trên đĩa với hash đã lưu — chứng minh ảnh chưa bị sửa sau khi lưu. */
export const verifyStoredPhoto = async (relativePath, expectedSha256) => {
  try {
    const buffer = await readFile(absolutePathOf(relativePath));
    return sha256(buffer) === expectedSha256;
  } catch {
    return false;
  }
};

/** Xóa file ảnh (chỉ job retention dùng — KHÔNG mở API xóa cho người dùng). */
export const removeStoredPhoto = async (relativePath) => {
  try {
    await unlink(absolutePathOf(relativePath));
    return true;
  } catch {
    return false;
  }
};
