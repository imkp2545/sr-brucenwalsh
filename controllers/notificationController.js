const Notification = require('../models/notificationModel');
const NotificationCampaign = require('../models/notificationCampaignModel');
const User = require('../models/userModel');
const crypto = require('crypto');
const mongoose = require('mongoose');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { dispatchCampaign } = require('../services/notificationCampaignService');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const ADMIN_ROLES = ['superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'];
const NOTIFICATION_TYPES = ['account', 'emailVerification', 'passwordReset', 'order', 'payment', 'shipment', 'return', 'refund', 'buyback', 'appointment', 'promotion', 'system'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CUSTOMER_SEGMENTS = ['allActive', 'verified', 'marketingOptIn', 'pushEnabled'];
const DEVICE_PLATFORMS = ['android', 'ios', 'web', 'unknown'];

const ownershipFilter = (req) => {
  if (req.user.role === 'customer') return { user: req.user.id };
  return { admin: req.user.id };
};

const listNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = ownershipFilter(req);
  if (req.query.unread === 'true') filter.isRead = false;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.category === 'orders') {
    filter.type = { $in: ['order', 'payment', 'shipment', 'return', 'refund', 'buyback'] };
  } else if (req.query.category === 'offers') {
    filter.type = 'promotion';
  }
  const [notifications, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...ownershipFilter(req), isRead: false }),
  ]);
  return ApiResponse.success(res, { data: notifications, meta: { page, limit, total, pages: Math.ceil(total / limit), unread } });
});

const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, ...ownershipFilter(req) },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  return ApiResponse.success(res, { message: 'Notification marked as read', data: notification });
});

const markAsUnread = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, ...ownershipFilter(req) },
    { $set: { isRead: false }, $unset: { readAt: 1 } },
    { new: true },
  );
  if (!notification) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  return ApiResponse.success(res, { message: 'Notification marked as unread', data: notification });
});

const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { ...ownershipFilter(req), isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
  );
  return ApiResponse.success(res, { message: 'Notifications marked as read', data: { updated: result.modifiedCount } });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.notificationId, ...ownershipFilter(req) });
  if (!notification) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  return ApiResponse.success(res, { message: 'Notification removed' });
});

const deleteAllNotifications = asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany(ownershipFilter(req));
  return ApiResponse.success(res, {
    message: 'Notifications removed',
    data: { deleted: result.deletedCount || 0 },
  });
});

const hasPushDevice = (customer) => Boolean(
  customer.fcmTokens?.length
  || customer.fcmDevices?.some((device) => device.token),
);

const compactObject = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));
const stringifyData = (data = {}) => Object.fromEntries(
  Object.entries(data).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
);

const listCustomerTargets = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = { status: 'active', isEmailVerified: true, deletedAt: null };
  if (req.query.search) {
    const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      const search = new RegExp(escaped, 'i');
      filter.$or = [{ firstName: search }, { lastName: search }, { email: search }, { phone: search }];
    }
  }
  const customers = await User.find(filter)
    .select('firstName lastName email phone addresses notificationPreferences +fcmTokens +fcmDevices')
    .sort({ createdAt: -1 })
    .limit(limit);
  return ApiResponse.success(res, {
    data: customers.map((customer) => ({
      id: customer._id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      city: customer.addresses?.find((address) => address.isDefault)?.city || customer.addresses?.[0]?.city,
      state: customer.addresses?.find((address) => address.isDefault)?.state || customer.addresses?.[0]?.state,
      marketingOptIn: Boolean(customer.notificationPreferences?.marketing),
      pushEnabled: customer.notificationPreferences?.push !== false && hasPushDevice(customer),
    })),
  });
});

const registerFcmToken = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token.length < 32 || token.length > 4096) throw new AppError('Valid FCM token is required', 422, 'INVALID_FCM_TOKEN');

  const platform = DEVICE_PLATFORMS.includes(req.body.platform) ? req.body.platform : 'unknown';
  const device = compactObject({
    token,
    platform,
    deviceId: req.body.deviceId ? String(req.body.deviceId).trim().slice(0, 160) : undefined,
    appVersion: req.body.appVersion ? String(req.body.appVersion).trim().slice(0, 40) : undefined,
    locale: req.body.locale ? String(req.body.locale).trim().slice(0, 32) : undefined,
    timezone: req.body.timezone ? String(req.body.timezone).trim().slice(0, 80) : undefined,
    lastSeenAt: new Date(),
  });

  const existingDevice = await User.updateOne(
    { _id: req.user.id, status: 'active', 'fcmDevices.token': token },
    {
      $addToSet: { fcmTokens: token },
      $set: Object.fromEntries(Object.entries(device).map(([key, value]) => [`fcmDevices.$.${key}`, value])),
    },
  );

  if (!existingDevice.matchedCount) {
    await User.updateOne(
      { _id: req.user.id, status: 'active' },
      { $addToSet: { fcmTokens: token }, $push: { fcmDevices: device } },
    );
  }

  return ApiResponse.success(res, { message: 'Push notification device registered', data: { platform } });
});

const unregisterFcmToken = asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  if (token) {
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { fcmTokens: token, fcmDevices: { token } } },
    );
  }
  return ApiResponse.success(res, { message: 'Push notification device removed' });
});

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeArray(parsed);
    } catch (_error) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
};

const customerFilterFor = (segment = 'allActive', filters = {}) => {
  if (!CUSTOMER_SEGMENTS.includes(segment)) throw new AppError('Invalid customer segment', 422, 'INVALID_CUSTOMER_SEGMENT');
  const filter = { status: 'active', isEmailVerified: true, deletedAt: null };
  if (segment === 'marketingOptIn') filter['notificationPreferences.marketing'] = true;
  if (segment === 'pushEnabled') {
    filter['notificationPreferences.push'] = { $ne: false };
    filter.$or = [
      { fcmTokens: { $exists: true, $ne: [] } },
      { fcmDevices: { $elemMatch: { token: { $exists: true, $ne: '' } } } },
    ];
  }
  if (filters.city) filter['addresses.city'] = new RegExp(`^${String(filters.city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (filters.state) filter['addresses.state'] = new RegExp(`^${String(filters.state).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return filter;
};

const resolveCustomerRecipients = async ({ recipientMode, userIds, customerSegment, customerFilters }) => {
  if (recipientMode === 'selectedCustomers') {
    const uniqueIds = [...new Set(userIds)];
    if (!uniqueIds.length) throw new AppError('Select at least one customer', 422, 'RECIPIENT_REQUIRED');
    if (uniqueIds.length > 500) throw new AppError('A campaign can target at most 500 selected customers', 422, 'TOO_MANY_RECIPIENTS');
    if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) throw new AppError('One or more customer IDs are invalid', 422, 'INVALID_CUSTOMER');
    const customers = await User.find({ _id: { $in: uniqueIds }, status: 'active', isEmailVerified: true, deletedAt: null }).select('_id').lean();
    if (customers.length !== uniqueIds.length) throw new AppError('One or more selected customers are unavailable', 422, 'INVALID_CUSTOMER');
    return customers.map((customer) => String(customer._id));
  }

  if (recipientMode !== 'customerSegment') return [];
  const customers = await User.find(customerFilterFor(customerSegment, customerFilters)).select('_id').limit(5000).lean();
  if (!customers.length) throw new AppError('No customers match this audience', 422, 'NO_RECIPIENTS');
  return customers.map((customer) => String(customer._id));
};

const sendAdminNotification = asyncHandler(async (req, res) => {
  const {
    title,
    message,
    type = 'system',
    priority = 'normal',
    recipientMode,
    customerSegment = 'allActive',
    customerFilters = {},
    roles: rawRoles = [],
    userIds: rawUserIds = [],
    scheduledAt,
    data = {},
  } = req.body;
  if (!title || !message) throw new AppError('Notification title and message are required', 422, 'VALIDATION_ERROR');
  if (!NOTIFICATION_TYPES.includes(type)) throw new AppError('Invalid notification type', 422, 'INVALID_NOTIFICATION_TYPE');
  if (!PRIORITIES.includes(priority)) throw new AppError('Invalid notification priority', 422, 'INVALID_PRIORITY');

  const roles = [...new Set(normalizeArray(rawRoles))];
  const userIds = [...new Set(normalizeArray(rawUserIds))];
  if (roles.some((role) => !ADMIN_ROLES.includes(role))) throw new AppError('One or more admin roles are invalid', 422, 'INVALID_ROLE');

  const mode = recipientMode || (roles.length ? 'adminRoles' : 'selectedCustomers');
  if (!['adminRoles', 'selectedCustomers', 'customerSegment'].includes(mode)) {
    throw new AppError('Invalid recipient mode', 422, 'INVALID_RECIPIENT_MODE');
  }
  if (mode === 'adminRoles' && !roles.length) throw new AppError('Select at least one admin role', 422, 'RECIPIENT_REQUIRED');

  const campaignId = crypto.randomUUID();
  const scheduleDate = scheduledAt ? new Date(scheduledAt) : new Date();
  if (Number.isNaN(scheduleDate.getTime())) throw new AppError('Scheduled time is invalid', 422, 'INVALID_SCHEDULED_AT');
  const isScheduled = scheduleDate.getTime() > Date.now() + 30000;

  const targetUserIds = await resolveCustomerRecipients({
    recipientMode: mode,
    userIds,
    customerSegment,
    customerFilters,
  });

  const campaign = await NotificationCampaign.create({
    campaignId,
    title: title.trim(),
    message: message.trim(),
    type,
    priority,
    recipientMode: mode,
    customerSegment: mode === 'customerSegment' ? customerSegment : undefined,
    roles: mode === 'adminRoles' ? roles : [],
    userIds: targetUserIds,
    scheduledAt: scheduleDate,
    status: isScheduled ? 'scheduled' : 'sending',
    targetCount: mode === 'adminRoles' ? roles.length : targetUserIds.length,
    data: stringifyData(data),
    createdBy: req.user.id,
  });

  const dispatchedCampaign = isScheduled ? campaign : await dispatchCampaign(campaign);
  await logAudit(req, {
    action: 'create', resourceType: 'Notification', description: `Admin notification campaign ${isScheduled ? 'scheduled' : 'sent'} for ${campaign.targetCount} target(s)`, statusCode: 201,
  });
  return ApiResponse.success(res, {
    statusCode: 201,
    message: isScheduled ? 'Notification scheduled' : 'Notification sent',
    data: {
      campaignId,
      status: dispatchedCampaign?.status || campaign.status,
      scheduledAt: campaign.scheduledAt,
      sentAt: dispatchedCampaign?.sentAt,
      targets: dispatchedCampaign?.targetCount ?? campaign.targetCount,
      pushQueued: dispatchedCampaign?.pushQueued || 0,
    },
  });
});

const listSentNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const baseFilter = { createdBy: req.user.id };
  const filter = applyStatusFilter({ ...baseFilter }, 'status', req.query.status);
  const [campaigns, total, summary] = await Promise.all([
    NotificationCampaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    NotificationCampaign.countDocuments(filter),
    summarizeStatusFields(NotificationCampaign, baseFilter),
  ]);
  const campaignIds = campaigns.map((campaign) => campaign.campaignId);
  const notificationMetrics = campaignIds.length ? await Notification.aggregate([
    { $match: { 'data.campaignId': { $in: campaignIds } } },
    {
      $group: {
        _id: '$data.campaignId',
        deliveredCount: { $sum: 1 },
        readCount: { $sum: { $cond: ['$isRead', 1, 0] } },
        pushQueued: { $sum: { $cond: [{ $in: ['push', '$channels'] }, 1, 0] } },
        pushSent: {
          $sum: {
            $cond: [
              { $gt: [{ $size: { $filter: { input: '$delivery', as: 'item', cond: { $and: [{ $eq: ['$$item.channel', 'push'] }, { $eq: ['$$item.status', 'sent'] }] } } } }, 0] },
              1,
              0,
            ],
          },
        },
        pushFailed: {
          $sum: {
            $cond: [
              { $gt: [{ $size: { $filter: { input: '$delivery', as: 'item', cond: { $and: [{ $eq: ['$$item.channel', 'push'] }, { $eq: ['$$item.status', 'failed'] }] } } } }, 0] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]) : [];
  const metricsByCampaign = new Map(notificationMetrics.map((metric) => [metric._id, metric]));
  const data = campaigns.map((campaign) => {
    const metrics = metricsByCampaign.get(campaign.campaignId) || {};
    const deliveredCount = metrics.deliveredCount || (campaign.status === 'sent' ? campaign.targetCount : 0);
    const readCount = metrics.readCount || 0;
    return {
      ...campaign,
      _id: campaign.campaignId,
      deliveredCount,
      readCount,
      unreadCount: Math.max(0, deliveredCount - readCount),
      pushQueued: metrics.pushQueued || campaign.pushQueued || 0,
      pushSent: metrics.pushSent || 0,
      pushFailed: metrics.pushFailed || 0,
      readRate: deliveredCount ? Math.round((readCount / deliveredCount) * 10000) / 100 : 0,
    };
  });
  return ApiResponse.success(res, {
    data,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const cancelScheduledCampaign = asyncHandler(async (req, res) => {
  const campaign = await NotificationCampaign.findOneAndUpdate(
    { campaignId: req.params.campaignId, createdBy: req.user.id, status: 'scheduled' },
    { $set: { status: 'cancelled' } },
    { new: true },
  );
  if (!campaign) throw new AppError('Scheduled campaign not found', 404, 'CAMPAIGN_NOT_FOUND');
  await logAudit(req, {
    action: 'update', resourceType: 'Notification', description: `Notification campaign ${campaign.campaignId} cancelled`, statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Campaign cancelled', data: campaign });
});

module.exports = {
  listNotifications, markAsRead, markAsUnread, markAllAsRead, deleteNotification, deleteAllNotifications,
  listCustomerTargets,
  registerFcmToken, unregisterFcmToken, sendAdminNotification, listSentNotifications, cancelScheduledCampaign,
};
