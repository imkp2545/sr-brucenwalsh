const Order = require('../models/orderModel');
const User = require('../models/userModel');
const Product = require('../models/productModel');
const ReturnRequest = require('../models/returnModel');
const Refund = require('../models/refundModel');
const Shipment = require('../models/shipmentModel');
const Appointment = require('../models/appointmentModel');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const AppError = require('../utils/appError');
const { buildWorkspaceDashboard } = require('../services/dashboardWorkspaceService');

const indiaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const indiaDateKey = (date) => {
  const parts = Object.fromEntries(
    indiaDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const buildPeriodKeys = (start, end, granularity) => {
  const startDate = indiaDateKey(start);
  const endDate = indiaDateKey(end);

  if (granularity === 'monthly') {
    const keys = [];
    let [year, month] = startDate.slice(0, 7).split('-').map(Number);
    const endKey = endDate.slice(0, 7);
    while (`${year}-${String(month).padStart(2, '0')}` <= endKey) {
      keys.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month === 13) {
        year += 1;
        month = 1;
      }
    }
    return keys;
  }

  const keys = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 10) <= endDate) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
};

const rangeFromQuery = (query, defaultDays = 30) => {
  const end = query.to ? new Date(query.to) : new Date();
  const start = query.from ? new Date(query.from) : new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new AppError('Invalid analytics date range', 422, 'INVALID_DATE_RANGE');
  if (end - start > 366 * 24 * 60 * 60 * 1000) throw new AppError('Analytics date range cannot exceed 366 days', 422, 'DATE_RANGE_TOO_LARGE');
  return { start, end };
};

const getDashboard = asyncHandler(async (req, res) => {
  const { start, end } = rangeFromQuery(req.query);
  const dateMatch = { createdAt: { $gte: start, $lte: end } };
  const [orderSummary, refunded, customerSummary, inventorySummary, returnSummary, shipmentSummary, appointmentSummary] = await Promise.all([
    Order.aggregate([
      { $match: { ...dateMatch, orderStatus: { $ne: 'cancelled' }, paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } } },
      { $group: { _id: null, orders: { $sum: 1 }, grossRevenue: { $sum: '$grandTotal' }, averageOrderValue: { $avg: '$grandTotal' }, itemsSold: { $sum: { $sum: '$items.quantity' } } } },
    ]),
    Refund.aggregate([{ $match: { ...dateMatch, status: 'succeeded' } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { ...dateMatch, status: { $ne: 'deleted' } } }, { $group: { _id: null, newCustomers: { $sum: 1 }, verifiedCustomers: { $sum: { $cond: ['$isEmailVerified', 1, 0] } } } }]),
    Product.aggregate([
      { $match: { status: 'active', deletedAt: null } },
      { $group: {
        _id: null, activeProducts: { $sum: 1 }, inventoryUnits: { $sum: '$stock' },
        lowStockProducts: { $sum: { $cond: [{ $lte: ['$stock', '$lowStockThreshold'] }, 1, 0] } },
        outOfStockProducts: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
      } },
    ]),
    ReturnRequest.aggregate([{ $match: dateMatch }, { $group: { _id: '$status', count: { $sum: 1 }, approvedAmount: { $sum: '$totalApprovedAmount' } } }]),
    Shipment.aggregate([{ $match: dateMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Appointment.aggregate([{ $match: { scheduledStart: { $gte: start, $lte: end } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const orders = orderSummary[0] || { orders: 0, grossRevenue: 0, averageOrderValue: 0, itemsSold: 0 };
  const refunds = refunded[0] || { amount: 0, count: 0 };
  return ApiResponse.success(res, {
    data: {
      period: { start, end },
      sales: { ...orders, refunds: refunds.amount, refundCount: refunds.count, netRevenue: orders.grossRevenue - refunds.amount },
      customers: customerSummary[0] || { newCustomers: 0, verifiedCustomers: 0 },
      inventory: inventorySummary[0] || { activeProducts: 0, inventoryUnits: 0, lowStockProducts: 0, outOfStockProducts: 0 },
      returns: returnSummary,
      shipments: shipmentSummary,
      appointments: appointmentSummary,
    },
  });
});

const getRevenueAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = rangeFromQuery(req.query);
  const granularity = req.query.granularity === 'monthly' ? 'monthly' : req.query.granularity === 'hourly' ? 'hourly' : 'daily';
  const format = granularity === 'monthly' ? '%Y-%m' : granularity === 'hourly' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';
  const [revenue, refunds] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, orderStatus: { $ne: 'cancelled' }, paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } } },
      { $group: { _id: { $dateToString: { format, date: '$createdAt', timezone: 'Asia/Kolkata' } }, orders: { $sum: 1 }, revenue: { $sum: '$grandTotal' }, discount: { $sum: '$discount' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, tax: { $sum: '$tax' } } },
      { $sort: { _id: 1 } },
    ]),
    Refund.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, status: 'succeeded' } },
      { $group: { _id: { $dateToString: { format, date: '$createdAt', timezone: 'Asia/Kolkata' } }, refunds: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const refundsByPeriod = new Map(refunds.map((item) => [item._id, item]));
  const revenueByPeriod = new Map(revenue.map((item) => [item._id, item]));
  const completePeriods = granularity === 'hourly' ? [] : buildPeriodKeys(start, end, granularity);
  const periods = [...new Set([...completePeriods, ...revenueByPeriod.keys(), ...refundsByPeriod.keys()])].sort();
  const series = periods.map((period) => {
    const revenueItem = revenueByPeriod.get(period) || { _id: period, orders: 0, revenue: 0, discount: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    const refundAmount = refundsByPeriod.get(period)?.refunds || 0;
    return { ...revenueItem, refunds: refundAmount, netRevenue: revenueItem.revenue - refundAmount };
  });
  return ApiResponse.success(res, { data: { period: { start, end }, series } });
});

const getProductAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = rangeFromQuery(req.query);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const topProducts = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, orderStatus: { $ne: 'cancelled' }, paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', name: { $first: '$items.name' }, sku: { $first: '$items.sku' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' }, orders: { $addToSet: '$_id' } } },
    { $project: { name: 1, sku: 1, quantity: 1, revenue: 1, orderCount: { $size: '$orders' } } },
    { $sort: { revenue: -1, quantity: -1 } },
    { $limit: limit },
  ]);
  const categoryPerformance = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, orderStatus: { $ne: 'cancelled' }, paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } } },
    { $unwind: '$items' },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $group: { _id: '$product.category', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    { $project: { name: '$category.name', quantity: 1, revenue: 1 } },
    { $sort: { revenue: -1 } },
  ]);
  return ApiResponse.success(res, { data: { period: { start, end }, topProducts, categoryPerformance } });
});

const getWorkspaceDashboard = asyncHandler(async (req, res) => {
  const data = await buildWorkspaceDashboard({
    role: req.user.role,
    adminId: req.user.id,
    days: req.query.days,
  });
  return ApiResponse.success(res, { data });
});

module.exports = { getDashboard, getRevenueAnalytics, getProductAnalytics, getWorkspaceDashboard };
