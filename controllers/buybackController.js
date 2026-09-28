const mongoose = require('mongoose');
const Buyback = require('../models/buybackModel');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const ReturnRequest = require('../models/returnModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { cloudinary } = require('../config/cloudinaryConfig');
const { uploadBuffer, deleteAssets } = require('../utils/cloudinaryUtils');
const { generateReferenceNumber } = require('../utils/orderNumberUtils');
const { notifyUser, notifyRoles, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { addCalendarMonths, calculateBuybackAmount, policyTerms } = require('../utils/buybackPolicyUtils');
const { validateUploadSignature } = require('../utils/uploadSignatureUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const DIRECT_CANCELLATION_STATUSES = ['requested', 'appointmentScheduled'];
const WITHDRAWAL_STATUSES = ['checkedIn', 'underInspection', 'offerReady'];
const CLOSEABLE_STATUSES = ['withdrawalRequested', 'customerDeclined', 'rejected'];
const ACTIVE_RETURN_STATUSES = [
  'requested', 'underReview', 'approved', 'pickupScheduled', 'pickedUp', 'received', 'inspected', 'refundInitiated', 'completed',
];
const CHECKLIST_FIELDS = [
  'identityVerified', 'ownershipVerified', 'originalInvoicePresented',
  'originalIgiCertificatePresented', 'igiCertificateGoodCondition',
  'jewellerySameCondition', 'productMatched',
];

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) {
    throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON');
  }
};

const strictBoolean = (value) => value === true || value === 'true';

const validIdempotencyKey = (req) => {
  const key = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new AppError('A valid Idempotency-Key header is required', 422, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
};

const normalizeSlots = (value) => {
  const slots = parseJson(value, []);
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 3) {
    throw new AppError('Provide between one and three preferred shop-visit slots', 422, 'INVALID_APPOINTMENT_SLOTS');
  }
  return slots.map((slot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || start <= new Date()) {
      throw new AppError('Preferred slots must contain valid future start and end times', 422, 'INVALID_APPOINTMENT_SLOT');
    }
    if (end.getTime() - start.getTime() > 4 * 60 * 60 * 1000) {
      throw new AppError('A preferred appointment slot cannot exceed four hours', 422, 'INVALID_APPOINTMENT_SLOT');
    }
    return { start, end };
  });
};

const signedMediaUrl = (media) => {
  if (!media?.publicId) return media?.url;
  return cloudinary.url(media.publicId, {
    secure: true,
    sign_url: true,
    type: media.deliveryType || 'authenticated',
    resource_type: media.resourceType || 'image',
  });
};

const mediaObject = (media) => ({
  ...(media.toObject ? media.toObject() : media),
  url: signedMediaUrl(media),
});

const presentBuyback = (record, includePrivate = false) => {
  const value = record?.toObject ? record.toObject() : { ...record };
  if (!includePrivate) return value;
  value.evidence = (value.evidence || []).map(mediaObject);
  if (value.inspection) value.inspection.images = (value.inspection.images || []).map(mediaObject);
  if (value.settlement?.proof?.publicId) value.settlement.proof = mediaObject(value.settlement.proof);
  return value;
};

const privateUpload = async (file, kind, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) => {
  const mimeType = validateUploadSignature(file, allowedTypes);
  const uploaded = await uploadBuffer(file, {
    folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/buybacks`,
    resourceType: mimeType === 'application/pdf' ? 'raw' : 'image',
    uploadOptions: { type: 'authenticated' },
  });
  return {
    kind,
    url: uploaded.url,
    publicId: uploaded.publicId,
    resourceType: uploaded.resourceType || 'image',
    deliveryType: uploaded.deliveryType || 'authenticated',
    originalName: file.originalname,
  };
};

const uploadFiles = async (files, kind, allowedTypes) => {
  const uploaded = [];
  for (const file of files || []) uploaded.push(await privateUpload(file, kind, allowedTypes));
  return uploaded;
};

const purchaseDateFor = (order) => order.confirmedAt || order.createdAt;

const committedReturnQuantity = async (orderId, orderItemId, session) => {
  const requests = await ReturnRequest.find({
    order: orderId,
    status: { $in: ACTIVE_RETURN_STATUSES },
    'items.orderItemId': orderItemId,
  }).select('status items').session(session || null).lean();
  return requests.reduce((total, request) => total + request.items.reduce((sum, item) => {
    if (String(item.orderItemId) !== String(orderItemId)) return sum;
    if (item.inspectionStatus === 'rejected') return sum;
    return sum + Number(item.quantity || 0);
  }, 0), 0);
};

const itemAvailability = async ({ order, item, product, session }) => {
  const terms = policyTerms();
  const purchaseDate = purchaseDateFor(order);
  const eligibilityDeadline = addCalendarMonths(purchaseDate, terms.windowMonths);
  const returnQuantity = await committedReturnQuantity(order._id, item._id, session);
  const reserved = Number(item.buybackReservedQuantity || 0);
  const completed = Number(item.buybackCompletedQuantity || 0);
  const remainingQuantity = Math.max(0, Number(item.quantity) - returnQuantity - reserved - completed);
  const reasons = [];
  if (!['delivered', 'closed'].includes(order.orderStatus) || !order.deliveredAt) reasons.push('Order has not been delivered');
  if (item.fulfillmentStatus !== 'delivered') reasons.push('Item is not in delivered status');
  if (!order.invoiceNumber) reasons.push('Original invoice is unavailable');
  if (product?.productType !== 'jewellery') reasons.push('Only jewellery is eligible for buyback');
  if (new Date() > eligibilityDeadline) reasons.push('The 12-month buyback window has expired');
  if (remainingQuantity < 1) reasons.push('No eligible quantity remains');
  const perUnit = calculateBuybackAmount(item.lineTotal, 1, item.quantity, terms.ratePercent);
  return { terms, purchaseDate, eligibilityDeadline, remainingQuantity, reasons, perUnit };
};

const findCustomerOrder = async (identifier, userId, session) => {
  const value = String(identifier || '').trim();
  const identity = mongoose.isValidObjectId(value) ? { _id: value } : { orderNumber: value.toUpperCase() };
  return Order.findOne({ ...identity, user: userId }).session(session || null);
};

const addHistory = (buyback, status, note, req, actorType) => {
  buyback.status = status;
  buyback.statusHistory.push({
    status,
    note,
    changedByType: actorType || (req.user?.role === 'customer' ? 'user' : 'admin'),
    changedBy: req.user?.id,
  });
};

const notifyBuybackUpdate = async (buyback, title, message, createdBy) => {
  const payload = {
    buybackId: buyback._id,
    buybackNumber: buyback.buybackNumber,
    orderId: buyback.order,
    status: buyback.status,
  };
  emitToUser(buyback.user, 'buyback:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'orderManager', 'supportManager'], 'buyback:updated', payload);
  try {
    await notifyUser({
      userId: buyback.user,
      type: 'buyback',
      title,
      message,
      data: payload,
      action: { type: 'buyback', value: String(buyback._id), label: 'View buyback' },
      createdBy,
    });
  } catch (error) { console.error('Buyback customer notification failed', error.message); }
};

const changeReservedQuantity = (order, orderItemId, reservedDelta, completedDelta = 0) => {
  const item = order.items.id(orderItemId);
  if (!item) throw new AppError('Original order item is unavailable', 409, 'ORDER_ITEM_UNAVAILABLE');
  const nextReserved = Number(item.buybackReservedQuantity || 0) + reservedDelta;
  const nextCompleted = Number(item.buybackCompletedQuantity || 0) + completedDelta;
  if (nextReserved < 0 || nextCompleted < 0 || nextReserved + nextCompleted > item.quantity) {
    throw new AppError('Buyback quantity reservation is inconsistent', 409, 'BUYBACK_QUANTITY_CONFLICT');
  }
  item.buybackReservedQuantity = nextReserved;
  item.buybackCompletedQuantity = nextCompleted;
};

const eligibleItems = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    user: req.user.id,
    orderStatus: { $in: ['delivered', 'closed'] },
    deliveredAt: { $ne: null },
  }).sort({ deliveredAt: -1 });
  const productIds = [...new Set(orders.flatMap((order) => order.items.map((item) => String(item.product))))];
  const products = await Product.find({ _id: { $in: productIds } }).select('name productType').lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const data = [];
  for (const order of orders) {
    for (const item of order.items) {
      const product = productMap.get(String(item.product));
      const availability = await itemAvailability({ order, item, product });
      if (availability.reasons.length) continue;
      data.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderItemId: item._id,
        productId: item.product,
        name: item.name,
        sku: item.sku,
        image: item.image,
        attributes: item.attributes,
        invoiceNumber: order.invoiceNumber,
        purchaseDate: availability.purchaseDate,
        deliveredAt: order.deliveredAt,
        eligibilityDeadline: availability.eligibilityDeadline,
        remainingQuantity: availability.remainingQuantity,
        invoiceAmountPerUnit: availability.perUnit.baseAmount,
        ratePercent: availability.terms.ratePercent,
        estimatedAmountPerUnit: availability.perUnit.amount,
        policyVersion: availability.terms.policyVersion,
      });
    }
  }
  return ApiResponse.success(res, { data });
});

const createBuyback = asyncHandler(async (req, res) => {
  const idempotencyKey = validIdempotencyKey(req);
  const existing = await Buyback.findOne({ idempotencyKey }).select('+idempotencyKey');
  if (existing) {
    if (String(existing.user) !== String(req.user.id)) throw new AppError('Idempotency key is already in use', 409, 'IDEMPOTENCY_CONFLICT');
    return ApiResponse.success(res, { message: 'Existing buyback request returned', data: existing });
  }

  const productFiles = req.files?.productImages || [];
  const certificateFiles = req.files?.certificateImages || [];
  if (productFiles.length < 1) throw new AppError('At least one current product image is required', 422, 'PRODUCT_IMAGE_REQUIRED');
  if (certificateFiles.length < 1) throw new AppError('An IGI certificate image is required', 422, 'IGI_IMAGE_REQUIRED');
  const declarations = parseJson(req.body.declarations, {});
  if (!['jewellerySameCondition', 'originalIgiCertificateAvailable', 'originalInvoiceAvailable', 'policyAccepted']
    .every((key) => strictBoolean(declarations[key]))) {
    throw new AppError('All buyback policy declarations must be accepted', 422, 'BUYBACK_DECLARATION_REQUIRED');
  }
  const preferredSlots = normalizeSlots(req.body.preferredSlots);
  const quantity = Number(req.body.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError('Valid buyback quantity is required', 422, 'INVALID_BUYBACK_QUANTITY');
  const igiCertificateNumber = String(req.body.igiCertificateNumber || '').trim().toUpperCase();
  if (!/^[A-Z0-9\-/]{3,100}$/.test(igiCertificateNumber)) {
    throw new AppError('Valid IGI certificate number is required', 422, 'INVALID_IGI_CERTIFICATE');
  }

  const uploadedAssets = [];
  try {
    uploadedAssets.push(...await uploadFiles(productFiles, 'product'));
    uploadedAssets.push(...await uploadFiles(certificateFiles, 'igiCertificate'));
    const session = await mongoose.startSession();
    let buyback;
    try {
      await session.withTransaction(async () => {
        const order = await findCustomerOrder(req.body.orderId || req.body.orderNumber, req.user.id, session);
        if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
        const item = order.items.id(req.body.orderItemId);
        if (!item) throw new AppError('Buyback references an invalid order item', 422, 'INVALID_ORDER_ITEM');
        const product = await Product.findById(item.product).session(session).select('productType');
        const availability = await itemAvailability({ order, item, product, session });
        if (availability.reasons.length) {
          throw new AppError(availability.reasons[0], 409, 'BUYBACK_NOT_ELIGIBLE', { reasons: availability.reasons });
        }
        if (quantity > availability.remainingQuantity) {
          throw new AppError('Requested quantity exceeds the eligible quantity', 409, 'BUYBACK_QUANTITY_CONFLICT');
        }
        const calculation = calculateBuybackAmount(item.lineTotal, quantity, item.quantity, availability.terms.ratePercent);
        [buyback] = await Buyback.create([{
          buybackNumber: generateReferenceNumber('BBK'),
          user: req.user.id,
          order: order._id,
          product: item.product,
          orderItemId: item._id,
          variantId: item.variantId,
          itemSnapshot: {
            sku: item.sku,
            name: item.name,
            image: item.image,
            attributes: item.attributes,
            quantity,
            purchasedQuantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxableAmount: item.taxableAmount,
            taxAmount: item.taxAmount,
            invoiceLineTotal: item.lineTotal,
            buybackBaseAmount: calculation.baseAmount,
          },
          policy: {
            ratePercent: availability.terms.ratePercent,
            windowMonths: availability.terms.windowMonths,
            version: availability.terms.policyVersion,
            estimatedAmount: calculation.amount,
            purchaseDate: availability.purchaseDate,
            eligibilityDeadline: availability.eligibilityDeadline,
            invoiceNumber: order.invoiceNumber,
          },
          igiCertificateNumber,
          reason: req.body.reason,
          customerNote: req.body.customerNote,
          declarations: {
            jewellerySameCondition: true,
            originalIgiCertificateAvailable: true,
            originalInvoiceAvailable: true,
            policyAccepted: true,
            acceptedAt: new Date(),
          },
          evidence: uploadedAssets,
          appointment: { preferredSlots },
          idempotencyKey,
          statusHistory: [{ status: 'requested', note: 'Buyback requested by customer', changedByType: 'user', changedBy: req.user.id }],
        }], { session });
        changeReservedQuantity(order, item._id, quantity);
        await order.save({ session });
      });
    } finally { await session.endSession(); }

    await logAudit(req, {
      action: 'create', resourceType: 'Buyback', resourceId: buyback._id, resourceLabel: buyback.buybackNumber,
      description: 'Customer submitted a buyback request', statusCode: 201,
    });
    await notifyBuybackUpdate(buyback, 'Buyback request received', `Buyback ${buyback.buybackNumber} is awaiting appointment confirmation.`);
    try {
      await notifyRoles({
        roles: ['superAdmin', 'admin', 'orderManager', 'supportManager'],
        type: 'buyback', title: 'New buyback request',
        message: `Buyback ${buyback.buybackNumber} requires appointment review.`,
        data: { buybackId: buyback._id, orderId: buyback.order }, priority: 'high',
      });
    } catch (error) { console.error('Buyback admin notification failed', error.message); }
    return ApiResponse.success(res, { statusCode: 201, message: 'Buyback requested', data: presentBuyback(buyback, true) });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const listMyBuybacks = asyncHandler(async (req, res) => {
  const buybacks = await Buyback.find({ user: req.user.id }).sort({ createdAt: -1 }).lean();
  return ApiResponse.success(res, { data: buybacks });
});

const getMyBuyback = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findOne({ _id: req.params.buybackId, user: req.user.id })
    .select('+evidence +inspection.images +settlement.proof');
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  return ApiResponse.success(res, { data: presentBuyback(buyback, true) });
});

const releaseAndClose = async ({ req, allowedStatuses, nextStatus, note, closure }) => {
  const session = await mongoose.startSession();
  let buyback;
  try {
    await session.withTransaction(async () => {
      const filter = { _id: req.params.buybackId };
      if (req.user.role === 'customer') filter.user = req.user.id;
      buyback = await Buyback.findOne(filter).session(session);
      if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
      if (!allowedStatuses.includes(buyback.status)) throw new AppError('Buyback cannot be closed at this stage', 409, 'INVALID_BUYBACK_STATUS');
      const order = await Order.findById(buyback.order).session(session);
      if (!order) throw new AppError('Original order is unavailable', 409, 'ORDER_UNAVAILABLE');
      changeReservedQuantity(order, buyback.orderItemId, -buyback.itemSnapshot.quantity);
      await order.save({ session });
      if (closure) buyback.closure = { ...(buyback.closure?.toObject?.() || buyback.closure || {}), ...closure };
      addHistory(buyback, nextStatus, note, req);
      await buyback.save({ session });
    });
  } finally { await session.endSession(); }
  return buyback;
};

const cancelBuyback = asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new AppError('Cancellation reason is required', 422, 'CANCELLATION_REASON_REQUIRED');
  const buyback = await releaseAndClose({
    req, allowedStatuses: DIRECT_CANCELLATION_STATUSES, nextStatus: 'cancelled', note: reason,
    closure: { reason },
  });
  await logAudit(req, { action: 'cancel', resourceType: 'Buyback', resourceId: buyback._id, resourceLabel: buyback.buybackNumber, description: 'Customer cancelled buyback request', statusCode: 200 });
  await notifyBuybackUpdate(buyback, 'Buyback cancelled', `Buyback ${buyback.buybackNumber} was cancelled.`);
  return ApiResponse.success(res, { message: 'Buyback cancelled', data: buyback });
});

const updateAppointmentPreferences = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findOne({ _id: req.params.buybackId, user: req.user.id });
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (!DIRECT_CANCELLATION_STATUSES.includes(buyback.status)) throw new AppError('Appointment preferences can no longer be changed', 409, 'INVALID_BUYBACK_STATUS');
  buyback.appointment.preferredSlots = normalizeSlots(req.body.preferredSlots);
  buyback.appointment.scheduledStart = undefined;
  buyback.appointment.scheduledEnd = undefined;
  buyback.appointment.confirmedAt = undefined;
  buyback.appointment.assignedAdmin = undefined;
  addHistory(buyback, 'requested', req.body.note || 'Customer requested new appointment slots', req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Appointment preferences updated', `New slots were submitted for ${buyback.buybackNumber}.`);
  return ApiResponse.success(res, { message: 'Appointment preferences updated', data: buyback });
});

const requestWithdrawal = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findOne({ _id: req.params.buybackId, user: req.user.id });
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (!WITHDRAWAL_STATUSES.includes(buyback.status)) throw new AppError('Buyback cannot be withdrawn at this stage', 409, 'INVALID_BUYBACK_STATUS');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new AppError('Withdrawal reason is required', 422, 'WITHDRAWAL_REASON_REQUIRED');
  addHistory(buyback, 'withdrawalRequested', reason, req);
  buyback.closure.reason = reason;
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Withdrawal requested', `The shop team will return the item for ${buyback.buybackNumber}.`);
  return ApiResponse.success(res, { message: 'Withdrawal requested', data: buyback });
});

const acceptOffer = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findOne({ _id: req.params.buybackId, user: req.user.id });
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (buyback.status !== 'offerReady') throw new AppError('Buyback offer is not ready for acceptance', 409, 'INVALID_BUYBACK_STATUS');
  if (!strictBoolean(req.body.acceptPolicy)) throw new AppError('Offer acceptance confirmation is required', 422, 'OFFER_ACCEPTANCE_REQUIRED');
  buyback.offer.acceptedAt = new Date();
  buyback.offer.customerAcceptanceIp = req.ip;
  buyback.offer.policyVersion = buyback.policy.version;
  addHistory(buyback, 'customerAccepted', 'Customer accepted the fixed buyback offer', req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Buyback offer accepted', `Offer for ${buyback.buybackNumber} was accepted and awaits settlement.`);
  return ApiResponse.success(res, { message: 'Buyback offer accepted', data: buyback });
});

const declineOffer = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findOne({ _id: req.params.buybackId, user: req.user.id });
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (buyback.status !== 'offerReady') throw new AppError('Buyback offer cannot be declined at this stage', 409, 'INVALID_BUYBACK_STATUS');
  buyback.offer.declinedAt = new Date();
  buyback.closure.reason = String(req.body.reason || 'Customer declined the buyback offer').trim();
  addHistory(buyback, 'customerDeclined', buyback.closure.reason, req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Buyback offer declined', `The shop team will return the item for ${buyback.buybackNumber}.`);
  return ApiResponse.success(res, { message: 'Buyback offer declined', data: buyback });
});

const listBuybacksAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    baseFilter.$or = [
      { buybackNumber: new RegExp(escaped, 'i') },
      { 'itemSnapshot.sku': new RegExp(escaped, 'i') },
      { 'itemSnapshot.name': new RegExp(escaped, 'i') },
    ];
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [buybacks, total, summary] = await Promise.all([
    Buyback.find(filter).populate('user', 'firstName lastName email phone').populate('order', 'orderNumber invoiceNumber')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Buyback.countDocuments(filter),
    summarizeStatusFields(Buyback, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: buybacks,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getBuybackAdmin = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findById(req.params.buybackId)
    .select('+evidence +inspection.images +settlement.proof')
    .populate('user', 'firstName lastName email phone')
    .populate('order', 'orderNumber invoiceNumber deliveredAt billingAddress')
    .populate('appointment.assignedAdmin', 'firstName lastName email')
    .populate('inspection.startedBy inspection.completedBy settlement.processedBy closure.returnedBy', 'firstName lastName email');
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  return ApiResponse.success(res, { data: presentBuyback(buyback, true) });
});

const scheduleAppointment = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findById(req.params.buybackId);
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (!DIRECT_CANCELLATION_STATUSES.includes(buyback.status)) throw new AppError('Appointment cannot be scheduled at this stage', 409, 'INVALID_BUYBACK_STATUS');
  const start = new Date(req.body.scheduledStart);
  const end = new Date(req.body.scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start <= new Date() || end <= start) {
    throw new AppError('Valid future appointment start and end times are required', 422, 'INVALID_APPOINTMENT_TIME');
  }
  if (end.getTime() - start.getTime() > 4 * 60 * 60 * 1000) {
    throw new AppError('A shop appointment cannot exceed four hours', 422, 'INVALID_APPOINTMENT_TIME');
  }
  const shop = parseJson(req.body.shop, req.body.shop || {});
  if (!shop.name || !shop.address || !shop.city) throw new AppError('Shop name, address, and city are required', 422, 'SHOP_DETAILS_REQUIRED');
  buyback.appointment.shop = shop;
  buyback.appointment.scheduledStart = start;
  buyback.appointment.scheduledEnd = end;
  buyback.appointment.assignedAdmin = req.body.assignedAdmin || req.user.id;
  buyback.appointment.confirmedAt = new Date();
  addHistory(buyback, 'appointmentScheduled', req.body.note || 'Shop appointment confirmed', req);
  await buyback.save();
  await logAudit(req, { action: 'update', resourceType: 'Buyback', resourceId: buyback._id, resourceLabel: buyback.buybackNumber, description: 'Buyback shop appointment scheduled', statusCode: 200 });
  await notifyBuybackUpdate(buyback, 'Buyback appointment confirmed', `Shop appointment for ${buyback.buybackNumber} has been confirmed.`, req.user.id);
  return ApiResponse.success(res, { message: 'Buyback appointment scheduled', data: buyback });
});

const checkIn = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findById(req.params.buybackId);
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (buyback.status !== 'appointmentScheduled') throw new AppError('Customer cannot be checked in at this stage', 409, 'INVALID_BUYBACK_STATUS');
  buyback.appointment.checkedInAt = new Date();
  addHistory(buyback, 'checkedIn', req.body.note || 'Customer and jewellery checked in at shop', req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Shop check-in completed', `Buyback ${buyback.buybackNumber} is ready for inspection.`, req.user.id);
  return ApiResponse.success(res, { message: 'Customer checked in', data: buyback });
});

const startInspection = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findById(req.params.buybackId);
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (buyback.status !== 'checkedIn') throw new AppError('Inspection cannot start at this stage', 409, 'INVALID_BUYBACK_STATUS');
  buyback.inspection.startedAt = new Date();
  buyback.inspection.startedBy = req.user.id;
  addHistory(buyback, 'underInspection', req.body.note || 'Physical inspection started', req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Inspection started', `Physical inspection for ${buyback.buybackNumber} has started.`, req.user.id);
  return ApiResponse.success(res, { message: 'Inspection started', data: buyback });
});

const completeInspection = asyncHandler(async (req, res) => {
  const uploadedAssets = [];
  try {
    uploadedAssets.push(...await uploadFiles(req.files?.inspectionImages || [], 'inspection'));
    const buyback = await Buyback.findById(req.params.buybackId).select('+inspection.images');
    if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
    if (buyback.status !== 'underInspection') throw new AppError('Buyback is not under inspection', 409, 'INVALID_BUYBACK_STATUS');
    const checklist = parseJson(req.body.checklist, req.body);
    CHECKLIST_FIELDS.forEach((field) => { buyback.inspection[field] = strictBoolean(checklist[field]); });
    const passed = CHECKLIST_FIELDS.every((field) => buyback.inspection[field] === true);
    buyback.inspection.note = req.body.note;
    buyback.inspection.images.push(...uploadedAssets);
    buyback.inspection.completedAt = new Date();
    buyback.inspection.completedBy = req.user.id;
    if (passed) {
      buyback.offer.amount = buyback.policy.estimatedAmount;
      buyback.offer.ratePercent = buyback.policy.ratePercent;
      buyback.offer.generatedAt = new Date();
      addHistory(buyback, 'offerReady', `All policy conditions passed; fixed ${buyback.policy.ratePercent}% offer generated`, req);
    } else {
      const rejectionReason = String(req.body.rejectionReason || '').trim();
      if (!rejectionReason) throw new AppError('Rejection reason is required when inspection fails', 422, 'REJECTION_REASON_REQUIRED');
      buyback.rejectionReason = rejectionReason;
      addHistory(buyback, 'rejected', rejectionReason, req);
    }
    await buyback.save();
    await logAudit(req, {
      action: passed ? 'approve' : 'reject', resourceType: 'Buyback', resourceId: buyback._id,
      resourceLabel: buyback.buybackNumber, description: 'Buyback physical inspection completed', statusCode: 200,
    });
    await notifyBuybackUpdate(
      buyback,
      passed ? 'Buyback offer ready' : 'Buyback inspection declined',
      passed ? `Your fixed offer for ${buyback.buybackNumber} is ready.` : `Buyback ${buyback.buybackNumber} did not pass inspection.`,
      req.user.id,
    );
    return ApiResponse.success(res, { message: passed ? 'Buyback offer generated' : 'Buyback rejected after inspection', data: presentBuyback(buyback, true) });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const markNoShow = asyncHandler(async (req, res) => {
  const buyback = await releaseAndClose({
    req, allowedStatuses: ['appointmentScheduled'], nextStatus: 'noShow',
    note: req.body.note || 'Customer did not attend the scheduled shop appointment',
    closure: { reason: req.body.note || 'Customer no-show' },
  });
  await notifyBuybackUpdate(buyback, 'Buyback appointment missed', `Buyback ${buyback.buybackNumber} was closed as a no-show.`, req.user.id);
  return ApiResponse.success(res, { message: 'Buyback marked as no-show', data: buyback });
});

const closeWithoutBuyback = asyncHandler(async (req, res) => {
  const handoverNote = String(req.body.handoverNote || '').trim();
  if (!handoverNote) throw new AppError('Item handover note is required', 422, 'HANDOVER_NOTE_REQUIRED');
  const buyback = await releaseAndClose({
    req,
    allowedStatuses: CLOSEABLE_STATUSES,
    nextStatus: 'closed',
    note: handoverNote,
    closure: { itemReturnedAt: new Date(), returnedBy: req.user.id, handoverNote },
  });
  await logAudit(req, { action: 'update', resourceType: 'Buyback', resourceId: buyback._id, resourceLabel: buyback.buybackNumber, description: 'Buyback closed and item returned to customer', statusCode: 200 });
  await notifyBuybackUpdate(buyback, 'Jewellery returned', `Buyback ${buyback.buybackNumber} was closed and the item was returned.`, req.user.id);
  return ApiResponse.success(res, { message: 'Buyback closed and item returned', data: buyback });
});

const startSettlement = asyncHandler(async (req, res) => {
  const buyback = await Buyback.findById(req.params.buybackId);
  if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
  if (buyback.status !== 'customerAccepted') throw new AppError('Customer must accept the offer before settlement', 409, 'INVALID_BUYBACK_STATUS');
  buyback.settlement.startedAt = new Date();
  buyback.settlement.processedBy = req.user.id;
  addHistory(buyback, 'settlementPending', req.body.note || 'Offline settlement preparation started', req);
  await buyback.save();
  await notifyBuybackUpdate(buyback, 'Settlement initiated', `Offline settlement for ${buyback.buybackNumber} is being prepared.`, req.user.id);
  return ApiResponse.success(res, { message: 'Settlement started', data: buyback });
});

const completeSettlement = asyncHandler(async (req, res) => {
  const mode = String(req.body.mode || '').trim();
  if (!['neft', 'imps', 'cheque', 'cash', 'storeCredit'].includes(mode)) throw new AppError('Valid settlement mode is required', 422, 'INVALID_SETTLEMENT_MODE');
  const reference = String(req.body.reference || '').trim();
  if (!reference) throw new AppError('Settlement reference is required', 422, 'SETTLEMENT_REFERENCE_REQUIRED');
  const uploadedAssets = [];
  try {
    const proofFile = req.files?.proof?.[0];
    if (proofFile) uploadedAssets.push(await privateUpload(
      proofFile,
      'settlementProof',
      ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf'],
    ));
    const session = await mongoose.startSession();
    let buyback;
    try {
      await session.withTransaction(async () => {
        buyback = await Buyback.findById(req.params.buybackId).select('+settlement.proof').session(session);
        if (!buyback) throw new AppError('Buyback request not found', 404, 'BUYBACK_NOT_FOUND');
        if (buyback.status !== 'settlementPending') throw new AppError('Settlement is not ready for completion', 409, 'INVALID_BUYBACK_STATUS');
        const order = await Order.findById(buyback.order).session(session);
        if (!order) throw new AppError('Original order is unavailable', 409, 'ORDER_UNAVAILABLE');
        changeReservedQuantity(order, buyback.orderItemId, -buyback.itemSnapshot.quantity, buyback.itemSnapshot.quantity);
        await order.save({ session });
        buyback.settlement.mode = mode;
        buyback.settlement.reference = reference;
        buyback.settlement.paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
        if (Number.isNaN(buyback.settlement.paidAt.getTime())) throw new AppError('Valid settlement date is required', 422, 'INVALID_SETTLEMENT_DATE');
        buyback.settlement.note = req.body.note;
        buyback.settlement.processedBy = req.user.id;
        if (uploadedAssets[0]) buyback.settlement.proof = uploadedAssets[0];
        addHistory(buyback, 'completed', `Offline settlement completed via ${mode}`, req);
        await buyback.save({ session });
      });
    } finally { await session.endSession(); }
    await logAudit(req, { action: 'statusChange', resourceType: 'Buyback', resourceId: buyback._id, resourceLabel: buyback.buybackNumber, description: 'Buyback offline settlement completed', statusCode: 200 });
    await notifyBuybackUpdate(buyback, 'Buyback completed', `Buyback ${buyback.buybackNumber} has been settled successfully.`, req.user.id);
    return ApiResponse.success(res, { message: 'Buyback settlement completed', data: presentBuyback(buyback, true) });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

module.exports = {
  eligibleItems, createBuyback, listMyBuybacks, getMyBuyback, cancelBuyback,
  updateAppointmentPreferences, requestWithdrawal, acceptOffer, declineOffer,
  listBuybacksAdmin, getBuybackAdmin, scheduleAppointment, checkIn, startInspection,
  completeInspection, markNoShow, closeWithoutBuyback, startSettlement, completeSettlement,
};
