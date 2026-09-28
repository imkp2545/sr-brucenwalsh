const mongoose = require('mongoose');
const ReturnRequest = require('../models/returnModel');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const Setting = require('../models/settingModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateReferenceNumber } = require('../utils/orderNumberUtils');
const { flattenFiles, uploadBuffer, deleteAssets } = require('../utils/cloudinaryUtils');
const { notifyUser, notifyRoles, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const {
  checkServiceability, createReverseWaybill, registerReversePickup,
  cancelRegisteredPickup, cancelWaybill, trackShipment,
} = require('../utils/blueDartUtils');
const { isPdfBuffer, shippingLabelPdfBuffer } = require('../utils/shippingLabelUtils');
const { applyReverseTracking } = require('../utils/returnTrackingUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const { recordInventoryMovement, stockSnapshot } = require('../services/inventoryMovementService');

const OPEN_RETURN_STATUSES = ['requested', 'underReview', 'approved', 'pickupScheduled', 'pickedUp', 'received', 'inspected', 'refundInitiated', 'completed'];

const validIdempotencyKey = (req) => {
  const key = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new AppError('A valid Idempotency-Key header is required', 422, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return key;
};

const blueDartStore = () => {
  const store = {
    name: process.env.BLUE_DART_PICKUP_NAME,
    line1: process.env.BLUE_DART_PICKUP_LINE1,
    line2: process.env.BLUE_DART_PICKUP_LINE2,
    city: process.env.BLUE_DART_PICKUP_CITY,
    state: process.env.BLUE_DART_PICKUP_STATE,
    postalCode: process.env.BLUE_DART_PICKUP_POSTAL_CODE,
    phone: process.env.BLUE_DART_PICKUP_PHONE,
    email: process.env.INVOICE_EMAIL,
  };
  if (Object.entries(store).filter(([key]) => !['line2', 'email'].includes(key)).some(([, value]) => !value)) {
    throw new AppError('Blue Dart store return address is incomplete', 500, 'CARRIER_CONFIG_INVALID');
  }
  return store;
};

const returnDeclaredValue = (order, returnRequest) => Math.round(returnRequest.items.reduce((total, item) => {
  const orderItem = order.items.id(item.orderItemId);
  if (!orderItem) throw new AppError('Original order item is unavailable', 409, 'ORDER_ITEM_UNAVAILABLE');
  return total + (Number(orderItem.lineTotal) / Number(orderItem.quantity)) * Number(item.quantity);
}, 0) * 100) / 100;

const uploadReturnLabel = async (waybill) => {
  if (waybill.labelUrl) return waybill.labelUrl;
  if (!waybill.labelBase64) return undefined;
  const label = shippingLabelPdfBuffer(waybill.labelBase64);
  const uploaded = await uploadBuffer(
    { buffer: label, mimetype: 'application/pdf' },
    {
      folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/return-labels`,
      resourceType: 'raw',
      uploadOptions: { public_id: `return-label-${waybill.awbNumber}`, overwrite: true },
    },
  );
  return uploaded.url;
};

const addStatusHistory = (returnRequest, status, note, changedBy) => {
  returnRequest.status = status;
  returnRequest.statusHistory.push({ status, note, changedBy });
};

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const getReturnWindowDays = async () => {
  const setting = await Setting.findOne({ key: 'return.window_days' }).lean();
  const days = Number(setting?.value ?? process.env.RETURN_WINDOW_DAYS ?? 7);
  return Number.isFinite(days) && days > 0 ? days : 7;
};

const notifyReturnUpdate = async (returnRequest, title, message, createdBy) => {
  const payload = { returnId: returnRequest._id, returnNumber: returnRequest.returnNumber, orderId: returnRequest.order, status: returnRequest.status };
  emitToUser(returnRequest.user, 'return:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'orderManager', 'supportManager'], 'return:updated', payload);
  try {
    await notifyUser({
      userId: returnRequest.user, type: 'return', title, message, data: payload,
      action: { type: 'order', value: String(returnRequest.order), label: 'View return' }, createdBy,
    });
  } catch (error) { console.error('Return notification failed', error.message); }
};

const requestedQuantities = async (orderId) => {
  const returns = await ReturnRequest.find({ order: orderId, status: { $in: OPEN_RETURN_STATUSES } }).select('items').lean();
  const quantities = new Map();
  returns.flatMap((entry) => entry.items).forEach((item) => {
    const key = String(item.orderItemId);
    quantities.set(key, (quantities.get(key) || 0) + item.quantity);
  });
  return quantities;
};

const restoreOrderAfterClosedReturn = async (orderId) => {
  const anotherReturn = await ReturnRequest.exists({ order: orderId, status: { $in: OPEN_RETURN_STATUSES } });
  if (!anotherReturn) {
    const order = await Order.findById(orderId);
    if (order?.orderStatus === 'returnRequested') {
      order.orderStatus = 'delivered';
      order.statusHistory.push({ status: 'delivered', note: 'Return request closed without a completed return', changedByType: 'system' });
      await order.save();
    }
  }
};

const requestReturn = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.body.orderId, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.orderStatus !== 'delivered' || !order.deliveredAt) throw new AppError('Only delivered orders can be returned', 409, 'ORDER_NOT_RETURNABLE');
  const windowDays = await getReturnWindowDays();
  if (Date.now() > order.deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000) {
    throw new AppError(`Return window of ${windowDays} days has expired`, 422, 'RETURN_WINDOW_EXPIRED');
  }
  const requestedItems = parseJson(req.body.items, []);
  if (!Array.isArray(requestedItems) || !requestedItems.length) throw new AppError('At least one return item is required', 422, 'RETURN_ITEMS_REQUIRED');
  const previousQuantities = await requestedQuantities(order._id);
  const items = [];
  for (const request of requestedItems) {
    const orderItem = order.items.id(request.orderItemId);
    if (!orderItem) throw new AppError('Return references an invalid order item', 422, 'INVALID_ORDER_ITEM');
    const quantity = Number(request.quantity);
    const buybackQuantity = Number(orderItem.buybackReservedQuantity || 0)
      + Number(orderItem.buybackCompletedQuantity || 0);
    const available = orderItem.quantity
      - (previousQuantities.get(String(orderItem._id)) || 0)
      - buybackQuantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) {
      throw new AppError(`Invalid return quantity for SKU ${orderItem.sku}`, 422, 'INVALID_RETURN_QUANTITY');
    }
    if (!request.reason || !request.condition || !request.resolution) {
      throw new AppError('Reason, condition, and resolution are required for every item', 422, 'INCOMPLETE_RETURN_ITEM');
    }
    if (!['refund', 'storeCredit'].includes(request.resolution)) {
      throw new AppError('Resolution must be refund or store credit', 422, 'INVALID_RETURN_RESOLUTION');
    }
    items.push({
      orderItemId: orderItem._id,
      product: orderItem.product,
      variantId: orderItem.variantId,
      sku: orderItem.sku,
      name: orderItem.name,
      quantity,
      unitPrice: orderItem.unitPrice,
      reason: request.reason,
      reasonDetails: request.reasonDetails,
      condition: request.condition,
      resolution: request.resolution,
      images: [],
    });
  }

  const uploadedAssets = [];
  try {
    const imageItemIndexes = parseJson(req.body.imageItemIndexes, []);
    const files = flattenFiles(req.files);
    for (let index = 0; index < files.length; index += 1) {
      const itemIndex = imageItemIndexes[index] !== undefined ? Number(imageItemIndexes[index]) : 0;
      if (!Number.isInteger(itemIndex) || !items[itemIndex]) throw new AppError('Evidence image references an invalid return item', 422, 'INVALID_RETURN_IMAGE_INDEX');
      const uploaded = await uploadBuffer(files[index], {
        folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/returns`,
      });
      uploadedAssets.push(uploaded);
      items[itemIndex].images.push({ url: uploaded.url, publicId: uploaded.publicId });
    }
    const pickupAddress = parseJson(req.body.pickupAddress, order.shippingAddress);
    let returnRequest;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        [returnRequest] = await ReturnRequest.create([{
          returnNumber: generateReferenceNumber('RET'),
          order: order._id,
          user: req.user.id,
          items,
          pickupAddress,
          status: 'requested',
          requestedAt: new Date(),
          statusHistory: [{ status: 'requested', note: 'Return requested by customer', changedBy: req.user.id }],
        }], { session });
        order.orderStatus = 'returnRequested';
        order.statusHistory.push({ status: 'returnRequested', note: `Return ${returnRequest.returnNumber} requested`, changedByType: 'user', changedBy: req.user.id });
        await order.save({ session });
      });
    } finally {
      await session.endSession();
    }
    await logAudit(req, {
      action: 'create', resourceType: 'Return', resourceId: returnRequest._id, resourceLabel: returnRequest.returnNumber,
      description: 'Customer requested a return', statusCode: 201,
    });
    await notifyReturnUpdate(returnRequest, 'Return request received', `Your return ${returnRequest.returnNumber} is under review.`);
    try {
      await notifyRoles({
        roles: ['superAdmin', 'admin', 'orderManager', 'supportManager'], type: 'return', title: 'New return request',
        message: `Return ${returnRequest.returnNumber} requires review.`, data: { returnId: returnRequest._id, orderId: order._id }, priority: 'high',
      });
    } catch (error) { console.error('Return admin notification failed', error.message); }
    return ApiResponse.success(res, { statusCode: 201, message: 'Return requested', data: returnRequest });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const listMyReturns = asyncHandler(async (req, res) => {
  const returns = await ReturnRequest.find({ user: req.user.id }).populate('order', 'orderNumber deliveredAt').sort({ createdAt: -1 }).lean();
  return ApiResponse.success(res, { data: returns });
});

const getMyReturn = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findOne({ _id: req.params.returnId, user: req.user.id }).populate('order', 'orderNumber orderStatus');
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  return ApiResponse.success(res, { data: returnRequest });
});

const cancelReturn = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findOne({ _id: req.params.returnId, user: req.user.id });
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (!['requested', 'underReview'].includes(returnRequest.status)) throw new AppError('This return can no longer be cancelled', 409, 'RETURN_NOT_CANCELLABLE');
  addStatusHistory(returnRequest, 'cancelled', req.body.reason || 'Cancelled by customer', req.user.id);
  await returnRequest.save();
  await restoreOrderAfterClosedReturn(returnRequest.order);
  await logAudit(req, { action: 'cancel', resourceType: 'Return', resourceId: returnRequest._id, description: 'Customer cancelled return request', statusCode: 200 });
  await notifyReturnUpdate(returnRequest, 'Return cancelled', `Return ${returnRequest.returnNumber} was cancelled.`);
  return ApiResponse.success(res, { message: 'Return cancelled', data: returnRequest });
});

const listReturnsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.orderId && mongoose.isValidObjectId(req.query.orderId)) baseFilter.order = req.query.orderId;
  if (req.query.search) {
    const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      baseFilter.$or = [
        { returnNumber: new RegExp(escaped, 'i') },
        { 'items.sku': new RegExp(escaped, 'i') },
        { 'items.name': new RegExp(escaped, 'i') },
      ];
    }
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [returns, total, summary] = await Promise.all([
    ReturnRequest.find(filter).populate('user', 'firstName lastName email phone').populate('order', 'orderNumber grandTotal')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ReturnRequest.countDocuments(filter),
    summarizeStatusFields(ReturnRequest, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: returns,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getReturnAdmin = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId).populate('user', 'firstName lastName email phone').populate('order');
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  return ApiResponse.success(res, { data: returnRequest });
});

const reviewReturn = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (!['requested', 'underReview'].includes(returnRequest.status)) throw new AppError('Return has already been reviewed', 409, 'RETURN_ALREADY_REVIEWED');
  const decision = req.body.decision;
  if (!['approve', 'reject'].includes(decision)) throw new AppError('Decision must be approve or reject', 422, 'INVALID_DECISION');
  returnRequest.reviewedAt = new Date();
  returnRequest.reviewedBy = req.user.id;
  if (decision === 'reject') {
    if (!req.body.reason) throw new AppError('Rejection reason is required', 422, 'REJECTION_REASON_REQUIRED');
    addStatusHistory(returnRequest, 'rejected', req.body.reason, req.user.id);
    returnRequest.rejectionReason = req.body.reason;
  } else {
    addStatusHistory(returnRequest, 'approved', req.body.note || 'Return approved', req.user.id);
  }
  await returnRequest.save();
  if (decision === 'reject') await restoreOrderAfterClosedReturn(returnRequest.order);
  await logAudit(req, {
    action: decision === 'approve' ? 'approve' : 'reject', resourceType: 'Return', resourceId: returnRequest._id,
    resourceLabel: returnRequest.returnNumber, description: `Return request ${decision}d`, statusCode: 200,
  });
  await notifyReturnUpdate(
    returnRequest,
    decision === 'approve' ? 'Return approved' : 'Return rejected',
    decision === 'approve' ? `Return ${returnRequest.returnNumber} was approved.` : `Return ${returnRequest.returnNumber} was rejected.`,
    req.user.id,
  );
  return ApiResponse.success(res, { message: `Return ${decision}d`, data: returnRequest });
});

const scheduleReturnPickup = asyncHandler(async (req, res) => {
  const provider = req.body.provider || 'blueDart';
  if (!['blueDart', 'customer', 'manual'].includes(provider)) throw new AppError('Invalid return shipping provider', 422, 'INVALID_RETURN_PROVIDER');

  if (provider !== 'blueDart') {
    const returnRequest = await ReturnRequest.findById(req.params.returnId);
    if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
    if (returnRequest.status !== 'approved') throw new AppError('Only an approved return can be scheduled for pickup', 409, 'INVALID_RETURN_STATUS');
    const awbNumber = String(req.body.awbNumber || '').trim().toUpperCase();
    returnRequest.returnShippingProvider = provider;
    returnRequest.returnAwbNumber = awbNumber || undefined;
    returnRequest.pickupScheduledAt = req.body.pickupScheduledAt ? new Date(req.body.pickupScheduledAt) : new Date();
    if (Number.isNaN(returnRequest.pickupScheduledAt.getTime())) throw new AppError('Invalid pickup date', 422, 'INVALID_PICKUP_DATE');
    addStatusHistory(returnRequest, 'pickupScheduled', req.body.note || `Return handover scheduled with ${provider}`, req.user.id);
    await returnRequest.save();
    await logAudit(req, { action: 'update', resourceType: 'Return', resourceId: returnRequest._id, resourceLabel: returnRequest.returnNumber, description: 'Manual return handover scheduled', statusCode: 200 });
    await notifyReturnUpdate(returnRequest, 'Return handover scheduled', `Handover for ${returnRequest.returnNumber} has been scheduled.`, req.user.id);
    return ApiResponse.success(res, { message: 'Return handover scheduled', data: returnRequest });
  }

  const idempotencyKey = validIdempotencyKey(req);
  const weight = Number(req.body.weight);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw new AppError('Weight must be between 0 and 100 kg', 422, 'INVALID_WEIGHT');
  const dimensions = {
    length: Number(req.body.length) || undefined,
    width: Number(req.body.width) || undefined,
    height: Number(req.body.height) || undefined,
    unit: 'cm',
  };
  const suppliedDimensions = [dimensions.length, dimensions.width, dimensions.height].filter((value) => value !== undefined);
  if (suppliedDimensions.length && (suppliedDimensions.length !== 3 || suppliedDimensions.some((value) => value <= 0 || value > 500))) {
    throw new AppError('Length, width, and height must all be between 0 and 500 cm', 422, 'INVALID_DIMENSIONS');
  }
  const packageDimensions = suppliedDimensions.length ? dimensions : undefined;
  const pickupScheduledAt = new Date(req.body.pickupScheduledAt);
  if (Number.isNaN(pickupScheduledAt.getTime())) throw new AppError('A valid pickup date is required', 422, 'INVALID_PICKUP_DATE');

  const existing = await ReturnRequest.findById(req.params.returnId).select('+reversePickup.idempotencyKey');
  if (!existing) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (existing.reversePickup?.idempotencyKey === idempotencyKey
    && ['pickupScheduled', 'pickedUp', 'inTransit', 'received'].includes(existing.reversePickup.status)) {
    const safeExisting = await ReturnRequest.findById(existing._id);
    return ApiResponse.success(res, { message: 'Reverse pickup already scheduled', data: safeExisting });
  }
  if (existing.status !== 'approved') throw new AppError('Only an approved return can be scheduled for pickup', 409, 'INVALID_RETURN_STATUS');

  const returnRequest = await ReturnRequest.findOneAndUpdate(
    {
      _id: existing._id,
      status: 'approved',
      $or: [
        { 'reversePickup.status': { $in: ['notScheduled', 'failed', 'cancelled'] } },
        { 'reversePickup.status': { $exists: false } },
      ],
    },
    {
      $set: {
        returnShippingProvider: 'blueDart',
        'reversePickup.status': 'creating',
        'reversePickup.idempotencyKey': idempotencyKey,
        'reversePickup.requestedPickupAt': pickupScheduledAt,
        'reversePickup.weight': weight,
        'reversePickup.weightUnit': 'kg',
        ...(packageDimensions ? { 'reversePickup.dimensions': packageDimensions } : {}),
        'reversePickup.createdBy': req.user.id,
      },
      $unset: {
        'reversePickup.failureCode': 1,
        'reversePickup.failureReason': 1,
        'reversePickup.cancelledAt': 1,
        'reversePickup.cancellationReason': 1,
      },
    },
    { new: true, runValidators: true },
  ).select('+reversePickup.idempotencyKey');
  if (!returnRequest) throw new AppError('Reverse pickup is already being created', 409, 'RETURN_PICKUP_IN_PROGRESS');

  let waybill;
  let pickupRegistration;
  try {
    const order = await Order.findById(returnRequest.order);
    if (!order) throw new AppError('Original order not found', 409, 'ORDER_NOT_FOUND');
    const store = blueDartStore();
    const serviceability = await checkServiceability({
      destinationPostalCode: returnRequest.pickupAddress.postalCode,
      productCode: process.env.BLUE_DART_REVERSE_PRODUCT_CODE || process.env.BLUE_DART_PRODUCT_CODE || 'A',
    });
    if (serviceability.serviceable === false) throw new AppError('Blue Dart reverse pickup is not available at this pincode', 422, 'PICKUP_NOT_SERVICEABLE');
    const areaCode = serviceability.areaCode
      || process.env.BLUE_DART_REVERSE_ORIGIN_AREA
      || process.env.BLUE_DART_ORIGIN_AREA;
    if (!areaCode) throw new AppError('Blue Dart reverse pickup area code is unavailable', 422, 'PICKUP_AREA_UNAVAILABLE');
    const declaredValue = returnDeclaredValue(order, returnRequest);

    waybill = await createReverseWaybill({
      returnNumber: returnRequest.returnNumber,
      order,
      returnRequest,
      items: returnRequest.items,
      declaredValue,
      weight,
      dimensions: packageDimensions,
      store,
      areaCode,
      pickupAt: pickupScheduledAt,
    });
    pickupRegistration = await registerReversePickup({
      awbNumber: waybill.awbNumber,
      returnNumber: returnRequest.returnNumber,
      pickupAddress: returnRequest.pickupAddress,
      weight,
      pickupAt: pickupScheduledAt,
      areaCode,
      remarks: req.body.note,
    });

    let labelUrl;
    try {
      labelUrl = await uploadReturnLabel(waybill);
    } catch (labelError) {
      console.error('Reverse pickup label upload failed', labelError.message);
    }
    const registrationDate = new Date();
    returnRequest.returnAwbNumber = waybill.awbNumber;
    returnRequest.pickupScheduledAt = pickupScheduledAt;
    returnRequest.reversePickup.status = 'pickupScheduled';
    returnRequest.reversePickup.awbNumber = waybill.awbNumber;
    returnRequest.reversePickup.tokenNumber = pickupRegistration.tokenNumber;
    returnRequest.reversePickup.registrationDate = registrationDate;
    returnRequest.reversePickup.areaCode = areaCode;
    returnRequest.reversePickup.labelUrl = labelUrl || waybill.labelUrl;
    returnRequest.reversePickup.labelBase64 = labelUrl ? undefined : waybill.labelBase64;
    returnRequest.reversePickup.providerMetadata = new Map([
      ['registrationStatus', pickupRegistration.status],
      ['serviceabilityFallback', String(Boolean(serviceability.checkUnavailable))],
    ]);
    addStatusHistory(returnRequest, 'pickupScheduled', req.body.note || `Blue Dart reverse pickup scheduled (AWB ${waybill.awbNumber})`, req.user.id);
    await returnRequest.save();
  } catch (error) {
    if (pickupRegistration?.tokenNumber) {
      try {
        await cancelRegisteredPickup({ tokenNumber: pickupRegistration.tokenNumber, registrationDate: new Date(), remarks: 'Application rollback after setup failure' });
      } catch (cleanupError) { console.error('Reverse pickup rollback failed', cleanupError.message); }
    }
    if (waybill?.awbNumber) {
      try { await cancelWaybill({ awbNumber: waybill.awbNumber }); } catch (cleanupError) { console.error('Reverse AWB rollback failed', cleanupError.message); }
    }
    await ReturnRequest.updateOne(
      { _id: returnRequest._id, 'reversePickup.idempotencyKey': idempotencyKey, 'reversePickup.status': 'creating' },
      {
        $set: {
          'reversePickup.status': 'failed',
          'reversePickup.failureCode': error.code || 'REVERSE_PICKUP_FAILED',
          'reversePickup.failureReason': String(error.message || 'Reverse pickup failed').slice(0, 1000),
        },
      },
    );
    throw error;
  }

  await logAudit(req, { action: 'create', resourceType: 'ReturnPickup', resourceId: returnRequest._id, resourceLabel: returnRequest.returnNumber, description: `Blue Dart reverse pickup created with AWB ${returnRequest.returnAwbNumber}`, statusCode: 201 });
  await notifyReturnUpdate(returnRequest, 'Return pickup scheduled', `Blue Dart will collect return ${returnRequest.returnNumber}. Tracking number: ${returnRequest.returnAwbNumber}.`, req.user.id);
  const safeReturnRequest = await ReturnRequest.findById(returnRequest._id);
  return ApiResponse.success(res, { statusCode: 201, message: 'Blue Dart reverse pickup scheduled', data: safeReturnRequest });
});

const syncReversePickup = async (returnRequest, changedBy) => {
  if (returnRequest.returnShippingProvider !== 'blueDart' || !returnRequest.reversePickup?.awbNumber) {
    throw new AppError('This return does not have a Blue Dart reverse pickup', 409, 'REVERSE_PICKUP_NOT_AVAILABLE');
  }
  const payload = await trackShipment(returnRequest.reversePickup.awbNumber);
  const result = applyReverseTracking(returnRequest, payload, changedBy);
  await returnRequest.save();
  if (result.statusChanged) {
    await notifyReturnUpdate(returnRequest, 'Return shipment updated', `Return ${returnRequest.returnNumber} is now ${returnRequest.status}.`, changedBy);
  }
  return returnRequest;
};

const trackReturnPickupAdmin = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  await syncReversePickup(returnRequest, req.user.id);
  return ApiResponse.success(res, { message: 'Reverse pickup tracking refreshed', data: returnRequest });
});

const trackMyReturnPickup = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findOne({ _id: req.params.returnId, user: req.user.id });
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  await syncReversePickup(returnRequest);
  return ApiResponse.success(res, { message: 'Reverse pickup tracking refreshed', data: returnRequest });
});

const cancelReturnPickupAdmin = asyncHandler(async (req, res) => {
  const idempotencyKey = validIdempotencyKey(req);
  const returnRequest = await ReturnRequest.findById(req.params.returnId)
    .select('+reversePickup.cancelIdempotencyKey');
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (returnRequest.reversePickup?.cancelIdempotencyKey === idempotencyKey && returnRequest.reversePickup.status === 'cancelled') {
    const safeExisting = await ReturnRequest.findById(returnRequest._id);
    return ApiResponse.success(res, { message: 'Reverse pickup already cancelled', data: safeExisting });
  }
  if (returnRequest.returnShippingProvider !== 'blueDart' || returnRequest.reversePickup?.status !== 'pickupScheduled') {
    throw new AppError('Only a scheduled Blue Dart pickup can be cancelled', 409, 'RETURN_PICKUP_NOT_CANCELLABLE');
  }

  await syncReversePickup(returnRequest, req.user.id);
  if (returnRequest.reversePickup.status !== 'pickupScheduled' || returnRequest.status !== 'pickupScheduled') {
    throw new AppError('Pickup can no longer be cancelled because Blue Dart has started movement', 409, 'RETURN_PICKUP_NOT_CANCELLABLE');
  }
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw new AppError('A cancellation reason of 5 to 1000 characters is required', 422, 'CANCELLATION_REASON_REQUIRED');
  const locked = await ReturnRequest.findOneAndUpdate(
    { _id: returnRequest._id, status: 'pickupScheduled', 'reversePickup.status': 'pickupScheduled' },
    { $set: { 'reversePickup.status': 'cancelling', 'reversePickup.cancelIdempotencyKey': idempotencyKey } },
    { new: true, runValidators: true },
  ).select('+reversePickup.cancelIdempotencyKey');
  if (!locked) throw new AppError('Reverse pickup cancellation is already in progress', 409, 'RETURN_PICKUP_CANCELLATION_IN_PROGRESS');
  try {
    await cancelRegisteredPickup({
      tokenNumber: locked.reversePickup.tokenNumber,
      registrationDate: locked.reversePickup.registrationDate,
      remarks: reason,
    });
    try { await cancelWaybill({ awbNumber: locked.reversePickup.awbNumber }); } catch (error) { console.error('Reverse AWB cancellation failed after pickup cancellation', error.message); }
    locked.reversePickup.status = 'cancelled';
    locked.reversePickup.cancelledAt = new Date();
    locked.reversePickup.cancellationReason = reason;
    addStatusHistory(locked, 'approved', `Blue Dart reverse pickup cancelled: ${reason}`, req.user.id);
    await locked.save();
  } catch (error) {
    await ReturnRequest.updateOne(
      { _id: locked._id, 'reversePickup.cancelIdempotencyKey': idempotencyKey, 'reversePickup.status': 'cancelling' },
      { $set: { 'reversePickup.status': 'pickupScheduled' }, $unset: { 'reversePickup.cancelIdempotencyKey': 1 } },
    );
    throw error;
  }
  await logAudit(req, { action: 'cancel', resourceType: 'ReturnPickup', resourceId: locked._id, resourceLabel: locked.returnNumber, description: 'Blue Dart reverse pickup cancelled', statusCode: 200 });
  await notifyReturnUpdate(locked, 'Return pickup cancelled', `Blue Dart pickup for ${locked.returnNumber} was cancelled.`, req.user.id);
  const safeReturnRequest = await ReturnRequest.findById(locked._id);
  return ApiResponse.success(res, { message: 'Blue Dart reverse pickup cancelled', data: safeReturnRequest });
});

const getReturnLabelAdmin = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId).select('+reversePickup.labelBase64');
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (!returnRequest.reversePickup?.awbNumber) throw new AppError('Return label is not available', 404, 'RETURN_LABEL_NOT_FOUND');
  let pdf;
  if (returnRequest.reversePickup.labelUrl) {
    const url = new URL(returnRequest.reversePickup.labelUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new AppError('Stored return label URL is invalid', 500, 'INVALID_LABEL_URL');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) pdf = Buffer.from(await response.arrayBuffer());
  }
  if (!isPdfBuffer(pdf) && returnRequest.reversePickup.labelBase64) {
    pdf = shippingLabelPdfBuffer(returnRequest.reversePickup.labelBase64);
  }
  if (!isPdfBuffer(pdf)) throw new AppError('Blue Dart return label is not available as a PDF', 502, 'RETURN_LABEL_UNAVAILABLE');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="return-label-${returnRequest.reversePickup.awbNumber}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(pdf);
});

const markReturnPickedUp = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (returnRequest.returnShippingProvider === 'blueDart') throw new AppError('Blue Dart pickup status must come from carrier tracking', 409, 'CARRIER_TRACKING_REQUIRED');
  if (returnRequest.status !== 'pickupScheduled') throw new AppError('Return pickup has not been scheduled', 409, 'INVALID_RETURN_STATUS');
  returnRequest.pickedUpAt = new Date();
  addStatusHistory(returnRequest, 'pickedUp', req.body.note || 'Return package picked up', req.user.id);
  await returnRequest.save();
  await logAudit(req, { action: 'update', resourceType: 'Return', resourceId: returnRequest._id, resourceLabel: returnRequest.returnNumber, description: 'Return marked picked up', statusCode: 200 });
  await notifyReturnUpdate(returnRequest, 'Return picked up', `Return ${returnRequest.returnNumber} is on its way to our inspection team.`, req.user.id);
  return ApiResponse.success(res, { message: 'Return marked as picked up', data: returnRequest });
});

const markReturnReceived = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (returnRequest.returnShippingProvider === 'blueDart') throw new AppError('Blue Dart delivery status must come from carrier tracking', 409, 'CARRIER_TRACKING_REQUIRED');
  if (!['approved', 'pickupScheduled', 'pickedUp'].includes(returnRequest.status)) throw new AppError('Return is not ready to be received', 409, 'INVALID_RETURN_STATUS');
  addStatusHistory(returnRequest, 'received', req.body.note || 'Return package received', req.user.id);
  returnRequest.receivedAt = new Date();
  await returnRequest.save();
  await notifyReturnUpdate(returnRequest, 'Return received', `Return ${returnRequest.returnNumber} has reached our inspection team.`, req.user.id);
  return ApiResponse.success(res, { message: 'Return marked as received', data: returnRequest });
});

const restockSellableReturnItem = async ({ returnRequest, item, actorId, session }) => {
  if (item.restockedAt || !['unopened', 'unused'].includes(item.condition)) return;
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
      source: 'return',
      quantityBefore: Math.max(0, snapshot.stock - Number(item.quantity || 0)),
      quantityAfter: snapshot.stock,
      reservedBefore: snapshot.reservedStock,
      reservedAfter: snapshot.reservedStock,
      reason: 'Inspection approved sellable return',
      actor: actorId,
      reference: { model: 'Return', id: returnRequest._id, label: returnRequest.returnNumber },
      session,
    });
  }
  item.restockedAt = new Date();
};

const inspectReturn = asyncHandler(async (req, res) => {
  if (!Array.isArray(req.body.items) || !req.body.items.length) throw new AppError('Inspection decisions are required', 422, 'INSPECTION_REQUIRED');
  const session = await mongoose.startSession();
  let returnRequest;
  let approvedItems = 0;
  try {
    await session.withTransaction(async () => {
      returnRequest = await ReturnRequest.findById(req.params.returnId).session(session);
      if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
      if (returnRequest.status !== 'received') throw new AppError('Return must be received before inspection', 409, 'INVALID_RETURN_STATUS');
      const order = await Order.findById(returnRequest.order).session(session);
      if (!order) throw new Error('Return order is missing');
      let approvedAmount = 0;
      for (const decision of req.body.items) {
        const item = returnRequest.items.id(decision.returnItemId);
        if (!item) throw new AppError('Invalid return item in inspection', 422, 'INVALID_RETURN_ITEM');
        if (!['approved', 'rejected'].includes(decision.status)) throw new AppError('Inspection status must be approved or rejected', 422, 'INVALID_INSPECTION_STATUS');
        item.inspectionStatus = decision.status;
        item.inspectionNote = decision.note;
        const orderItem = order.items.id(item.orderItemId);
        if (!orderItem) throw new Error('Original order item is missing');
        const maximumRefund = Math.round((orderItem.lineTotal / orderItem.quantity) * item.quantity * 100) / 100;
        item.approvedAmount = decision.status === 'approved'
          ? Math.min(Number(decision.approvedAmount ?? maximumRefund), maximumRefund)
          : 0;
        if (!Number.isFinite(item.approvedAmount) || item.approvedAmount < 0) throw new AppError('Invalid approved refund amount', 422, 'INVALID_REFUND_AMOUNT');
        if (decision.status === 'approved') {
          approvedItems += 1;
          await restockSellableReturnItem({ returnRequest, item, actorId: req.user.id, session });
        }
        approvedAmount += item.approvedAmount;
      }
      if (returnRequest.items.some((item) => item.inspectionStatus === 'pending')) throw new AppError('Every return item must be inspected', 422, 'INSPECTION_INCOMPLETE');
      returnRequest.totalApprovedAmount = Math.round(approvedAmount * 100) / 100;
      addStatusHistory(
        returnRequest,
        approvedItems > 0 ? 'inspected' : 'rejected',
        approvedItems > 0 ? 'Return inspection completed' : 'No returned items passed inspection',
        req.user.id,
      );
      if (!approvedItems) returnRequest.rejectionReason = 'No returned items passed inspection';
      await returnRequest.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await logAudit(req, {
    action: approvedItems > 0 ? 'approve' : 'reject', resourceType: 'Return', resourceId: returnRequest._id,
    description: 'Return inspection completed', statusCode: 200,
  });
  await notifyReturnUpdate(returnRequest, 'Return inspection completed', `Return ${returnRequest.returnNumber} inspection is complete.`, req.user.id);
  return ApiResponse.success(res, { message: 'Return inspection completed', data: returnRequest });
});

const completeReturnResolution = asyncHandler(async (req, res) => {
  const returnRequest = await ReturnRequest.findById(req.params.returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404, 'RETURN_NOT_FOUND');
  if (returnRequest.status !== 'inspected') throw new AppError('Return must pass inspection before completion', 409, 'INVALID_RETURN_STATUS');
  const approvedItems = returnRequest.items.filter((item) => item.inspectionStatus === 'approved');
  if (approvedItems.some((item) => item.resolution === 'refund' && item.approvedAmount > 0)) {
    throw new AppError('Payment refund must be initiated for approved refund items', 409, 'REFUND_REQUIRED');
  }
  const reference = String(req.body.reference || '').trim();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(returnRequest.order).session(session);
      if (!order) throw new Error('Return order is missing');
      for (const item of approvedItems) {
        await restockSellableReturnItem({ returnRequest, item, actorId: req.user.id, session });
        const orderItem = order.items.id(item.orderItemId);
        if (orderItem && item.quantity >= orderItem.quantity) orderItem.fulfillmentStatus = 'returned';
      }
      const fullyReturned = order.items.every((item) => item.fulfillmentStatus === 'returned');
      order.orderStatus = fullyReturned ? 'returned' : 'delivered';
      order.fulfillmentStatus = fullyReturned ? 'returned' : 'partiallyReturned';
      order.statusHistory.push({ status: order.orderStatus, note: `Return ${returnRequest.returnNumber} resolution completed`, changedByType: 'admin', changedBy: req.user.id });
      await order.save({ session });

      returnRequest.resolutionReference = reference || undefined;
      returnRequest.resolutionNote = req.body.note;
      returnRequest.completedAt = new Date();
      addStatusHistory(returnRequest, 'completed', req.body.note || 'Return resolution completed', req.user.id);
      await returnRequest.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await logAudit(req, { action: 'update', resourceType: 'Return', resourceId: returnRequest._id, resourceLabel: returnRequest.returnNumber, description: 'Return resolution completed', statusCode: 200 });
  await notifyReturnUpdate(returnRequest, 'Return completed', `Return ${returnRequest.returnNumber} has been completed.`, req.user.id);
  return ApiResponse.success(res, { message: 'Return resolution completed', data: returnRequest });
});

module.exports = {
  requestReturn, listMyReturns, getMyReturn, cancelReturn, listReturnsAdmin,
  getReturnAdmin, reviewReturn, scheduleReturnPickup, markReturnPickedUp,
  markReturnReceived, inspectReturn, completeReturnResolution, trackReturnPickupAdmin,
  trackMyReturnPickup, cancelReturnPickupAdmin, getReturnLabelAdmin,
};
