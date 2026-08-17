/* global process */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';

// Mặc định chạy HTTPS (cần cho camera/QR). Tắt bằng: npm run dev:http
const useHttps = process.env.VITE_HTTPS !== 'false';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [mkcert({ savePath: './.cert' })] : []),
  ],
  server: {
    port: 5173,
    // Cổng phải cố định: CLIENT_URL/PAYOS_RETURN_URL trong server/.env trỏ đúng 5173.
    // Nếu cổng bận, báo lỗi ngay thay vì tự nhảy sang 5174/5175 — cổng lệch làm
    // payOS redirect về sai origin sau khi thanh toán (trang lỗi + mất token).
    strictPort: true,
    host: true,
    https: useHttps,
    // Gọi /api cùng origin -> tránh CORS, proxy sang backend Express.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
