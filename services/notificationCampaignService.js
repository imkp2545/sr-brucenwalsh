const NotificationCampaign = require('../models/notificationCampaignModel');
const { notifyUser, notifyRoles } = require('../utils/notificationUtils');

let schedulerHandle = null;
let processing = false;

const stringifyData = (data = {}) => Object.fromEntries(
  Object.entries(data).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
);

const mapToObject = (value) => {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
};

const pushQueuedCount = (notifications = []) => notifications.reduce(
  (count, notification) => count + (notification.delivery?.some((item) => item.channel === 'push') ? 1 : 0),
  0,
);

const dispatchCampaign = async (campaignRecord) => {
  const campaign = await NotificationCampaign.findOneAndUpdate(
    { _id: campaignRecord._id, status: { $in: ['scheduled', 'sending'] } },
    { $set: { status: 'sending', failureReason: undefined } },
    { new: true },
  );
  if (!campaign) return null;

  try {
    const campaignData = stringifyData({
      ...mapToObject(campaign.data),
      campaignId: campaign.campaignId,
      recipientMode: campaign.recipientMode,
      customerSegment: campaign.customerSegment,
      scheduledAt: campaign.scheduledAt,
    });
    const results = [];
    if (campaign.recipientMode === 'adminRoles') {
      results.push(...await notifyRoles({
        roles: campaign.roles,
        title: campaign.title,
        message: campaign.message,
        type: campaign.type,
        priority: campaign.priority,
        data: campaignData,
        createdBy: campaign.createdBy,
      }));
    } else {
      for (const userId of campaign.userIds) {
        const notification = await notifyUser({
          userId,
          title: campaign.title,
          message: campaign.message,
          type: campaign.type,
          priority: campaign.priority,
          data: campaignData,
          createdBy: campaign.createdBy,
        });
        if (notification) results.push(notification);
      }
    }

    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.targetCount = results.length;
    campaign.pushQueued = pushQueuedCount(results);
    campaign.failureReason = undefined;
    await campaign.save();
    return campaign;
  } catch (error) {
    campaign.status = 'failed';
    campaign.failureReason = error.message.slice(0, 1000);
    await campaign.save();
    return campaign;
  }
};

const processDueCampaigns = async () => {
  if (processing) return;
  processing = true;
  try {
    const dueCampaigns = await NotificationCampaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: new Date() },
    }).sort({ scheduledAt: 1 }).limit(10);

    for (const campaign of dueCampaigns) {
      await dispatchCampaign(campaign);
    }
  } finally {
    processing = false;
  }
};

const startCampaignScheduler = ({ intervalMs = 60000 } = {}) => {
  if (schedulerHandle) return schedulerHandle;
  schedulerHandle = setInterval(() => {
    processDueCampaigns().catch((error) => {
      console.error('Notification campaign scheduler failed', error.message);
    });
  }, intervalMs);
  schedulerHandle.unref?.();
  processDueCampaigns().catch((error) => {
    console.error('Notification campaign startup processing failed', error.message);
  });
  return schedulerHandle;
};

const stopCampaignScheduler = () => {
  if (!schedulerHandle) return;
  clearInterval(schedulerHandle);
  schedulerHandle = null;
};

module.exports = {
  dispatchCampaign,
  processDueCampaigns,
  startCampaignScheduler,
  stopCampaignScheduler,
};
