import React, { useState, useEffect } from "react";
import { getDashboardData } from "../../api/admin";
import {
  Users,
  AlertTriangle,
  BadgeDollarSign,
  RefreshCcw,
  Wallet,
  TrendingUp,
  CreditCard,
  Calendar,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const TYPE_COLORS = ["#3B82F6", "#10B981", "#8B5CF6"];
const METHOD_COLORS = ["#10B981", "#6366F1"];

const fmtMoney = (v) => `${Number(v || 0).toLocaleString("vi-VN")} ₫`;

const AdminDashboardPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Khởi tạo ngày mặc định (14 ngày qua)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  });

  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });

  // Tính toán khoảng ngày hiện tại để set UI Active cho nút (UX Improvement)
  const getActiveRange = () => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.round(
      Math.abs((end - start) / (1000 * 60 * 60 * 24)),
    );
    return diffDays;
  };
  const activeRange = getActiveRange();

  // Gọi API lấy dữ liệu
  const fetchData = async (start = startDate, end = endDate) => {
    setLoading(true);
    try {
      const res = await getDashboardData({ startDate: start, endDate: end });
      if (res.success) {
        setData(res.data);
      }
    } catch (error) {
      console.error("Lỗi tải dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  // Xử lý chọn ngày nhanh
  const setQuickRange = (days) => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const endStr = to.toISOString().split("T")[0];
    const startStr = from.toISOString().split("T")[0];

    setEndDate(endStr);
    setStartDate(startStr);
    fetchData(startStr, endStr);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50/50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
          <p className="text-sm font-medium text-slate-500">
            Đang tải dữ liệu điều hành...
          </p>
        </div>
      </div>
    );
  }

  if (!data && !loading) {
    return (
      <div className="p-6 text-red-500 bg-slate-50/50 min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto" />
          <p className="text-lg font-semibold text-slate-800">
            Không thể tải dữ liệu Dashboard.
          </p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 bg-brand text-white rounded-lg shadow-md hover:bg-brand/90 transition"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const dailyData =
    data?.charts?.revenueByDay?.map((item) => ({
      date: item.date
        ? new Date(item.date).toLocaleDateString("vi-VN", {
            day: "numeric",
            month: "short",
          })
        : "",
      revenue: Number(item.amount || 0),
    })) || [];

  const totalTypeRevenue =
    data?.charts?.revenueByType?.reduce((acc, c) => acc + c.value, 0) || 0;
  const totalMethodRevenue =
    data?.charts?.revenueByMethod?.reduce((acc, c) => acc + c.value, 0) || 0;

  return (
    <div className="p-6 space-y-6 bg-slate-50/50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Trung tâm Giám sát & Điều hành Hệ thống
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Phân tích tài chính, hiệu suất doanh thu và quản trị lỗi thời gian
            thực
          </p>
        </div>
        <button
          onClick={() => fetchData()}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition"
        >
          <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
          Làm mới dữ liệu
        </button>
      </div>

      {/* VÙNG LỌC THỜI GIAN UX/UI MỚI */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-500">
            Từ ngày
          </label>
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-500">
            Đến ngày
          </label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
        </div>

        <button
          onClick={() => fetchData(startDate, endDate)}
          className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white shadow hover:bg-blue-600 transition-colors"
        >
          Áp dụng
        </button>

        <div className="ml-auto flex items-center gap-2 bg-slate-50 p-1 rounded-full border border-slate-200">
          <button
            onClick={() => setQuickRange(7)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeRange === 7
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            7 ngày
          </button>
          <button
            onClick={() => setQuickRange(30)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeRange === 30
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            30 ngày
          </button>
          <button
            onClick={() => setQuickRange(90)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeRange === 90
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            90 ngày
          </button>
        </div>
      </div>

      {/* Quick Stats (4 cards) */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Doanh thu tổng */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">
              Doanh thu tổng cộng
            </p>
            <div className="rounded-xl bg-emerald-100/80 p-2 text-emerald-600">
              <Wallet size={20} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold tracking-tight text-slate-800">
              {fmtMoney(data.quickStats.totalRevenue)}
            </h3>
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <TrendingUp size={14} /> Tất cả phương thức
            </p>
          </div>
        </div>

        {/* Số tiền đã hoàn trả */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/40 via-white to-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">
              Số tiền đã hoàn trả
            </p>
            <div className="rounded-xl bg-blue-100/80 p-2 text-blue-600">
              <BadgeDollarSign size={20} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold tracking-tight text-slate-800">
              {fmtMoney(data.quickStats.totalRefunded)}
            </h3>
            <p className="mt-1 text-xs text-slate-500 font-medium">
              Đã phê duyệt hoàn tiền
            </p>
          </div>
        </div>

        {/* Sự cố chờ xử lý */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/40 via-white to-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">
              Sự cố chờ xử lý
            </p>
            <div className="rounded-xl bg-amber-100/80 p-2 text-amber-600">
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold tracking-tight text-slate-800">
              {data.quickStats.pendingIncidents}
            </h3>
            <p className="mt-1 text-xs text-amber-600 font-medium">
              Cần xử lý gấp ở các quầy
            </p>
          </div>
        </div>

        {/* Hoàn tiền chờ duyệt */}
        <div className="relative overflow-hidden rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50/40 via-white to-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">
              Yêu cầu hoàn tiền
            </p>
            <div className="rounded-xl bg-purple-100/80 p-2 text-purple-600">
              <BadgeDollarSign size={20} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold tracking-tight text-slate-800">
              {data.quickStats.pendingRefunds}
            </h3>
            <p className="mt-1 text-xs text-purple-600 font-medium">
              Đang đợi phê duyệt từ admin
            </p>
          </div>
        </div>
      </div>

      {/* Row 1: AreaChart Doanh thu theo thời gian */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Calendar size={18} className="text-blue-500" /> Biểu đồ doanh thu
          </h2>
          <p className="text-xs text-slate-400">
            Xem tiến trình phát triển và biến động doanh số trong khoảng thời
            gian đã chọn
          </p>
        </div>
        <div className="h-[320px]">
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={dailyData}
                margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f1f5f9"
                />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `${val / 1000}k`}
                />
                <Tooltip
                  formatter={(value) => [fmtMoney(value), "Doanh thu"]}
                  contentStyle={{
                    backgroundColor: "#e3e6ec",
                    borderRadius: "12px",
                    color: "#fff",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#3c79c9"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorRevenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Không có dữ liệu doanh số
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Donut charts side-by-side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Doanh thu theo loại giao dịch */}
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp size={18} className="text-emerald-500" /> Theo loại
              giao dịch
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Phân bổ nguồn doanh thu giữa khách gửi vãng lai, đặt chỗ trước và
              vé tháng
            </p>
          </div>
          <div className="h-[280px] my-4">
            {totalTypeRevenue > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.revenueByType}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {data.charts.revenueByType.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={TYPE_COLORS[index % TYPE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Chưa phát sinh giao dịch
              </div>
            )}
          </div>
        </div>

        {/* Doanh thu theo phương thức thanh toán */}
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <CreditCard size={18} className="text-indigo-500" /> Theo phương
              thức thanh toán
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              So sánh khối lượng thanh toán trực tuyến qua cổng PayOS và thu
              tiền mặt trực tiếp
            </p>
          </div>
          <div className="h-[280px] my-4">
            {totalMethodRevenue > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.revenueByMethod}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {data.charts.revenueByMethod.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={METHOD_COLORS[index % METHOD_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Chưa phát sinh giao dịch
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboardPage;
