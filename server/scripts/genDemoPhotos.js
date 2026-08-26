/**
 * Sinh 10 ảnh DEMO để nhập vào màn chụp ảnh hiện trạng (5 xe máy + 5 ô tô).
 *
 * Vì sao phải sinh chứ không lấy đại 5 tấm giống nhau: pipeline ảnh chặn trùng bằng dHash
 * (sessionPhoto.service.js — hammingDistance <= photo_similarity_threshold, mặc định 6).
 * Chọn cùng một ảnh cho 2 góc sẽ bị từ chối 409 PHOTO_TOO_SIMILAR. Nên mỗi góc phải có
 * BỐ CỤC SÁNG/TỐI khác hẳn nhau, không chỉ khác màu.
 *
 * Chạy:  node scripts/genDemoPhotos.js
 * Ra:    <repo>/demo-photos/*.jpg
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../../demo-photos');

const W = 1280;
const H = 960;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Mỗi góc một BỐ CỤC riêng. dHash so độ sáng giữa các ô cạnh nhau trên bản thu nhỏ,
 * nên phải đổi VỊ TRÍ mảng sáng/tối chứ không phải chỉ đổi màu.
 */
const LAYOUTS = {
  // Nửa trên tối, nửa dưới sáng
  front: (c) => `
    <rect width="${W}" height="${H * 0.45}" fill="#1b2430"/>
    <rect y="${H * 0.45}" width="${W}" height="${H * 0.55}" fill="${c}"/>
    <rect x="${W * 0.3}" y="${H * 0.52}" width="${W * 0.4}" height="${H * 0.16}" rx="16" fill="#f8fafc"/>`,
  // Sọc chéo
  left: (c) => `
    <rect width="${W}" height="${H}" fill="${c}"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${i * 240 - 200}" y="0" width="110" height="${H}" fill="#101820" transform="skewX(-18)"/>`).join('')}`,
  // Nửa trên sáng, nửa dưới tối (ngược với front)
  rear: (c) => `
    <rect width="${W}" height="${H * 0.55}" fill="${c}"/>
    <rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="#12181f"/>
    <rect x="${W * 0.34}" y="${H * 0.24}" width="${W * 0.32}" height="${H * 0.14}" rx="14" fill="#f8fafc"/>`,
  // Cột dọc
  right: (c) => `
    <rect width="${W}" height="${H}" fill="#0f1115"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${i * 320 + 40}" y="${60 + i * 90}" width="200" height="${H - 200}" fill="${c}"/>`).join('')}`,
  // Vòng tròn giữa nền chia đôi trái/phải
  driver: (c) => `
    <rect width="${W / 2}" height="${H}" fill="#0d1117"/>
    <rect x="${W / 2}" width="${W / 2}" height="${H}" fill="${c}"/>
    <circle cx="${W / 2}" cy="${H * 0.42}" r="${H * 0.24}" fill="#f1f5f9"/>
    <rect x="${W * 0.3}" y="${H * 0.7}" width="${W * 0.4}" height="${H * 0.22}" rx="40" fill="#f1f5f9"/>`,
};

const KIND_VN = {
  front: 'DAU XE',
  left: 'BEN TRAI',
  rear: 'DUOI XE',
  right: 'BEN PHAI',
  driver: 'NGUOI LAI',
};

const SETS = [
  { tag: 'xemay', label: 'XE MAY', plate: '59X1-234.56', color: '#2563eb' },
  { tag: 'oto', label: 'O TO', plate: '51F-678.90', color: '#c2410c' },
];

const buildSvg = ({ kind, label, plate, color }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${LAYOUTS[kind](color)}
  <rect x="0" y="${H - 150}" width="${W}" height="150" fill="#000" opacity="0.62"/>
  <text x="40" y="${H - 88}" font-family="DejaVu Sans, Arial, sans-serif" font-size="54"
        font-weight="bold" fill="#ffffff">${esc(label)} — ${esc(KIND_VN[kind])}</text>
  <text x="40" y="${H - 34}" font-family="DejaVu Sans, Arial, sans-serif" font-size="40"
        fill="#e2e8f0">${esc(plate)} · ANH DEMO</text>
</svg>`;

const run = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const made = [];

  for (const set of SETS) {
    for (const kind of Object.keys(LAYOUTS)) {
      const svg = buildSvg({ kind, label: set.label, plate: set.plate, color: set.color });
      const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
      const name = `${set.tag}-${kind}.jpg`;
      await writeFile(path.join(OUT_DIR, name), buf);
      made.push({ name, kb: Math.round(buf.length / 1024) });
    }
  }

  console.log(`\nDa tao ${made.length} anh tai: ${OUT_DIR}\n`);
  for (const m of made) console.log(`  ${m.name.padEnd(24)} ${m.kb} KB`);

  // Tu kiem: 5 anh trong CUNG mot bo phai cach nhau > nguong 6, khong thi luc upload bi 409.
  const { perceptualHash, hammingDistance } = await import('../src/utils/photoPipeline.js');
  console.log('\nKiem khoang cach dHash trong tung bo (phai > 6):');
  for (const set of SETS) {
    const kinds = Object.keys(LAYOUTS);
    const hashes = {};
    for (const k of kinds) {
      const { readFile } = await import('node:fs/promises');
      hashes[k] = await perceptualHash(await readFile(path.join(OUT_DIR, `${set.tag}-${k}.jpg`)));
    }
    let min = 999;
    let worst = '';
    for (let i = 0; i < kinds.length; i += 1) {
      for (let j = i + 1; j < kinds.length; j += 1) {
        const d = hammingDistance(hashes[kinds[i]], hashes[kinds[j]]);
        if (d < min) { min = d; worst = `${kinds[i]} vs ${kinds[j]}`; }
      }
    }
    console.log(`  ${set.label.padEnd(8)} khoang cach nho nhat = ${min}  (${worst})  ${min > 6 ? 'OK' : 'QUA GIONG!'}`);
  }
  console.log('');
};

run().catch((e) => { console.error(e); process.exit(1); });
