const mongoose = require('mongoose');

const notificationCampaignSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    type: {
      type: String,
      enum: ['account', 'emailVerification', 'passwordReset', 'order', 'payment', 'shipment', 'return', 'refund', 'buyback', 'appointment', 'promotion', 'system'],
      required: true,
      index: true,
    },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    recipientMode: { type: String, enum: ['adminRoles', 'selectedCustomers', 'customerSegment'], required: true, index: true },
    customerSegment: { type: String, enum: ['allActive', 'verified', 'marketingOptIn', 'pushEnabled'] },
    roles: [{ type: String, enum: ['superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'] }],
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    status: { type: String, enum: ['scheduled', 'sending', 'sent', 'failed', 'cancelled'], default: 'scheduled', index: true },
    scheduledAt: { type: Date, required: true, index: true },
    sentAt: { type: Date },
    targetCount: { type: Number, default: 0, min: 0 },
    pushQueued: { type: Number, default: 0, min: 0 },
    failureReason: { type: String, maxlength: 1000 },
    data: { type: Map, of: String, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

notificationCampaignSchema.index({ createdBy: 1, createdAt: -1 });
notificationCampaignSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('NotificationCampaign', notificationCampaignSchema);
