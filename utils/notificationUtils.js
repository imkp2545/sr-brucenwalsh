const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const Admin = require('../models/adminModel');
const { emitToUser, emitToRoles } = require('../config/socketConfig');
const { getMessaging } = require('../config/firebaseConfig');

const stringifyData = (data = {}) => Object.fromEntries(
  Object.entries(data).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
);

const pushTokensFor = (user) => [...new Set([
  ...(user.fcmTokens || []),
  ...(user.fcmDevices || []).map((device) => device.token),
].filter(Boolean))];

const tokenBatches = (tokens, batchSize = 500) => {
  const batches = [];
  for (let index = 0; index < tokens.length; index += batchSize) {
    batches.push(tokens.slice(index, index + batchSize));
  }
  return batches;
};

const notifyUser = async ({
  userId,
  type,
  title,
  message,
  data = {},
  action = { type: 'none' },
  priority = 'normal',
  createdBy = null,
}) => {
  const user = await User.findById(userId).select('+fcmTokens +fcmDevices notificationPreferences');
  if (!user) return null;

  const channels = ['inApp'];
  const pushTokens = pushTokensFor(user);
  if (user.notificationPreferences?.push !== false && pushTokens.length) channels.push('push');
  const notification = await Notification.create({
    recipientType: 'user',
    user: userId,
    type,
    title,
    message,
    channels,
    priority,
    action,
    data: stringifyData(data),
    createdBy,
    delivery: channels.map((channel) => ({
      channel,
      status: channel === 'inApp' ? 'delivered' : 'queued',
      deliveredAt: channel === 'inApp' ? new Date() : undefined,
    })),
  });

  emitToUser(userId, 'notification:new', notification.toObject());
  if (!channels.includes('push')) return notification;

  const pushDelivery = notification.delivery.find((item) => item.channel === 'push');
  try {
    const highPriority = priority === 'urgent' || priority === 'high';
    const responses = [];
    let successCount = 0;
    for (const tokens of tokenBatches(pushTokens)) {
      const response = await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title, body: message },
        data: stringifyData({ ...data, notificationId: notification._id }),
        android: {
          priority: highPriority ? 'high' : 'normal',
          notification: { sound: 'default' },
        },
        apns: {
          headers: { 'apns-priority': highPriority ? '10' : '5' },
          payload: { aps: { sound: 'default' } },
        },
      });
      successCount += response.successCount;
      responses.push(...response.responses.map((result, index) => ({ result, token: tokens[index] })));
    }
    pushDelivery.status = successCount > 0 ? 'sent' : 'failed';
    pushDelivery.sentAt = successCount > 0 ? new Date() : undefined;
    pushDelivery.attemptCount = 1;
    if (!successCount) pushDelivery.failureReason = 'No registered device accepted the notification';

    const invalidTokens = responses
      .filter(({ result }) => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code))
      .map(({ token }) => token);
    if (invalidTokens.length) {
      await User.updateOne(
        { _id: userId },
        { $pull: { fcmTokens: { $in: invalidTokens }, fcmDevices: { token: { $in: invalidTokens } } } },
      );
    }
  } catch (error) {
    pushDelivery.status = 'failed';
    pushDelivery.failedAt = new Date();
    pushDelivery.attemptCount = 1;
    pushDelivery.failureReason = error.message.slice(0, 1000);
  }
  await notification.save();
  return notification;
};

const notifyRoles = async ({ roles, type, title, message, data = {}, priority = 'normal', createdBy = null }) => {
  const uniqueRoles = [...new Set(roles)];
  const admins = await Admin.find({ role: { $in: uniqueRoles }, status: 'active', deletedAt: null }).select('_id').lean();
  const notifications = admins.length ? await Notification.insertMany(admins.map((admin) => ({
    recipientType: 'admin', admin: admin._id, type, title, message, channels: ['inApp'], priority,
    data: stringifyData(data), createdBy,
    delivery: [{ channel: 'inApp', status: 'delivered', deliveredAt: new Date() }],
  }))) : [];
  emitToRoles(uniqueRoles, 'notification:new', { type, title, message, priority, data: stringifyData(data) });
  return notifications;
};

module.exports = { notifyUser, notifyRoles, emitToUser, emitToRoles };
