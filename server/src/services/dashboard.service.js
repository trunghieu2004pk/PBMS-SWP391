import { Op } from "sequelize";
import {
  UserAccount,
  Incident,
  RefundRequest,
  ParkingSession,
  Payment,
} from "../models/index.js";

// Nhận thêm param startDate và endDate
export const getDashboardAnalytics = async ({ startDate, endDate } = {}) => {
  // 1. Xử lý khoảng thời gian (Mặc định là 14 ngày qua nếu không truyền)
  const to = endDate ? new Date(`${endDate}T23:59:59.999Z`) : new Date();
  const from = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 1. Thống kê nhanh (Quick Cards)

  // Cập nhật Tổng tiền đã hoàn (lọc theo khoảng thời gian hoàn)
  const totalRefunded =
    (await RefundRequest.sum("amount", {
      where: {
        status: "refunded",
        updated_at: { [Op.between]: [from, to] }, // <-- THÊM BỘ LỌC NÀY
      },
    })) || 0;

  // Cập nhật Số sự cố chờ xử lý (lọc theo ngày tạo)
  const pendingIncidentsCount = await Incident.count({
    where: {
      status: { [Op.in]: ["open", "investigating"] },
      created_at: { [Op.between]: [from, to] }, // <-- THÊM BỘ LỌC NÀY
    },
  });

  // Cập nhật Số yêu cầu hoàn tiền đang chờ (lọc theo ngày yêu cầu)
  const pendingRefundsCount = await RefundRequest.count({
    where: {
      status: "pending",
      requested_at: { [Op.between]: [from, to] }, // <-- THÊM BỘ LỌC NÀY
    },
  });

  // Tính tổng doanh thu trong khoảng thời gian đã chọn (tất cả các phương thức)
  const totalRevenue =
    (await Payment.sum("amount", {
      where: {
        status: "success",
        paid_at: { [Op.between]: [from, to] }, // Áp dụng lọc thời gian
      },
    })) || 0;

  // Doanh thu theo loại giao dịch
  const sessionRevenue =
    (await Payment.sum("amount", {
      where: {
        status: "success",
        session_id: { [Op.ne]: null },
        paid_at: { [Op.between]: [from, to] },
      },
    })) || 0;

  const reservationRevenue =
    (await Payment.sum("amount", {
      where: {
        status: "success",
        reservation_id: { [Op.ne]: null },
        paid_at: { [Op.between]: [from, to] },
      },
    })) || 0;

  const passRevenue =
    (await Payment.sum("amount", {
      where: {
        status: "success",
        pass_id: { [Op.ne]: null },
        paid_at: { [Op.between]: [from, to] },
      },
    })) || 0;

  const revenueByType = [
    { name: "Lượt gửi vãng lai", value: Number(sessionRevenue) },
    { name: "Đặt chỗ trước", value: Number(reservationRevenue) },
    { name: "Vé tháng", value: Number(passRevenue) },
  ];

  // Doanh thu theo phương thức thanh toán
  const methodStats = await Payment.findAll({
    attributes: [
      "method",
      [
        Payment.sequelize.fn("SUM", Payment.sequelize.col("amount")),
        "total_amount",
      ],
    ],
    where: {
      status: "success",
      paid_at: { [Op.between]: [from, to] },
    },
    group: ["method"],
    raw: true,
  });

  const revenueByMethod = methodStats.map((item) => ({
    name:
      item.method === "cash"
        ? "Tiền mặt"
        : item.method === "payos"
          ? "PayOS (Online)"
          : item.method,
    value: Number(item.total_amount || 0),
  }));

  // SỬA Ở ĐÂY: Doanh thu theo ngày (Tất cả các phương thức)
  const dailyStats = await Payment.findAll({
    attributes: [
      [Payment.sequelize.fn("DATE", Payment.sequelize.col("paid_at")), "date"],
      [
        Payment.sequelize.fn("SUM", Payment.sequelize.col("amount")),
        "total_amount",
      ],
    ],
    where: {
      status: "success",
      // Đã XÓA dòng method: 'payos' để lấy cả tiền mặt
      paid_at: { [Op.between]: [from, to] },
    },
    group: [Payment.sequelize.fn("DATE", Payment.sequelize.col("paid_at"))],
    order: [
      [Payment.sequelize.fn("DATE", Payment.sequelize.col("paid_at")), "ASC"],
    ],
    raw: true,
  });

  const revenueByDay = dailyStats.map((item) => {
    let formattedDate = item.date;
    if (item.date instanceof Date) {
      formattedDate = item.date.toISOString().split("T")[0];
    }
    return {
      date: formattedDate,
      amount: Number(item.total_amount || 0),
    };
  });

  // System Health
  let dbStatus = "healthy";
  try {
    await Incident.sequelize.authenticate();
  } catch (error) {
    dbStatus = "down";
  }

  return {
    quickStats: {
      totalRefunded: Number(totalRefunded),
      pendingIncidents: pendingIncidentsCount,
      pendingRefunds: pendingRefundsCount,
      totalRevenue: Number(totalRevenue),
    },
    charts: {
      revenueByType,
      revenueByMethod,
      revenueByDay,
    },
    systemHealth: {
      database: dbStatus,
      uptime: process.uptime(),
    },
  };
};
