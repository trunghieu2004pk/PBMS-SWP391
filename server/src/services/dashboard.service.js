import { Op } from "sequelize";
import {
  UserAccount,
  Incident,
  RefundRequest,
  ParkingSession,
  Payment,
} from "../models/index.js";

export const getDashboardAnalytics = async () => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // 1. Thống kê nhanh (Quick Cards)
  const totalRefunded = await RefundRequest.sum('amount', {
    where: { status: 'refunded' }
  }) || 0;

  const pendingIncidentsCount = await Incident.count({
    where: { status: { [Op.in]: ["open", "investigating"] } },
  });

  const pendingRefundsCount = await RefundRequest.count({
    where: { status: "pending" },
  });

  const totalRevenue = await Payment.sum('amount', { where: { status: 'success', method: 'payos' } }) || 0;

  // 2. Doanh thu theo loại giao dịch
  const sessionRevenue = await Payment.sum('amount', {
    where: { status: 'success', session_id: { [Op.ne]: null } }
  }) || 0;

  const reservationRevenue = await Payment.sum('amount', {
    where: { status: 'success', reservation_id: { [Op.ne]: null } }
  }) || 0;

  const passRevenue = await Payment.sum('amount', {
    where: { status: 'success', pass_id: { [Op.ne]: null } }
  }) || 0;

  const revenueByType = [
    { name: 'Lượt gửi vãng lai', value: Number(sessionRevenue) },
    { name: 'Đặt chỗ trước', value: Number(reservationRevenue) },
    { name: 'Vé tháng', value: Number(passRevenue) },
  ];

  // 3. Doanh thu theo phương thức thanh toán
  const methodStats = await Payment.findAll({
    attributes: [
      'method',
      [Payment.sequelize.fn('SUM', Payment.sequelize.col('amount')), 'total_amount'],
    ],
    where: { status: 'success' },
    group: ['method'],
    raw: true,
  });

  const revenueByMethod = methodStats.map(item => ({
    name: item.method === 'cash' ? 'Tiền mặt' : item.method === 'payos' ? 'PayOS (Online)' : item.method,
    value: Number(item.total_amount || 0),
  }));

  // 4. Doanh thu theo ngày (14 ngày qua)
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const dailyStats = await Payment.findAll({
    attributes: [
      [Payment.sequelize.fn('DATE', Payment.sequelize.col('paid_at')), 'date'],
      [Payment.sequelize.fn('SUM', Payment.sequelize.col('amount')), 'total_amount'],
    ],
    where: {
      status: 'success',
      method: 'payos',
      paid_at: { [Op.gte]: fourteenDaysAgo },
    },
    group: [Payment.sequelize.fn('DATE', Payment.sequelize.col('paid_at'))],
    order: [[Payment.sequelize.fn('DATE', Payment.sequelize.col('paid_at')), 'ASC']],
    raw: true,
  });

  const revenueByDay = dailyStats.map(item => {
    let formattedDate = item.date;
    if (item.date instanceof Date) {
      formattedDate = item.date.toISOString().split('T')[0];
    }
    return {
      date: formattedDate,
      amount: Number(item.total_amount || 0),
    };
  });

  // 5. System Health (Sức khỏe hệ thống)
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
