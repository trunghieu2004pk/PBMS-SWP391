import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import ManagerLayout from './layouts/ManagerLayout';
import AdminLayout from './layouts/AdminLayout';
import StaffLayout from './layouts/StaffLayout';
import GuestLayout from './layouts/GuestLayout';
import UserLayout from './layouts/UserLayout';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import AuditLogsPage from './pages/admin/AuditLogsPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import IncidentsPage from './pages/admin/IncidentsPage';
import RefundsPage from './pages/admin/RefundsPage';
import FloorsPage from './pages/manager/FloorsPage';
import VehicleTypesPage from './pages/manager/VehicleTypesPage';
import PricingRulesPage from './pages/manager/PricingRulesPage';
import ZonesPage from './pages/manager/ZonesPage';
import ParkingSlotsPage from './pages/manager/ParkingSlotsPage';
import GatesPage from './pages/manager/GatesPage';
import SettingsPage from './pages/manager/SettingsPage';
import ReportsPage from './pages/manager/ReportsPage';
import StaffOperationsPage from './pages/staff/StaffOperationsPage';
import PricingPage from './pages/guest/PricingPage';
import AvailabilityPage from './pages/guest/AvailabilityPage';
import InfoPage from './pages/guest/InfoPage';
import MyReservationsPage from './pages/user/MyReservationsPage';
import MyParkingPage from './pages/user/MyParkingPage';
import ReservePage from './pages/user/ReservePage';
import GateKioskPage from './pages/kiosk/GateKioskPage';
import PaymentSuccessPage from './pages/user/PaymentSuccessPage';
import PaymentFailedPage from './pages/user/PaymentFailedPage';
import MyMonthlyPassesPage from './pages/user/MyMonthlyPassesPage';
import BuyMonthlyPassPage from './pages/user/BuyMonthlyPassPage';
import PassPaymentSuccessPage from './pages/user/PassPaymentSuccessPage';
import PassPaymentFailedPage from './pages/user/PassPaymentFailedPage';
import ProfilePage from './pages/user/ProfilePage';
import CustomerFeedbackPage from './pages/user/CustomerFeedbackPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<HomePage />} />
          </Route>

          {/* Khu công khai (Guest) */}
          <Route element={<GuestLayout />}>
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route path="/info" element={<InfoPage />} />
          </Route>

          {/* Kiosk cổng tự phục vụ */}
          <Route path="/kiosk/gate" element={<GateKioskPage />} />

          {/* Trang công khai */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Cần đăng nhập */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>

          {/* Khu vực Quản trị — AdminLayout */}
          <Route element={<ProtectedRoute allowedRoles={["Admin"]} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<UserManagementPage />} />
              <Route path="audit-logs" element={<AuditLogsPage />} />
              {/* Đã chuyển Quản lý sự cố lại cho Admin */}
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="refunds" element={<RefundsPage />} />
            </Route>
          </Route>

          {/* Khu vực Quản lý — ManagerLayout */}
          <Route element={<ProtectedRoute allowedRoles={["Manager"]} />}>
            <Route path="/manager" element={<ManagerLayout />}>
              <Route index element={<Navigate to="floors" replace />} />
              <Route path="floors" element={<FloorsPage />} />
              <Route path="vehicle-types" element={<VehicleTypesPage />} />
              <Route path="pricing-rules" element={<PricingRulesPage />} />
              <Route path="zones" element={<ZonesPage />} />
              <Route path="parking-slots" element={<ParkingSlotsPage />} />
              <Route path="gates" element={<GatesPage />} />
              <Route path="incident-reports" element={<IncidentsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          {/* Khu vực Nhân viên — StaffLayout */}
          <Route element={<ProtectedRoute allowedRoles={["Staff"]} />}>
            <Route path="/staff" element={<StaffLayout />}>
              <Route index element={<StaffOperationsPage />} />
            </Route>
          </Route>

          {/* Khu vực Khách hàng — UserLayout */}
          <Route element={<ProtectedRoute allowedRoles={["User"]} />}>
            <Route path="/reservations" element={<UserLayout />}>
              <Route index element={<MyReservationsPage />} />
              <Route path="new" element={<ReservePage />} />
              <Route path="payment/success" element={<PaymentSuccessPage />} />
              <Route path="payment/failed" element={<PaymentFailedPage />} />
            </Route>
            <Route path="/monthly-pass" element={<UserLayout />}>
              <Route index element={<MyMonthlyPassesPage />} />
              <Route path="new" element={<BuyMonthlyPassPage />} />
              <Route
                path="payment/success"
                element={<PassPaymentSuccessPage />}
              />
              <Route
                path="payment/failed"
                element={<PassPaymentFailedPage />}
              />
            </Route>
            <Route path="/parking" element={<UserLayout />}>
              <Route index element={<MyParkingPage />} />
            </Route>
            {/* Phản hồi & Khiếu nại sự cố (Hư hại xe, mất thẻ, thắc mắc cước phí...) */}
            <Route path="/feedback" element={<UserLayout />}>
              <Route index element={<CustomerFeedbackPage />} />
            </Route>
            {/* Hồ sơ cá nhân — cập nhật STK nhận hoàn tiền (BE cố định link email nhắc về /profile) */}
            <Route path="/profile" element={<UserLayout />}>
              <Route index element={<ProfilePage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
