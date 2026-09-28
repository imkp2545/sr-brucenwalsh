const Product = require('../models/productModel');
const Order = require('../models/orderModel');
const Shipment = require('../models/shipmentModel');
const ReturnRequest = require('../models/returnModel');
const Refund = require('../models/refundModel');
const Appointment = require('../models/appointmentModel');
const Buyback = require('../models/buybackModel');
const Review = require('../models/reviewModel');
const Banner = require('../models/bannerModel');
const Coupon = require('../models/couponModel');
const CmsPage = require('../models/cmsPageModel');
const Collection = require('../models/collectionModel');
const Notification = require('../models/notificationModel');
const AppError = require('../utils/appError');

const MODELS = {
  Product,
  Order,
  Shipment,
  Return: ReturnRequest,
  Refund,
  Appointment,
  Buyback,
  Review,
  Banner,
  Coupon,
  CmsPage,
  Collection,
};

const ORDER_AWAITING_SHIPMENT = {
  paymentStatus: { $in: ['paid', 'partiallyRefunded'] },
  orderStatus: { $in: ['confirmed', 'processing'] },
  fulfillmentStatus: { $in: ['unfulfilled', 'processing', 'packed'] },
};
const SHIPMENT_EXCEPTIONS = { status: { $in: ['deliveryFailed', 'rtoInitiated', 'returned'] } };
const RETURN_REVIEW_QUEUE = { status: { $in: ['requested', 'underReview'] } };
const APPOINTMENT_REVIEW_QUEUE = { status: { $in: ['requested', 'underReview'] } };
const BUYBACK_REVIEW_QUEUE = { status: { $in: ['requested', 'withdrawalRequested'] } };
const REFUND_ACTION_QUEUE = { status: { $in: ['requested', 'approved', 'processing', 'failed'] } };
const STOCK_ALERTS = {
  deletedAt: null,
  status: { $in: ['active', 'inactive'] },
  trackInventory: true,
  $expr: { $lte: [{ $subtract: ['$stock', '$reservedStock'] }, '$lowStockThreshold'] },
};

const metric = (key, label, helper, tone, sources) => ({ key, label, helper, tone, sources });
const source = (model, filter, options = {}) => ({ model, filter, ...options });
const queue = (title, subtitle, sources) => ({ title, subtitle, sources });

const rolePolicies = {
  superAdmin: {
    eyebrow: 'Business overview',
    title: 'Business operations',
    subtitle: 'Customer demand, consultations, catalog availability, and post-purchase service at a glance.',
    quickActions: ['orders', 'products', 'appointments', 'banners'],
    activityTypes: ['order', 'shipment', 'return', 'refund', 'buyback', 'appointment', 'promotion'],
    businessPanels: true,
    metrics: [
      metric('ordersInPeriod', 'Customer orders', 'Paid orders in the selected period', 'info', [source('Order', { paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } }, { periodScoped: true })]),
      metric('openAppointments', 'Open consultations', 'Requested, reviewed, or scheduled visits', 'secondary', [source('Appointment', { status: { $in: ['requested', 'underReview', 'confirmed', 'rescheduled', 'enRoute'] } })]),
      metric('activeProducts', 'Active products', 'Products currently available to customers', 'success', [source('Product', { status: 'active', deletedAt: null })]),
      metric('postPurchaseCases', 'Post-purchase cases', 'Open returns and buyback enquiries', 'warning', [source('Return', { status: { $nin: ['rejected', 'completed', 'cancelled'] } }), source('Buyback', { status: { $nin: ['customerDeclined', 'rejected', 'cancelled', 'noShow', 'closed', 'completed'] } })]),
    ],
    trend: [
      source('Order', { paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } }, { name: 'Orders' }),
      source('Appointment', {}, { name: 'Appointments' }),
      source('Shipment', {}, { name: 'Shipments' }),
      source('Buyback', {}, { name: 'Buybacks' }),
    ],
    workQueue: queue('Business priorities', 'Oldest customer and fulfilment work requiring attention', [
      source('Order', ORDER_AWAITING_SHIPMENT, { resource: 'orders' }),
      source('Appointment', APPOINTMENT_REVIEW_QUEUE, { resource: 'appointments' }),
      source('Return', RETURN_REVIEW_QUEUE, { resource: 'returns' }),
      source('Buyback', BUYBACK_REVIEW_QUEUE, { resource: 'buybacks' }),
    ]),
    exceptions: queue('Business exceptions', 'Customer experience and availability risks', [
      source('Shipment', SHIPMENT_EXCEPTIONS, { resource: 'shipments' }),
      source('Product', STOCK_ALERTS, { resource: 'products' }),
      source('Refund', { status: 'failed' }, { resource: 'refunds' }),
    ]),
  },
  admin: {
    eyebrow: 'Operations workspace',
    title: 'Daily operations',
    subtitle: 'Orders, fulfilment, appointments, and customer workflows needing action.',
    quickActions: ['orders', 'shipments', 'appointments', 'customers'],
    metrics: [
      metric('ordersAwaitingShipment', 'Orders to fulfil', 'Paid orders awaiting dispatch', 'info', [source('Order', ORDER_AWAITING_SHIPMENT)]),
      metric('appointmentsAwaitingReview', 'Appointment requests', 'New consultations to review', 'secondary', [source('Appointment', APPOINTMENT_REVIEW_QUEUE)]),
      metric('returnsAwaitingReview', 'Return requests', 'Requests awaiting decision', 'warning', [source('Return', RETURN_REVIEW_QUEUE)]),
      metric('deliveryExceptions', 'Delivery exceptions', 'Failed, RTO, or returned shipments', 'error', [source('Shipment', SHIPMENT_EXCEPTIONS)]),
    ],
    trend: [
      source('Order', { paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } }, { name: 'Orders' }),
      source('Shipment', {}, { name: 'Shipments' }),
      source('Return', {}, { name: 'Returns' }),
      source('Appointment', {}, { name: 'Appointments' }),
    ],
    workQueue: queue('Operations queue', 'Customer and fulfilment work awaiting action', [
      source('Order', ORDER_AWAITING_SHIPMENT, { resource: 'orders' }),
      source('Appointment', APPOINTMENT_REVIEW_QUEUE, { resource: 'appointments' }),
      source('Return', RETURN_REVIEW_QUEUE, { resource: 'returns' }),
    ]),
    exceptions: queue('Service exceptions', 'Items outside their expected workflow', [
      source('Shipment', SHIPMENT_EXCEPTIONS, { resource: 'shipments' }),
      source('Refund', { status: 'failed' }, { resource: 'refunds' }),
    ]),
  },
  catalogManager: {
    eyebrow: 'Catalog workspace',
    title: 'Catalog health',
    subtitle: 'Publication readiness, inventory attention, merchandising, and customer feedback.',
    quickActions: ['productNew', 'categories', 'collections', 'reviews'],
    metrics: [
      metric('activeProducts', 'Active products', 'Published customer-visible products', 'success', [source('Product', { status: 'active', deletedAt: null })]),
      metric('draftProducts', 'Draft products', 'Products still being prepared', 'secondary', [source('Product', { status: 'draft', deletedAt: null })]),
      metric('stockAlerts', 'Stock alerts', 'Low or unavailable inventory', 'warning', [source('Product', STOCK_ALERTS)]),
      metric('customerReviews', 'Customer reviews', 'Published verified-purchase feedback', 'info', [source('Review', { status: { $ne: 'rejected' } })]),
    ],
    trend: [
      source('Product', { deletedAt: null }, { name: 'Products added' }),
      source('Product', { deletedAt: null }, { name: 'Products updated', dateField: 'updatedAt' }),
      source('Review', {}, { name: 'Reviews received' }),
    ],
    workQueue: queue('Catalog queue', 'Products requiring completion', [
      source('Product', { status: 'draft', deletedAt: null }, { resource: 'products' }),
    ]),
    exceptions: queue('Catalog exceptions', 'Inventory and presentation issues', [
      source('Product', STOCK_ALERTS, { resource: 'products' }),
      source('Product', { deletedAt: null, status: { $ne: 'archived' }, images: { $size: 0 } }, { resource: 'products', detail: 'Product image required' }),
    ]),
  },
  orderManager: {
    eyebrow: 'Fulfilment workspace',
    title: 'Order operations',
    subtitle: 'Paid orders, carrier movement, returns, refunds, and buyback handling.',
    quickActions: ['shipments', 'orders', 'returns', 'buybacks'],
    metrics: [
      metric('ordersAwaitingShipment', 'Orders to fulfil', 'Paid orders awaiting dispatch', 'info', [source('Order', ORDER_AWAITING_SHIPMENT)]),
      metric('shipmentsAwaitingPickup', 'Awaiting pickup', 'Pending or scheduled carrier pickup', 'secondary', [source('Shipment', { status: { $in: ['pending', 'pickupScheduled'] } })]),
      metric('deliveryExceptions', 'Delivery exceptions', 'Failed, RTO, or returned shipments', 'error', [source('Shipment', SHIPMENT_EXCEPTIONS)]),
      metric('returnRefundQueue', 'Return and refund queue', 'Open post-purchase workflows', 'warning', [source('Return', RETURN_REVIEW_QUEUE), source('Refund', REFUND_ACTION_QUEUE)]),
    ],
    trend: [
      source('Order', { paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] } }, { name: 'Paid orders' }),
      source('Shipment', {}, { name: 'Shipments' }),
      source('Return', {}, { name: 'Returns' }),
    ],
    workQueue: queue('Fulfilment queue', 'Orders and post-purchase requests awaiting action', [
      source('Order', ORDER_AWAITING_SHIPMENT, { resource: 'orders' }),
      source('Return', RETURN_REVIEW_QUEUE, { resource: 'returns' }),
      source('Buyback', BUYBACK_REVIEW_QUEUE, { resource: 'buybacks' }),
    ]),
    exceptions: queue('Carrier and refund exceptions', 'Failed workflows requiring manual review', [
      source('Shipment', SHIPMENT_EXCEPTIONS, { resource: 'shipments' }),
      source('Refund', { status: 'failed' }, { resource: 'refunds' }),
    ]),
  },
  supportManager: {
    eyebrow: 'Client services',
    title: 'Customer care',
    subtitle: 'Consultations, requests, reviews, and customer cases requiring a response.',
    quickActions: ['appointments', 'returns', 'buybacks', 'customers'],
    metrics: [
      metric('appointmentsAwaitingReview', 'Appointment requests', 'Consultations awaiting response', 'info', [source('Appointment', APPOINTMENT_REVIEW_QUEUE)]),
      metric('returnsAwaitingReview', 'Return requests', 'Customer returns awaiting review', 'warning', [source('Return', RETURN_REVIEW_QUEUE)]),
      metric('buybackEnquiries', 'Buyback enquiries', 'New or withdrawal requests', 'secondary', [source('Buyback', BUYBACK_REVIEW_QUEUE)]),
      metric('customerReviews', 'Customer reviews', 'Published verified-purchase feedback', 'success', [source('Review', { status: { $ne: 'rejected' } })]),
    ],
    trend: [
      source('Appointment', {}, { name: 'Appointments' }),
      source('Return', {}, { name: 'Returns' }),
      source('Buyback', {}, { name: 'Buybacks' }),
      source('Review', {}, { name: 'Reviews' }),
    ],
    workQueue: queue('Customer care queue', 'Oldest customer requests awaiting response', [
      source('Appointment', APPOINTMENT_REVIEW_QUEUE, { resource: 'appointments' }),
      source('Return', RETURN_REVIEW_QUEUE, { resource: 'returns' }),
      source('Buyback', BUYBACK_REVIEW_QUEUE, { resource: 'buybacks' }),
    ]),
    exceptions: queue('Service exceptions', 'No-shows and failed customer workflows', [
      source('Appointment', { status: 'noShow' }, { resource: 'appointments' }),
      source('Shipment', SHIPMENT_EXCEPTIONS, { resource: 'shipments' }),
    ]),
  },
  marketingManager: {
    eyebrow: 'Marketing workspace',
    title: 'Campaign operations',
    subtitle: 'Campaign readiness, publishing cadence, collection presentation, and engagement.',
    quickActions: ['banners', 'coupons', 'collections', 'notifications'],
    metrics: [
      metric('activeCampaigns', 'Active campaigns', 'Live banners and coupons', 'success', [source('Banner', { status: 'active' }), source('Coupon', { status: 'active' })]),
      metric('scheduledCampaigns', 'Scheduled launches', 'Campaigns and collections queued', 'info', [source('Banner', { status: 'scheduled' }), source('Collection', { status: 'scheduled', deletedAt: null })]),
      metric('draftContent', 'Draft content', 'Campaign and content work in progress', 'secondary', [source('Banner', { status: 'draft' }), source('Coupon', { status: 'draft' }), source('CmsPage', { status: 'draft' }), source('Collection', { status: 'draft', deletedAt: null })]),
      metric('campaignInteractions', 'Campaign interactions', 'Recorded banner clicks', 'warning', [source('Banner', {}, { operation: 'sum', field: 'clickCount' })]),
    ],
    trend: [
      source('Banner', {}, { name: 'Banners created' }),
      source('Coupon', {}, { name: 'Coupons created' }),
      source('CmsPage', {}, { name: 'Content created' }),
      source('Collection', { deletedAt: null }, { name: 'Collections created' }),
    ],
    workQueue: queue('Publishing queue', 'Draft and scheduled work requiring attention', [
      source('Banner', { status: { $in: ['draft', 'scheduled'] } }, { resource: 'banners' }),
      source('Coupon', { status: 'draft' }, { resource: 'coupons' }),
      source('CmsPage', { status: 'draft' }, { resource: 'cms' }),
    ]),
    exceptions: queue('Expiring soon', 'Live campaigns ending within seven days', [
      source('Banner', ({ now, sevenDays }) => ({ status: 'active', endsAt: { $gte: now, $lte: sevenDays } }), { resource: 'banners' }),
      source('Coupon', ({ now, sevenDays }) => ({ status: 'active', expiresAt: { $gte: now, $lte: sevenDays } }), { resource: 'coupons' }),
      source('Collection', ({ now, sevenDays }) => ({ status: 'active', deletedAt: null, endsAt: { $gte: now, $lte: sevenDays } }), { resource: 'collections' }),
    ]),
  },
};

const forbiddenFinancialKeys = new Set([
  'amount', 'subtotal', 'total', 'grandtotal', 'price', 'unitprice', 'revenue',
  'grossrevenue', 'netrevenue', 'tax', 'cgst', 'sgst', 'discount', 'currency',
  'shippingcharge', 'insurancecharge', 'payment',
]);

const assertFinanciallySafeWorkspace = (value, path = 'workspace') => {
  if (!value || typeof value !== 'object') return value;
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (forbiddenFinancialKeys.has(normalizedKey)) {
      throw new Error(`Financial field is not permitted in role dashboard payload: ${path}.${key}`);
    }
    assertFinanciallySafeWorkspace(nestedValue, `${path}.${key}`);
  }
  return value;
};

const indiaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

const indiaDateKey = (date) => {
  const parts = Object.fromEntries(indiaDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const getPeriod = (requestedDays) => {
  const allowedDays = [7, 14, 30];
  const days = allowedDays.includes(Number(requestedDays)) ? Number(requestedDays) : 14;
  const end = new Date();
  const endKey = indiaDateKey(end);
  const cursor = new Date(`${endKey}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));
  const startKey = cursor.toISOString().slice(0, 10);
  const start = new Date(`${startKey}T00:00:00+05:30`);
  const keys = [];
  while (cursor.toISOString().slice(0, 10) <= endKey) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { days, start, end, keys };
};

const resolveFilter = (filter, context) => (typeof filter === 'function' ? filter(context) : filter || {});

const metricValue = async (definition, context) => {
  const values = await Promise.all(definition.sources.map(async (item) => {
    const model = MODELS[item.model];
    const filter = { ...resolveFilter(item.filter, context) };
    if (item.periodScoped) filter[item.dateField || 'createdAt'] = { $gte: context.start, $lte: context.end };
    if (item.operation === 'sum') {
      const result = await model.aggregate([
        { $match: filter },
        { $group: { _id: null, value: { $sum: `$${item.field}` } } },
      ]);
      return Number(result[0]?.value || 0);
    }
    return model.countDocuments(filter);
  }));
  return values.reduce((total, value) => total + Number(value || 0), 0);
};

const buildMetrics = async (policy, context) => Promise.all(policy.metrics.map(async (item) => ({
  key: item.key,
  label: item.label,
  helper: item.helper,
  tone: item.tone,
  value: await metricValue(item, context),
})));

const buildTrend = async (policy, context) => {
  const series = await Promise.all(policy.trend.map(async (item) => {
    const dateField = item.dateField || 'createdAt';
    const rows = await MODELS[item.model].aggregate([
      { $match: { ...resolveFilter(item.filter, context), [dateField]: { $gte: context.start, $lte: context.end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const byDate = new Map(rows.map((row) => [row._id, Number(row.count || 0)]));
    return { name: item.name, data: context.keys.map((key) => byDate.get(key) || 0) };
  }));
  return {
    title: 'Activity movement',
    subtitle: `Daily operational activity for the last ${context.days} days`,
    categories: context.keys,
    series,
  };
};

const queueSelect = {
  Order: 'orderNumber orderStatus fulfillmentStatus createdAt',
  Product: 'name sku status stock reservedStock lowStockThreshold createdAt updatedAt',
  Shipment: 'shipmentNumber awbNumber status createdAt',
  Return: 'returnNumber status requestedAt createdAt',
  Refund: 'refundNumber status createdAt',
  Appointment: 'appointmentNumber subject status scheduledStart createdAt',
  Buyback: 'buybackNumber status createdAt appointment.scheduledStart',
  Review: 'title rating status createdAt',
  Banner: 'title placement status endsAt createdAt',
  Coupon: 'code name status expiresAt createdAt',
  CmsPage: 'title status createdAt updatedAt',
  Collection: 'name status endsAt createdAt',
};

const queueItem = (modelName, resource, row, detailOverride) => {
  const base = { id: String(row._id), resource, createdAt: row.createdAt, priority: 'normal' };
  if (modelName === 'Order') return { ...base, title: row.orderNumber, detail: 'Paid order awaiting fulfilment', status: row.fulfillmentStatus, priority: 'high' };
  if (modelName === 'Product') {
    const available = Math.max(0, Number(row.stock || 0) - Number(row.reservedStock || 0));
    return { ...base, title: row.name, detail: detailOverride || `${row.sku} | ${available} available`, status: available <= 0 ? 'outOfStock' : row.status, priority: available <= 0 ? 'urgent' : 'high' };
  }
  if (modelName === 'Shipment') return { ...base, title: row.shipmentNumber, detail: row.awbNumber ? `AWB ${row.awbNumber}` : 'Carrier action required', status: row.status, priority: 'urgent' };
  if (modelName === 'Return') return { ...base, title: row.returnNumber, detail: 'Return request requires review', status: row.status, priority: 'high' };
  if (modelName === 'Refund') return { ...base, title: row.refundNumber, detail: 'Refund requires manual review', status: row.status, priority: row.status === 'failed' ? 'urgent' : 'high' };
  if (modelName === 'Appointment') return { ...base, title: row.appointmentNumber, detail: row.subject || 'Consultation request', status: row.status, priority: 'high' };
  if (modelName === 'Buyback') return { ...base, title: row.buybackNumber, detail: 'Buyback enquiry requires action', status: row.status, priority: 'high' };
  if (modelName === 'Review') return { ...base, title: row.title || 'Customer product review', detail: `${row.rating || 0} of 5 rating`, status: row.status };
  if (modelName === 'Banner') return { ...base, title: row.title, detail: `${row.placement} placement`, status: row.status };
  if (modelName === 'Coupon') return { ...base, title: row.code, detail: row.name, status: row.status };
  if (modelName === 'CmsPage') return { ...base, title: row.title, detail: 'Content page', status: row.status };
  if (modelName === 'Collection') return { ...base, title: row.name, detail: 'Customer collection', status: row.status };
  return null;
};

const buildQueue = async (definition, context, limit = 8) => {
  const groups = await Promise.all(definition.sources.map(async (item) => {
    const rows = await MODELS[item.model]
      .find(resolveFilter(item.filter, context))
      .select(queueSelect[item.model])
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
    return rows.map((row) => queueItem(item.model, item.resource, row, item.detail)).filter(Boolean);
  }));
  return {
    title: definition.title,
    subtitle: definition.subtitle,
    items: groups.flat().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, limit),
  };
};

const buildRecentActivity = async (adminId, activityTypes) => {
  const filter = { admin: adminId };
  if (activityTypes?.length) filter.type = { $in: activityTypes };
  const notifications = await Notification.find(filter)
    .select('title type priority isRead createdAt')
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();
  return notifications.map((item) => ({
    id: String(item._id),
    title: item.title,
    type: item.type,
    priority: item.priority,
    isRead: item.isRead,
    createdAt: item.createdAt,
  }));
};

const buildBusinessPanels = async () => {
  const [orders, products, productCount] = await Promise.all([
    Order.find({
      paymentStatus: { $in: ['paid', 'partiallyRefunded', 'refunded'] },
      orderStatus: { $ne: 'cancelled' },
    })
      .select('orderNumber orderStatus fulfillmentStatus items.quantity createdAt')
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    Product.find({ deletedAt: null })
      .select('name sku status stock reservedStock updatedAt createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(8)
      .lean(),
    Product.countDocuments({ deletedAt: null }),
  ]);

  return {
    recentOrders: {
      title: 'Recent orders',
      subtitle: 'Latest customer orders and fulfilment position',
      items: orders.map((order) => ({
        id: String(order._id),
        resource: 'orders',
        title: order.orderNumber,
        detail: `${order.items.reduce((count, item) => count + Number(item.quantity || 0), 0)} item(s) | ${order.fulfillmentStatus}`,
        status: order.orderStatus,
        createdAt: order.createdAt,
      })),
    },
    catalogUpdates: {
      title: 'Catalog products',
      subtitle: 'Newest products appear first as the catalog grows',
      recordCount: productCount,
      items: products.map((product) => ({
        id: String(product._id),
        resource: 'products',
        title: product.name,
        detail: `${product.sku} | ${Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0))} available`,
        status: product.status,
        createdAt: product.createdAt,
      })),
    },
  };
};

const buildWorkspaceDashboard = async ({ role, adminId, days }) => {
  const policy = rolePolicies[role];
  if (!policy) throw new AppError('Dashboard access is not available for this role', 403, 'DASHBOARD_FORBIDDEN');
  const period = getPeriod(days);
  const now = new Date();
  const context = { ...period, now, sevenDays: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
  const [metrics, trend, workQueue, exceptions, businessPanels, recentActivity] = await Promise.all([
    buildMetrics(policy, context),
    buildTrend(policy, context),
    policy.businessPanels ? Promise.resolve(null) : buildQueue(policy.workQueue, context),
    policy.businessPanels ? Promise.resolve(null) : buildQueue(policy.exceptions, context, 6),
    policy.businessPanels ? buildBusinessPanels() : Promise.resolve(null),
    buildRecentActivity(adminId, policy.activityTypes),
  ]);
  return assertFinanciallySafeWorkspace({
    role,
    generatedAt: new Date(),
    period: { days: period.days, start: period.start, end: period.end },
    header: { eyebrow: policy.eyebrow, title: policy.title, subtitle: policy.subtitle },
    metrics,
    trend,
    workQueue,
    exceptions,
    businessPanels,
    recentActivity,
    quickActions: [...policy.quickActions],
  });
};

const getRoleDashboardPolicy = (role) => {
  const policy = rolePolicies[role];
  if (!policy) return null;
  return {
    role,
    quickActions: [...policy.quickActions],
    metricKeys: policy.metrics.map((item) => item.key),
    resources: [...new Set([
      ...policy.workQueue.sources.map((item) => item.resource),
      ...policy.exceptions.sources.map((item) => item.resource),
    ].filter(Boolean))],
  };
};

module.exports = { buildWorkspaceDashboard, getRoleDashboardPolicy, assertFinanciallySafeWorkspace };
