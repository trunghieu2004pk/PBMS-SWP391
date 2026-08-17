/**
 * Kiểm tra pipeline ảnh hiện trạng KHÔNG cần DB, không cần camera.
 * Chạy: npm run test:photo --prefix server
 *
 * Xác nhận 4 điều: watermark hiện đúng (kể cả tiếng Việt), thứ tự hash đúng,
 * hash phát hiện được ảnh bị sửa, và ảnh mô phỏng có dấu cảnh báo.
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import {
  processAndStorePhoto,
  verifyStoredPhoto,
  absolutePathOf,
  sha256,
} from '../src/utils/photoPipeline.js';

const makeFakePhoto = (label, bg) =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: bg } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1600" height="1200"><text x="60" y="620" font-size="90"
             font-family="Arial" fill="white">${label}</text></svg>`,
        ),
        gravity: 'northwest',
      },
    ])
    .jpeg()
    .toBuffer();

const run = async () => {
  console.log('--- 1. Xử lý 1 ảnh mô phỏng ---');
  const raw = await makeFakePhoto('ANH XE - GOC TRAI', '#6b7280');
  const result = await processAndStorePhoto({
    buffer: raw,
    sessionId: 9999,
    phase: 'entry',
    kind: 'left',
    plateNumber: '51F-12345',
    gateLabel: 'Cổng B1-IN',
    simulated: true,
  });
  console.log(result);
  console.log('File:', absolutePathOf(result.filePath));

  console.log('\n--- 2. Thứ tự hash ---');
  console.log('sha256_raw    =', result.sha256Raw.slice(0, 16), '(hash ảnh GỐC)');
  console.log('sha256_stored =', result.sha256Stored.slice(0, 16), '(hash ảnh ĐÃ đóng dấu)');
  console.log('Khác nhau?', result.sha256Raw !== result.sha256Stored ? 'ĐÚNG' : 'SAI — pipeline hỏng');

  console.log('\n--- 3. Cùng ảnh gốc, 2 phiên khác nhau ---');
  const other = await processAndStorePhoto({
    buffer: raw,
    sessionId: 8888,
    phase: 'entry',
    kind: 'left',
    plateNumber: '30A-99999',
    gateLabel: 'Cổng B1-IN',
    simulated: true,
  });
  console.log('sha256_raw giống nhau?', result.sha256Raw === other.sha256Raw ? 'ĐÚNG (bắt được dùng lại ảnh)' : 'SAI');
  console.log(
    'sha256_stored khác nhau?',
    result.sha256Stored !== other.sha256Stored ? 'ĐÚNG (watermark riêng từng phiên)' : 'SAI',
  );

  console.log('\n--- 4. Phát hiện ảnh bị sửa ---');
  // Phá bản của phiên 8888 để giữ nguyên bản 9999 làm ảnh mẫu xem watermark.
  console.log('Hash khớp file trên đĩa:', await verifyStoredPhoto(other.filePath, other.sha256Stored));
  await writeFile(absolutePathOf(other.filePath), Buffer.from('da bi sua'));
  console.log('Sau khi ghi đè file  :', await verifyStoredPhoto(other.filePath, other.sha256Stored));

  console.log('\n--- 5. Ảnh camera thật (không có dấu DEMO) ---');
  const real = await processAndStorePhoto({
    buffer: await makeFakePhoto('ANH NGUOI LAI', '#334155'),
    sessionId: 9999,
    phase: 'entry',
    kind: 'driver',
    plateNumber: '51F-12345',
    gateLabel: 'Cổng B1-IN',
    simulated: false,
  });
  console.log('File:', absolutePathOf(real.filePath));
  console.log('\nMở 2 file trên bằng trình xem ảnh để kiểm tra watermark hiển thị đúng.');
};

run().catch((err) => {
  console.error('LỖI:', err);
  process.exit(1);
});
