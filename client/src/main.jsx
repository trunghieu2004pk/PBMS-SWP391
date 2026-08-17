import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google"; // Thêm dòng import này
import "./index.css";
import App from "./App.jsx";

// Lấy Client ID từ biến môi trường (khuyên dùng) hoặc điền chuỗi string trực tiếp vào đây
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_HERE";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* Bọc GoogleOAuthProvider ra ngoài cùng ứng dụng */}
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
);
