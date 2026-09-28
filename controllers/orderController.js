const mongoose = require('mongoose');
const Order = require('../models/orderModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { INVOICE_TEMPLATE_VERSION, generateInvoicePdf } = require('../utils/invoiceUtils');
const { notifyUser, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const { buildTaxBreakup } = require('../utils/calculationUtils');

const STATUS_TRANSITIONS = {
  pendingPayment: ['confirmed'],
  confirmed: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: ['returnRequested', 'closed'],
  returnRequested: ['returned'],
  returned: ['closed'],
  cancelled: [],
  closed: [],
};

const parsePagination = (query, defaultLimit = 20) => ({
  page: Math.max(1, Number(query.page) || 1),
  limit: Math.min(100, Math.max(1, Number(query.limit) || defaultLimit)),
});

const withTaxPresentation = (record) => {
  const order = typeof record?.toObject === 'function' ? record.toObject() : { ...record };
  const placeOfSupplyState = order.placeOfSupplyState || order.shippingAddress?.state;
  const supplierState = order.supplierState || process.env.INVOICE_STATE_NAME || 'Maharashtra';
  const taxBreakup = buildTaxBreakup({
    ...order,
    placeOfSupplyState,
    supplierState,
  });
  const items = (order.items || []).map((entry) => {
    const itemTaxBreakup = buildTaxBreakup({
      taxMode: taxBreakup.mode,
      placeOfSupplyState: taxBreakup.placeOfSupplyState,
      supplierState: taxBreakup.supplierState,
      tax: entry.taxAmount,
      cgst: entry.cgstAmount,
      sgst: entry.sgstAmount,
      igst: entry.igstAmount,
    });
    return {
      ...entry,
      cgstRate: itemTaxBreakup.cgst.rate,
      cgstAmount: itemTaxBreakup.cgst.amount,
      sgstRate: itemTaxBreakup.sgst.rate,
      sgstAmount: itemTaxBreakup.sgst.amount,
      igstRate: itemTaxBreakup.igst.rate,
      igstAmount: itemTaxBreakup.igst.amount,
      taxAmount: itemTaxBreakup.totalTax,
      taxBreakup: itemTaxBreakup,
    };
  });
  return {
    ...order,
    items,
    taxMode: taxBreakup.mode,
    placeOfSupplyState: taxBreakup.placeOfSupplyState,
    supplierState: taxBreakup.supplierState,
    cgst: taxBreakup.cgst.amount,
    sgst: taxBreakup.sgst.amount,
    igst: taxBreakup.igst.amount,
    tax: taxBreakup.totalTax,
    taxBreakup,
  };
};

const listMyOrders = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = { user: req.user.id };
  if (req.query.status) filter.orderStatus = req.query.status;
  const [orders, total] = await Promise.all([
    Order.find(filter).select('-internalNote -metadata').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return ApiResponse.success(res, {
    data: orders.map(withTaxPresentation),
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const getMyOrder = asyncHandler(async (req, res) => {
  const identity = mongoose.isValidObjectId(req.params.identifier)
    ? { _id: req.params.identifier }
    : { orderNumber: String(req.params.identifier).toUpperCase() };
  const order = await Order.findOne({ ...identity, user: req.user.id }).select('-internalNote -metadata').lean();
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return ApiResponse.success(res, { data: withTaxPresentation(order) });
});

const listOrdersAdmin = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query, 25);
  const baseFilter = {};
  if (req.query.user && mongoose.isValidObjectId(req.query.user)) baseFilter.user = req.query.user;
  if (req.query.from || req.query.to) {
    baseFilter.createdAt = {};
    if (req.query.from) baseFilter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) baseFilter.createdAt.$lte = new Date(req.query.to);
  }
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    baseFilter.$or = [
      { orderNumber: new RegExp(escaped, 'i') },
      { 'shippingAddress.recipientName': new RegExp(escaped, 'i') },
      { 'shippingAddress.phone': new RegExp(escaped, 'i') },
    ];
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'orderStatus', req.query.orderStatus);
  applyStatusFilter(filter, 'paymentStatus', req.query.paymentStatus);
  applyStatusFilter(filter, 'fulfillmentStatus', req.query.fulfillmentStatus);
  const [orders, total, summary] = await Promise.all([
    Order.find(filter).select('-internalNote -metadata').populate('user', 'firstName lastName email phone').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
    summarizeStatusFields(Order, baseFilter, ['orderStatus', 'paymentStatus']),
  ]);
  return ApiResponse.success(res, {
    data: orders.map(withTaxPresentation),
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getOrderAdmin = asyncHandler(async (req, res) => {
  const identity = mongoose.isValidObjectId(req.params.identifier)
    ? { _id: req.params.identifier }
    : { orderNumber: String(req.params.identifier).toUpperCase() };
  const order = await Order.findOne(identity).select('-internalNote -metadata').populate('user', 'firstName lastName email phone')
    .populate('coupon', 'code discountType discountValue');
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return ApiResponse.success(res, { data: withTaxPresentation(order) });
});

const invoiceIdentity = (identifier) => (mongoose.isValidObjectId(identifier)
  ? { _id: identifier }
  : { orderNumber: String(identifier).toUpperCase() });

const sendInvoicePdf = async (order, res) => {
  if (!order.invoiceNumber) throw new AppError('Invoice is not available for this order', 404, 'INVOICE_NOT_FOUND');
  let pdfBuffer;
  const storedTemplateVersion = order.metadata?.get
    ? order.metadata.get('invoiceTemplateVersion')
    : order.metadata?.invoiceTemplateVersion;
  if (order.invoiceUrl && storedTemplateVersion === INVOICE_TEMPLATE_VERSION) {
    try {
      const storedInvoice = await fetch(order.invoiceUrl, { signal: AbortSignal.timeout(15000) });
      if (storedInvoice.ok) {
        const storedBuffer = Buffer.from(await storedInvoice.arrayBuffer());
        if (storedBuffer.subarray(0, 5).toString('ascii') === '%PDF-') pdfBuffer = storedBuffer;
      }
    } catch (_error) {
      pdfBuffer = null;
    }
  }
  if (!pdfBuffer) pdfBuffer = await generateInvoicePdf(order);
  const filename = `${String(order.invoiceNumber).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'private, max-age=300',
  });
  return res.send(pdfBuffer);
};

const downloadOrderInvoiceAdmin = asyncHandler(async (req, res) => {
  const order = await Order.findOne(invoiceIdentity(req.params.identifier));
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return sendInvoicePdf(order, res);
});

const downloadMyOrderInvoice = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ ...invoiceIdentity(req.params.identifier), user: req.user.id });
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return sendInvoicePdf(order, res);
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  const order = await Order.findById(req.params.orderId);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (status === 'cancelled') {
    throw new AppError('Paid-order cancellation requires the refund workflow', 409, 'REFUND_REQUIRED');
  }
  if (['shipped', 'delivered'].includes(status)) {
    throw new AppError(
      'Shipment and delivery statuses are controlled by the carrier workflow',
      409,
      'SHIPMENT_WORKFLOW_REQUIRED',
    );
  }
  if (!STATUS_TRANSITIONS[order.orderStatus]?.includes(status)) {
    throw new AppError(`Cannot change order from ${order.orderStatus} to ${status}`, 409, 'INVALID_STATUS_TRANSITION');
  }

  order.orderStatus = status;
  if (status === 'processing') order.fulfillmentStatus = 'processing';
  if (status === 'shipped') order.fulfillmentStatus = 'shipped';
  if (status === 'delivered') {
    order.fulfillmentStatus = 'delivered';
    order.deliveredAt = new Date();
  }
  if (status === 'returned') order.fulfillmentStatus = 'returned';
  if (req.body.internalNote !== undefined) order.internalNote = req.body.internalNote;
  order.statusHistory.push({
    status,
    note,
    changedByType: 'admin',
    changedBy: req.user.id,
    changedAt: new Date(),
  });
  await order.save();
  await logAudit(req, {
    action: 'statusChange', resourceType: 'Order', resourceId: order._id,
    resourceLabel: order.orderNumber, description: `Order status changed to ${status}`, statusCode: 200,
  });

  const payload = { id: order._id, orderNumber: order.orderNumber, status };
  emitToUser(order.user, 'order:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'orderManager'], 'order:updated', payload);
  try {
    await notifyUser({
      userId: order.user,
      type: 'order',
      title: 'Order updated',
      message: `Your order ${order.orderNumber} is now ${status}.`,
      data: { orderId: order._id, orderNumber: order.orderNumber, status },
      action: { type: 'order', value: String(order._id), label: 'View order' },
      createdBy: req.user.id,
    });
  } catch (error) { console.error('Order status notification failed', error.message); }
  return ApiResponse.success(res, { message: 'Order status updated', data: withTaxPresentation(order) });
});

module.exports = {
  listMyOrders, getMyOrder, listOrdersAdmin, getOrderAdmin, updateOrderStatus,
  downloadOrderInvoiceAdmin, downloadMyOrderInvoice,
};
