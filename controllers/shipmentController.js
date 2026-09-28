const mongoose = require('mongoose');
const Shipment = require('../models/shipmentModel');
const Order = require('../models/orderModel');
const ReturnRequest = require('../models/returnModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const {
  checkServiceability, createWaybill, updateWaybill, cancelWaybill,
  trackShipment, verifyWebhookSignature,
} = require('../utils/blueDartUtils');
const { uploadBuffer } = require('../utils/cloudinaryUtils');
const { generateReferenceNumber } = require('../utils/orderNumberUtils');
const { notifyUser, notifyRoles, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { isPdfBuffer, shippingLabelPdfBuffer } = require('../utils/shippingLabelUtils');
const { shipmentStatus, mergeTrackingEvents } = require('../utils/blueDartTrackingUtils');
const { applyReverseTracking } = require('../utils/returnTrackingUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const mergeTracking = (shipment, payload) => {
  const previousStatus = shipment.status;
  const { addedEvents, latest } = mergeTrackingEvents(shipment, payload);
  if (latest) shipment.status = shipmentStatus(latest.status);
  shipment.lastTrackedAt = new Date();
  if (shipment.status === 'pickedUp' && !shipment.pickedUpAt) shipment.pickedUpAt = latest?.occurredAt || new Date();
  if (shipment.status === 'delivered' && !shipment.deliveredAt) shipment.deliveredAt = latest?.occurredAt || new Date();
  return { addedEvents, statusChanged: shipment.status !== previousStatus };
};

const notifyShipmentUpdate = async (shipment) => {
  const payload = { shipmentId: shipment._id, orderId: shipment.order, awbNumber: shipment.awbNumber, status: shipment.status };
  emitToUser(shipment.user, 'shipment:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'orderManager'], 'shipment:updated', payload);
  try {
    await notifyUser({
      userId: shipment.user, type: 'shipment', title: 'Shipment updated',
      message: `Shipment ${shipment.awbNumber} is now ${shipment.status}.`, data: payload,
      action: { type: 'order', value: String(shipment.order), label: 'Track order' },
    });
  } catch (error) { console.error('Shipment customer notification failed', error.message); }
};

const synchronizeDeliveredOrder = async (shipment) => {
  if (shipment.status !== 'delivered') return;
  const remaining = await Shipment.exists({ order: shipment.order, _id: { $ne: shipment._id }, status: { $nin: ['delivered', 'cancelled', 'returned'] } });
  if (!remaining) {
    const order = await Order.findById(shipment.order);
    if (order && !['delivered', 'closed', 'returned'].includes(order.orderStatus)) {
      order.orderStatus = 'delivered';
      order.fulfillmentStatus = 'delivered';
      order.deliveredAt = shipment.deliveredAt || new Date();
      order.items.forEach((item) => { if (item.fulfillmentStatus === 'shipped') item.fulfillmentStatus = 'delivered'; });
      order.statusHistory.push({ status: 'delivered', note: 'All shipments delivered', changedByType: 'system' });
      await order.save();
    }
  }
};

const serviceability = asyncHandler(async (req, res) => {
  const originPostalCode = req.query.originPostalCode || process.env.BLUE_DART_PICKUP_POSTAL_CODE;
  const destinationPostalCode = req.query.destinationPostalCode;
  if (!/^\d{6}$/.test(String(originPostalCode || '')) || !/^\d{6}$/.test(String(destinationPostalCode || ''))) {
    throw new AppError('Valid six-digit origin and destination postal codes are required', 422, 'INVALID_POSTAL_CODE');
  }
  const result = await checkServiceability({ originPostalCode, destinationPostalCode });
  return ApiResponse.success(res, { data: result });
});

const resolveOrderReference = async (identifier, userId) => {
  const value = String(identifier || '').trim();
  if (!value) return undefined;
  if (mongoose.isValidObjectId(value)) return value;

  const filter = { orderNumber: value.toUpperCase() };
  if (userId) filter.user = userId;
  const order = await Order.findOne(filter).select('_id').lean();
  return order?._id || null;
};

const listEligibleOrders = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const orders = await Order.find({
    paymentStatus: 'paid',
    orderStatus: { $nin: ['cancelled', 'returned', 'delivered', 'closed'] },
  })
    .populate('user', 'firstName lastName email phone')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const activeShipments = orders.length
    ? await Shipment.find({
      order: { $in: orders.map((order) => order._id) },
      status: { $nin: ['cancelled', 'returned'] },
    }).select('order items').lean()
    : [];
  const shippedByOrderItem = new Map();

  activeShipments.forEach((shipment) => {
    shipment.items.forEach((item) => {
      const key = `${shipment.order}:${item.orderItemId}`;
      shippedByOrderItem.set(key, (shippedByOrderItem.get(key) || 0) + item.quantity);
    });
  });

  const eligibleOrders = orders.map((order) => {
    const remainingItems = order.items.map((item) => ({
      orderItemId: item._id,
      sku: item.sku,
      name: item.name,
      orderedQuantity: item.quantity,
      remainingQuantity: Math.max(
        0,
        item.quantity - (shippedByOrderItem.get(`${order._id}:${item._id}`) || 0),
      ),
    })).filter((item) => item.remainingQuantity > 0);
    return { ...order, remainingItems };
  }).filter((order) => order.remainingItems.length > 0);

  return ApiResponse.success(res, { data: eligibleOrders });
});

const buildPickupConfig = () => {
  const pickup = {
    name: process.env.BLUE_DART_PICKUP_NAME,
    line1: process.env.BLUE_DART_PICKUP_LINE1,
    line2: process.env.BLUE_DART_PICKUP_LINE2,
    city: process.env.BLUE_DART_PICKUP_CITY,
    state: process.env.BLUE_DART_PICKUP_STATE,
    postalCode: process.env.BLUE_DART_PICKUP_POSTAL_CODE,
    phone: process.env.BLUE_DART_PICKUP_PHONE,
    originArea: process.env.BLUE_DART_ORIGIN_AREA,
    vendorCode: process.env.BLUE_DART_VENDOR_CODE,
  };
  if (Object.entries(pickup).filter(([key]) => !['line2', 'vendorCode'].includes(key)).some(([, value]) => !value)) {
    throw new Error('Blue Dart pickup address configuration is incomplete');
  }
  return pickup;
};

const buildShipmentItems = async (order, requestedItems) => {
  const existingShipments = await Shipment.find({ order: order._id, status: { $ne: 'cancelled' } }).select('items').lean();
  const shippedQuantity = new Map();
  existingShipments.flatMap((entry) => entry.items).forEach((item) => {
    const key = String(item.orderItemId);
    shippedQuantity.set(key, (shippedQuantity.get(key) || 0) + item.quantity);
  });
  const requests = requestedItems?.length
    ? requestedItems
    : order.items.map((item) => ({ orderItemId: item._id, quantity: item.quantity - (shippedQuantity.get(String(item._id)) || 0) }));
  const result = [];
  for (const request of requests) {
    const orderItem = order.items.id(request.orderItemId);
    if (!orderItem) throw new AppError('Shipment references an invalid order item', 422, 'INVALID_ORDER_ITEM');
    const quantity = Number(request.quantity);
    const remaining = orderItem.quantity - (shippedQuantity.get(String(orderItem._id)) || 0);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) {
      throw new AppError(`Invalid shipment quantity for SKU ${orderItem.sku}`, 422, 'INVALID_SHIPMENT_QUANTITY');
    }
    result.push({ orderItemId: orderItem._id, sku: orderItem.sku, quantity });
  }
  if (!result.length) throw new AppError('No items remain to be shipped', 409, 'ORDER_ALREADY_SHIPPED');
  return result;
};

const createShipment = asyncHandler(async (req, res) => {
  const idempotencyKey = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new AppError('A valid Idempotency-Key header is required', 422, 'IDEMPOTENCY_KEY_REQUIRED');
  const existing = await Shipment.findOne({ referenceNumber: idempotencyKey });
  if (existing) return ApiResponse.success(res, { message: 'Existing shipment returned', data: existing });

  const order = await Order.findById(req.body.orderId);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.paymentStatus !== 'paid' || ['cancelled', 'returned'].includes(order.orderStatus)) {
    throw new AppError('Only paid active orders can be shipped', 409, 'ORDER_NOT_SHIPPABLE');
  }
  const items = await buildShipmentItems(order, req.body.items);
  const weight = Number(req.body.weight);
  if (!Number.isFinite(weight) || weight <= 0) throw new AppError('Shipment weight must be greater than zero', 422, 'INVALID_WEIGHT');

  const service = await checkServiceability({
    originPostalCode: process.env.BLUE_DART_PICKUP_POSTAL_CODE,
    destinationPostalCode: order.shippingAddress.postalCode,
  });
  if (service.serviceable === false) {
    throw new AppError('Destination is not serviceable by Blue Dart', 422, 'DESTINATION_NOT_SERVICEABLE');
  }
  const shipmentNumber = generateReferenceNumber('SHP');
  const pickup = buildPickupConfig();

  const waybill = await createWaybill({ shipmentNumber, order, items, weight, dimensions: req.body.dimensions, pickup });
  let labelUrl = waybill.labelUrl;
  if (!labelUrl && waybill.labelBase64) {
    const labelContent = shippingLabelPdfBuffer(waybill.labelBase64);
    const uploaded = await uploadBuffer(
      { buffer: labelContent, mimetype: 'application/pdf' },
      {
        folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/shipping-labels`,
        resourceType: 'raw',
        uploadOptions: { public_id: `label-${waybill.awbNumber}`, overwrite: true },
      },
    );
    labelUrl = uploaded.url;
  }
  if (!labelUrl) throw new AppError('Blue Dart did not provide a shipping label', 502, 'SHIPPING_LABEL_MISSING');

  const session = await mongoose.startSession();
  let shipment;
  try {
    await session.withTransaction(async () => {
      [shipment] = await Shipment.create([{
        shipmentNumber,
        order: order._id,
        user: order.user,
        provider: 'blueDart',
        awbNumber: waybill.awbNumber,
        referenceNumber: idempotencyKey,
        serviceType: process.env.BLUE_DART_PRODUCT_CODE || 'A',
        items,
        packageCount: 1,
        weight,
        weightUnit: req.body.weightUnit || 'kg',
        dimensions: req.body.dimensions,
        status: 'pickupScheduled',
        pickupScheduledAt: new Date(),
        trackingEvents: [{
          statusCode: 'WAYBILL_CREATED',
          status: 'Pickup Scheduled',
          description: 'Blue Dart waybill created and pickup scheduled',
          occurredAt: new Date(),
        }],
        estimatedDeliveryAt: service.expectedDeliveryDate ? new Date(service.expectedDeliveryDate) : undefined,
        labelUrl,
        providerMetadata: { waybillResponse: JSON.stringify(waybill.raw) },
      }], { session });

      const allShipments = await Shipment.find({ order: order._id, status: { $ne: 'cancelled' } }).session(session).lean();
      const totals = new Map();
      allShipments.flatMap((entry) => entry.items).forEach((item) => totals.set(String(item.orderItemId), (totals.get(String(item.orderItemId)) || 0) + item.quantity));
      order.items.forEach((item) => {
        if ((totals.get(String(item._id)) || 0) >= item.quantity) item.fulfillmentStatus = 'shipped';
      });
      const fullyShipped = order.items.every((item) => item.fulfillmentStatus === 'shipped');
      order.fulfillmentStatus = fullyShipped ? 'shipped' : 'partiallyShipped';
      if (fullyShipped) order.orderStatus = 'shipped';
      else if (order.orderStatus === 'confirmed') order.orderStatus = 'processing';
      order.statusHistory.push({ status: order.orderStatus, note: `Blue Dart AWB ${waybill.awbNumber} created`, changedByType: 'admin', changedBy: req.user.id });
      await order.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await logAudit(req, {
    action: 'create', resourceType: 'Shipment', resourceId: shipment._id, resourceLabel: shipment.awbNumber,
    description: 'Blue Dart shipment created', statusCode: 201,
  });
  await notifyShipmentUpdate(shipment);
  try {
    await notifyRoles({
      roles: ['superAdmin', 'admin', 'orderManager'], type: 'shipment', title: 'Shipment created',
      message: `AWB ${shipment.awbNumber} was created for order ${order.orderNumber}.`,
      data: { shipmentId: shipment._id, orderId: order._id }, createdBy: req.user.id,
    });
  } catch (error) { console.error('Shipment admin notification failed', error.message); }
  return ApiResponse.success(res, { statusCode: 201, message: 'Shipment created', data: shipment });
});

const refreshTracking = async (shipment) => {
  const payload = await trackShipment(shipment.awbNumber);
  const changes = mergeTracking(shipment, payload);
  await shipment.save();
  await synchronizeDeliveredOrder(shipment);
  if (changes.addedEvents || changes.statusChanged) await notifyShipmentUpdate(shipment);
  return shipment;
};

const trackMyShipment = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findOne({ _id: req.params.shipmentId, user: req.user.id });
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  await refreshTracking(shipment);
  return ApiResponse.success(res, { data: shipment });
});

const trackShipmentAdmin = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findById(req.params.shipmentId);
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  await refreshTracking(shipment);
  return ApiResponse.success(res, { data: shipment });
});

const getShipmentAdmin = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findById(req.params.shipmentId)
    .populate('order', 'orderNumber orderStatus paymentStatus fulfillmentStatus shippingAddress grandTotal')
    .populate('user', 'firstName lastName email phone');
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  return ApiResponse.success(res, { data: shipment });
});

const getShipmentLabelAdmin = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findById(req.params.shipmentId).select('awbNumber labelUrl provider');
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  if (!shipment.labelUrl) throw new AppError('Shipping label is not available', 404, 'SHIPPING_LABEL_NOT_FOUND');

  let label;
  try {
    const labelResponse = await fetch(shipment.labelUrl, { signal: AbortSignal.timeout(15000) });
    if (labelResponse.ok) label = Buffer.from(await labelResponse.arrayBuffer());
  } catch (_error) {
    label = null;
  }

  if (!isPdfBuffer(label)) {
    const rawShipment = await Shipment.collection.findOne(
      { _id: shipment._id },
      { projection: { 'providerMetadata.waybillResponse': 1 } },
    );
    let carrierLabel;
    try {
      const carrierResponse = JSON.parse(rawShipment?.providerMetadata?.waybillResponse || '{}');
      const result = carrierResponse.GenerateWayBillResult || carrierResponse.generateWayBillResult || carrierResponse;
      const waybillResult = Array.isArray(result) ? result[0] : result;
      carrierLabel = waybillResult?.AWBPrintContent || waybillResult?.labelBase64;
      label = shippingLabelPdfBuffer(carrierLabel);
    } catch (_error) {
      throw new AppError('Stored shipping label is not a valid PDF', 502, 'INVALID_SHIPPING_LABEL');
    }

    const uploaded = await uploadBuffer(
      { buffer: label, mimetype: 'application/pdf' },
      {
        folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/shipping-labels`,
        resourceType: 'raw',
        uploadOptions: { public_id: `label-${shipment.awbNumber}`, overwrite: true },
      },
    );
    shipment.labelUrl = uploaded.url;
    await shipment.save();
  }
  const filename = `BlueDart-${shipment.awbNumber || shipment._id}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Length': label.length,
    'Cache-Control': 'private, max-age=300',
  });
  return res.send(label);
});

const syncOrderAfterShipmentCancellation = async (order, cancelledShipment, session) => {
  const activeShipments = await Shipment.find({
    order: order._id,
    _id: { $ne: cancelledShipment._id },
    status: { $nin: ['cancelled', 'returned'] },
  }).session(session);
  const shippedQuantity = new Map();
  activeShipments.flatMap((entry) => entry.items).forEach((item) => {
    const key = String(item.orderItemId);
    shippedQuantity.set(key, (shippedQuantity.get(key) || 0) + item.quantity);
  });
  order.items.forEach((item) => {
    if (['delivered', 'returned', 'cancelled'].includes(item.fulfillmentStatus)) return;
    item.fulfillmentStatus = (shippedQuantity.get(String(item._id)) || 0) >= item.quantity ? 'shipped' : 'processing';
  });
  const shippedItems = order.items.filter((item) => item.fulfillmentStatus === 'shipped').length;
  order.fulfillmentStatus = shippedItems === order.items.length ? 'shipped' : shippedItems > 0 ? 'partiallyShipped' : 'processing';
  if (['shipped', 'delivered'].includes(order.orderStatus) && order.fulfillmentStatus !== 'shipped') order.orderStatus = 'processing';
  order.statusHistory.push({
    status: order.orderStatus,
    note: `Blue Dart AWB ${cancelledShipment.awbNumber} cancelled`,
    changedByType: 'admin',
  });
  await order.save({ session });
};

const updateWaybillAdmin = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findById(req.params.shipmentId).select('+providerMetadata');
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  if (shipment.provider !== 'blueDart' || !shipment.awbNumber) throw new AppError('Only Blue Dart shipments can be updated', 422, 'SHIPMENT_PROVIDER_UNSUPPORTED');
  if (!['pending', 'pickupScheduled'].includes(shipment.status)) {
    throw new AppError('Waybill can only be updated before pickup', 409, 'WAYBILL_NOT_UPDATABLE');
  }
  const weight = req.body.weight === undefined ? shipment.weight : Number(req.body.weight);
  if (!Number.isFinite(weight) || weight <= 0) throw new AppError('Shipment weight must be greater than zero', 422, 'INVALID_WEIGHT');
  const order = await Order.findById(shipment.order);
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');

  const result = await updateWaybill({
    shipment,
    order,
    weight,
    dimensions: req.body.dimensions || shipment.dimensions,
    pickup: buildPickupConfig(),
    payload: req.body.payload,
  });
  shipment.weight = weight;
  if (req.body.weightUnit) shipment.weightUnit = req.body.weightUnit;
  if (req.body.dimensions) shipment.dimensions = req.body.dimensions;
  shipment.providerMetadata = shipment.providerMetadata || new Map();
  shipment.providerMetadata.set('updateWaybillResponse', JSON.stringify(result.raw));
  await shipment.save();
  await logAudit(req, {
    action: 'update', resourceType: 'Shipment', resourceId: shipment._id, resourceLabel: shipment.awbNumber,
    description: 'Blue Dart waybill updated', statusCode: 200,
  });
  await notifyShipmentUpdate(shipment);
  return ApiResponse.success(res, { message: 'Waybill updated', data: shipment });
});

const cancelWaybillAdmin = asyncHandler(async (req, res) => {
  const shipment = await Shipment.findById(req.params.shipmentId).select('+providerMetadata');
  if (!shipment) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  if (shipment.provider !== 'blueDart' || !shipment.awbNumber) throw new AppError('Only Blue Dart shipments can be cancelled', 422, 'SHIPMENT_PROVIDER_UNSUPPORTED');
  if (!['pending', 'pickupScheduled'].includes(shipment.status)) {
    throw new AppError('Waybill can only be cancelled before pickup', 409, 'WAYBILL_NOT_CANCELLABLE');
  }
  const reason = String(req.body.reason || 'Cancelled by administration').trim().slice(0, 1000);
  const result = await cancelWaybill({ awbNumber: shipment.awbNumber, reason, payload: req.body.payload });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      shipment.status = 'cancelled';
      shipment.failureReason = reason;
      shipment.trackingEvents.push({
        statusCode: 'CANCELLED',
        status: 'Cancelled',
        description: reason,
        occurredAt: new Date(),
      });
      shipment.providerMetadata = shipment.providerMetadata || new Map();
      shipment.providerMetadata.set('cancelWaybillResponse', JSON.stringify(result.raw));
      await shipment.save({ session });
      const order = await Order.findById(shipment.order).session(session);
      if (order) await syncOrderAfterShipmentCancellation(order, shipment, session);
    });
  } finally {
    await session.endSession();
  }

  await logAudit(req, {
    action: 'cancel', resourceType: 'Shipment', resourceId: shipment._id, resourceLabel: shipment.awbNumber,
    description: 'Blue Dart waybill cancelled', statusCode: 200,
  });
  await notifyShipmentUpdate(shipment);
  return ApiResponse.success(res, { message: 'Waybill cancelled', data: shipment });
});

const listMyShipments = asyncHandler(async (req, res) => {
  const filter = { user: req.user.id };
  const orderIdentifier = req.query.orderId || req.query.orderNumber;
  if (orderIdentifier) {
    const orderId = await resolveOrderReference(orderIdentifier, req.user.id);
    if (!orderId) return ApiResponse.success(res, { data: [] });
    filter.order = orderId;
  }
  const shipments = await Shipment.find(filter)
    .populate(
      'order',
      'orderNumber createdAt grandTotal currency paymentMethod paymentStatus fulfillmentStatus orderStatus shippingAddress items',
    )
    .sort({ createdAt: -1 })
    .lean();
  return ApiResponse.success(res, { data: shipments });
});

const listShipmentsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.search) {
    const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      baseFilter.$or = [
        { shipmentNumber: new RegExp(escaped, 'i') },
        { awbNumber: new RegExp(escaped, 'i') },
        { referenceNumber: new RegExp(escaped, 'i') },
      ];
    }
  }
  const orderIdentifier = req.query.orderId || req.query.orderNumber;
  if (orderIdentifier) {
    const orderId = await resolveOrderReference(orderIdentifier);
    if (!orderId) {
      return ApiResponse.success(res, {
        data: [],
        meta: { page, limit, total: 0, pages: 0, summary: { total: 0, statusCounts: {} } },
      });
    }
    baseFilter.order = orderId;
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [shipments, total, summary] = await Promise.all([
    Shipment.find(filter).populate('order', 'orderNumber orderStatus').populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Shipment.countDocuments(filter),
    summarizeStatusFields(Shipment, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: shipments,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const blueDartWebhook = asyncHandler(async (req, res) => {
  if (!verifyWebhookSignature(req.body, req.get('x-bluedart-signature'), req.rawBody)) {
    throw new AppError('Invalid Blue Dart webhook signature', 401, 'INVALID_WEBHOOK_SIGNATURE');
  }
  const awbNumber = req.body.awbNumber || req.body.AWBNo || req.body.waybillNumber;
  const shipment = await Shipment.findOne({ awbNumber: String(awbNumber || '').toUpperCase() });
  if (shipment) {
    const changes = mergeTracking(shipment, req.body);
    await shipment.save();
    await synchronizeDeliveredOrder(shipment);
    if (changes.addedEvents || changes.statusChanged) await notifyShipmentUpdate(shipment);
    return ApiResponse.success(res, { message: 'Webhook processed' });
  }

  const returnRequest = await ReturnRequest.findOne({
    'reversePickup.awbNumber': String(awbNumber || '').toUpperCase(),
  });
  if (!returnRequest) throw new AppError('Shipment not found', 404, 'SHIPMENT_NOT_FOUND');
  const changes = applyReverseTracking(returnRequest, req.body);
  await returnRequest.save();
  if (changes.addedEvents || changes.statusChanged) {
    const payload = {
      returnId: returnRequest._id,
      returnNumber: returnRequest.returnNumber,
      orderId: returnRequest.order,
      awbNumber: returnRequest.reversePickup.awbNumber,
      status: returnRequest.status,
    };
    emitToUser(returnRequest.user, 'return:updated', payload);
    emitToRoles(['superAdmin', 'admin', 'orderManager', 'supportManager'], 'return:updated', payload);
    try {
      await Promise.all([
        notifyUser({
          userId: returnRequest.user,
          type: 'return',
          title: 'Return shipment updated',
          message: `Return ${returnRequest.returnNumber} is now ${returnRequest.status}.`,
          data: payload,
          action: { type: 'order', value: String(returnRequest.order), label: 'View return' },
        }),
        notifyRoles({
          roles: ['superAdmin', 'admin', 'orderManager', 'supportManager'],
          type: 'return',
          title: 'Return shipment updated',
          message: `Return ${returnRequest.returnNumber} is now ${returnRequest.status}.`,
          data: payload,
        }),
      ]);
    } catch (error) { console.error('Reverse pickup webhook notification failed', error.message); }
  }
  return ApiResponse.success(res, { message: 'Webhook processed' });
});

module.exports = {
  serviceability, listEligibleOrders, createShipment, trackMyShipment, trackShipmentAdmin,
  getShipmentAdmin, getShipmentLabelAdmin, updateWaybillAdmin, cancelWaybillAdmin,
  listMyShipments, listShipmentsAdmin, blueDartWebhook,
};
