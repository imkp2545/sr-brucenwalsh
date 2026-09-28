const mongoose = require('mongoose');
const Refund = require('../models/refundModel');
const ReturnRequest = require('../models/returnModel');
const Payment = require('../models/paymentModel');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateReferenceNumber } = require('../utils/orderNumberUtils');
const { createHdfcRefundRequest, verifyHdfcRefundStatus } = require('../utils/hdfcPaymentUtils');
const { notifyUser, notifyRoles, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const { recordInventoryMovement, stockSnapshot } = require('../services/inventoryMovementService');

const refundEligibleItems = (returnRequest) => returnRequest.items.filter(
  (item) => item.inspectionStatus === 'approved' && item.resolution === 'refund' && item.approvedAmount > 0,
);

const completeRefund = async ({ refund, gatewayResult, req }) => {
  if (!gatewayResult.successful) throw new AppError('HDFC refund is not completed', 409, 'REFUND_NOT_COMPLETED', { status: gatewayResult.status });
  if (!Number.isFinite(gatewayResult.amount) || Math.abs(gatewayResult.amount - refund.amount) > 0.009) {
    throw new AppError('HDFC refund amount does not match the approved refund', 409, 'REFUND_AMOUNT_MISMATCH');
  }

  const session = await mongoose.startSession();
  let completedRefund;
  try {
    await session.withTransaction(async () => {
      completedRefund = await Refund.findById(refund._id).session(session);
      if (completedRefund.status === 'succeeded') return;
      const [returnRequest, payment, order] = await Promise.all([
        ReturnRequest.findById(completedRefund.returnRequest).session(session),
        Payment.findById(completedRefund.payment).session(session),
        Order.findById(completedRefund.order).session(session),
      ]);
      if (!returnRequest || !payment || !order) throw new Error('Refund dependencies are missing');
      const remainingPayment = Math.round((payment.amount - payment.refundedAmount) * 100) / 100;
      if (completedRefund.amount > remainingPayment) throw new AppError('Refund exceeds remaining captured payment', 409, 'REFUND_EXCEEDS_PAYMENT');

      const approvedItems = returnRequest.items.filter((item) => item.inspectionStatus === 'approved');
      for (const item of approvedItems) {
        if (item.restockedAt || !['unopened', 'unused'].includes(item.condition)) continue;
        const update = item.variantId
          ? { $inc: { 'variants.$[variant].stock': item.quantity } }
          : { $inc: { stock: item.quantity } };
        const options = item.variantId
          ? { session, arrayFilters: [{ 'variant._id': item.variantId }] }
          : { session };
        await Product.updateOne({ _id: item.product }, update, options);
        const product = await Product.findById(item.product).session(session);
        if (product) {
          const snapshot = stockSnapshot(product, item.variantId || null);
          await recordInventoryMovement({
            product,
            variantId: item.variantId || null,
            type: 'restock',
            source: 'refund',
            quantityBefore: Math.max(0, snapshot.stock - Number(item.quantity || 0)),
            quantityAfter: snapshot.stock,
            reservedBefore: snapshot.reservedStock,
            reservedAfter: snapshot.reservedStock,
            reason: 'Refund restock',
            actor: req.user?.id,
            reference: { model: 'Refund', id: completedRefund._id, label: completedRefund.refundNumber },
            session,
          });
        }
        item.restockedAt = new Date();
      }

      payment.refundedAmount = Math.round((payment.refundedAmount + completedRefund.amount) * 100) / 100;
      payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partiallyRefunded';
      await payment.save({ session });
      order.paymentStatus = payment.status;
      const fullyReturned = order.items.every((orderItem) => {
        const returnedItem = returnRequest.items.find((item) => String(item.orderItemId) === String(orderItem._id) && item.inspectionStatus === 'approved');
        return returnedItem && returnedItem.quantity >= orderItem.quantity;
      });
      order.orderStatus = fullyReturned ? 'returned' : 'delivered';
      order.fulfillmentStatus = fullyReturned ? 'returned' : 'partiallyReturned';
      returnRequest.items.forEach((returnItem) => {
        const orderItem = order.items.id(returnItem.orderItemId);
        if (orderItem && returnItem.inspectionStatus === 'approved' && returnItem.quantity >= orderItem.quantity) orderItem.fulfillmentStatus = 'returned';
      });
      order.statusHistory.push({ status: order.orderStatus, note: `Refund ${completedRefund.refundNumber} completed`, changedByType: 'system' });
      await order.save({ session });

      returnRequest.status = 'completed';
      returnRequest.completedAt = new Date();
      returnRequest.statusHistory.push({ status: 'completed', note: `Refund ${completedRefund.refundNumber} completed`, changedBy: req.user?.id });
      await returnRequest.save({ session });
      completedRefund.status = 'succeeded';
      completedRefund.gatewayRefundId = gatewayResult.gatewayRefundId || completedRefund.gatewayRefundId;
      completedRefund.bankReferenceNumber = gatewayResult.bankReferenceNumber;
      completedRefund.processedAt = completedRefund.processedAt || new Date();
      completedRefund.completedAt = new Date();
      completedRefund.gatewayResponse = new Map([['completedResponse', JSON.stringify(gatewayResult.raw)]]);
      await completedRefund.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const payload = { refundId: completedRefund._id, refundNumber: completedRefund.refundNumber, orderId: completedRefund.order, status: completedRefund.status, amount: completedRefund.amount };
  emitToUser(completedRefund.user, 'refund:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'orderManager'], 'refund:updated', payload);
  try {
    await notifyUser({
      userId: completedRefund.user, type: 'refund', title: 'Refund completed',
      message: `Refund ${completedRefund.refundNumber} for INR ${completedRefund.amount.toFixed(2)} has been processed.`,
      data: payload, action: { type: 'order', value: String(completedRefund.order), label: 'View order' },
    });
  } catch (error) { console.error('Refund customer notification failed', error.message); }
  try {
    await notifyRoles({
      roles: ['superAdmin', 'admin', 'orderManager'], type: 'refund', title: 'Refund completed',
      message: `Refund ${completedRefund.refundNumber} for INR ${completedRefund.amount.toFixed(2)} completed.`,
      data: payload, priority: 'high', createdBy: req.user?.id || null,
    });
  } catch (error) { console.error('Refund admin notification failed', error.message); }
  return completedRefund;
};

const initiateRefund = asyncHandler(async (req, res) => {
  const idempotencyKey = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new AppError('A valid Idempotency-Key header is required', 422, 'IDEMPOTENCY_KEY_REQUIRED');
  const existing = await Refund.findOne({ idempotencyKey }).select('+idempotencyKey');
  if (existing) return ApiResponse.success(res, { message: 'Existing refund returned', data: existing });

  const returnRequest = await ReturnRequest.findById(req.body.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (returnRequest.status !== 'inspected') throw new AppError('Return must pass inspection before refund', 409, 'RETURN_NOT_REFUNDABLE');
  const activeRefund = await Refund.findOne({
    returnRequest: returnRequest._id,
    status: { $in: ['requested', 'approved', 'processing', 'succeeded'] },
  });
  if (activeRefund) return ApiResponse.success(res, { message: 'Existing refund returned', data: activeRefund });
  const eligibleItems = refundEligibleItems(returnRequest);
  const approvedAmount = Math.round(eligibleItems.reduce((sum, item) => sum + item.approvedAmount, 0) * 100) / 100;
  if (approvedAmount <= 0) throw new AppError('No inspected items are eligible for a payment refund', 422, 'NO_REFUNDABLE_ITEMS');

  const payment = await Payment.findOne({ order: returnRequest.order, status: { $in: ['captured', 'partiallyRefunded'] } }).sort({ capturedAt: -1 });
  if (!payment || !payment.transactionId) throw new AppError('Captured HDFC payment not found', 404, 'PAYMENT_NOT_FOUND');
  const remaining = Math.round((payment.amount - payment.refundedAmount) * 100) / 100;
  const amount = approvedAmount;
  if (req.body.amount !== undefined && Math.abs(Number(req.body.amount) - approvedAmount) > 0.009) {
    throw new AppError('Refund amount must equal the inspected approved amount', 422, 'INVALID_REFUND_AMOUNT');
  }
  if (amount > remaining) {
    throw new AppError('Refund amount exceeds the approved or remaining payment amount', 422, 'INVALID_REFUND_AMOUNT');
  }

  const refund = await Refund.create({
    refundNumber: generateReferenceNumber('RFD'),
    order: returnRequest.order,
    payment: payment._id,
    returnRequest: returnRequest._id,
    user: returnRequest.user,
    gateway: 'hdfc',
    amount,
    currency: payment.currency,
    reason: 'returnApproved',
    reasonDetails: req.body.reasonDetails,
    status: 'requested',
    initiatedBy: req.user.id,
    approvedBy: req.user.id,
    idempotencyKey,
  });

  let gatewayAccepted = false;
  try {
    const gatewayResult = await createHdfcRefundRequest({
      refundReference: refund.refundNumber,
      orderReference: payment.paymentReference,
      transactionId: payment.transactionId,
      amount,
      reason: req.body.reasonDetails || `Approved return ${returnRequest.returnNumber}`,
    });
    refund.gatewayRefundId = gatewayResult.gatewayRefundId;
    refund.bankReferenceNumber = gatewayResult.bankReferenceNumber;
    refund.processedAt = new Date();
    refund.gatewayResponse = new Map([['initiationResponse', JSON.stringify(gatewayResult.raw)]]);

    if (gatewayResult.successful) {
      gatewayAccepted = true;
      await refund.save({ validateBeforeSave: false });
      const completed = await completeRefund({ refund, gatewayResult, req });
      await logAudit(req, {
        action: 'refund', resourceType: 'Refund', resourceId: completed._id, resourceLabel: completed.refundNumber,
        description: 'HDFC refund completed', statusCode: 200,
      });
      return ApiResponse.success(res, { message: 'Refund completed', data: completed });
    }
    if (gatewayResult.processing) {
      gatewayAccepted = true;
      refund.status = 'processing';
      returnRequest.status = 'refundInitiated';
      returnRequest.statusHistory.push({ status: 'refundInitiated', note: `Refund ${refund.refundNumber} initiated`, changedBy: req.user.id });
      await Promise.all([refund.save(), returnRequest.save()]);
      return ApiResponse.success(res, { statusCode: 202, message: 'Refund is processing', data: refund });
    }
    refund.status = 'failed';
    refund.failedAt = new Date();
    refund.failureCode = gatewayResult.responseCode;
    refund.failureReason = gatewayResult.responseMessage;
    await refund.save();
    throw new AppError('HDFC rejected the refund request', 502, 'REFUND_REJECTED');
  } catch (error) {
    if (refund.status === 'requested') {
      refund.status = gatewayAccepted ? 'processing' : 'failed';
      if (!gatewayAccepted) refund.failedAt = new Date();
      refund.failureReason = error.message;
      await refund.save({ validateBeforeSave: false });
    }
    throw error;
  }
});

const verifyRefund = asyncHandler(async (req, res) => {
  const refund = await Refund.findById(req.params.refundId);
  if (!refund) throw new AppError('Refund not found', 404, 'REFUND_NOT_FOUND');
  if (refund.status === 'succeeded') return ApiResponse.success(res, { data: refund });
  const payment = await Payment.findById(refund.payment);
  const gatewayResult = await verifyHdfcRefundStatus({
    refundReference: refund.refundNumber,
    orderReference: payment?.paymentReference,
  });
  if (!gatewayResult.successful) return ApiResponse.success(res, { statusCode: 202, message: 'Refund is not yet completed', data: { refund, gatewayStatus: gatewayResult.status } });
  const completed = await completeRefund({ refund, gatewayResult, req });
  return ApiResponse.success(res, { message: 'Refund completed', data: completed });
});

const hdfcRefundWebhook = asyncHandler(async (req, res) => {
  const refundReference = String(
    req.body.merchant_refund_id || req.body.refund_reference || req.body.refund_id || '',
  ).trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,64}$/.test(refundReference)) {
    throw new AppError('Valid refund reference is required', 400, 'REFUND_REFERENCE_REQUIRED');
  }
  const refund = await Refund.findOne({ refundNumber: refundReference });
  if (!refund) throw new AppError('Refund not found', 404, 'REFUND_NOT_FOUND');
  if (refund.status === 'succeeded') {
    return ApiResponse.success(res, { message: 'Refund webhook already processed' });
  }
  const payment = await Payment.findById(refund.payment);
  if (!payment?.paymentReference) {
    throw new AppError('Original HDFC payment reference is unavailable', 409, 'PAYMENT_REFERENCE_REQUIRED');
  }

  // Webhook data is only a notification. HDFC/Juspay's authenticated status API is authoritative.
  const gatewayResult = await verifyHdfcRefundStatus({
    refundReference: refund.refundNumber,
    orderReference: payment?.paymentReference,
  });
  if (gatewayResult.successful) await completeRefund({ refund, gatewayResult, req });
  return ApiResponse.success(res, {
    message: gatewayResult.successful ? 'Refund webhook processed' : 'Refund status is not completed',
    data: { gatewayStatus: gatewayResult.status },
  });
});

const listMyRefunds = asyncHandler(async (req, res) => {
  const refunds = await Refund.find({ user: req.user.id }).select('-gatewayResponse').sort({ createdAt: -1 }).lean();
  return ApiResponse.success(res, { data: refunds });
});

const listRefundsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.search) {
    const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      baseFilter.$or = [
        { refundNumber: new RegExp(escaped, 'i') },
        { gatewayRefundId: new RegExp(escaped, 'i') },
        { reasonDetails: new RegExp(escaped, 'i') },
      ];
    }
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [refunds, total, summary] = await Promise.all([
    Refund.find(filter).populate('user', 'firstName lastName email').populate('order', 'orderNumber')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Refund.countDocuments(filter),
    summarizeStatusFields(Refund, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: refunds,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getRefundAdmin = asyncHandler(async (req, res) => {
  const refund = await Refund.findById(req.params.refundId)
    .populate('user', 'firstName lastName email phone')
    .populate('order', 'orderNumber orderStatus paymentStatus grandTotal')
    .populate('returnRequest', 'returnNumber status totalApprovedAmount items')
    .populate('payment', 'paymentReference transactionId amount refundedAmount status');
  if (!refund) throw new AppError('Refund not found', 404, 'REFUND_NOT_FOUND');
  return ApiResponse.success(res, { data: refund });
});

module.exports = {
  initiateRefund, verifyRefund, hdfcRefundWebhook, listMyRefunds, listRefundsAdmin, getRefundAdmin,
};
