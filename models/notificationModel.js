const mongoose = require('mongoose');

const deliverySchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['inApp', 'email', 'push', 'sms'], required: true },
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'failed', 'skipped'], default: 'queued' },
    providerMessageId: { type: String },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, maxlength: 1000 },
    attemptCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const notificationSchema = new mongoose.Schema(
  {
    recipientType: { type: String, enum: ['user', 'admin', 'topic'], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null, index: true },
    topic: { type: String, trim: true, index: true },
    type: {
      type: String,
      enum: ['account', 'emailVerification', 'passwordReset', 'order', 'payment', 'shipment', 'return', 'refund', 'buyback', 'appointment', 'support', 'promotion', 'system'],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    channels: [{ type: String, enum: ['inApp', 'email', 'push', 'sms'] }],
    delivery: { type: [deliverySchema], default: [] },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    action: {
      label: { type: String, maxlength: 80 },
      type: { type: String, enum: ['screen', 'url', 'order', 'product', 'appointment', 'buyback', 'none'], default: 'none' },
      value: { type: String, maxlength: 1000 },
    },
    data: { type: Map, of: String, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    scheduledAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ admin: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ scheduledAt: 1, 'delivery.status': 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('Notification', notificationSchema);
