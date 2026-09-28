const mongoose = require('mongoose');

const realTimeEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, trim: true },
    eventType: {
      type: String,
      enum: ['orderCreated', 'orderUpdated', 'paymentUpdated', 'shipmentUpdated', 'returnUpdated', 'refundUpdated', 'buybackUpdated', 'inventoryUpdated', 'notificationCreated', 'appointmentUpdated', 'userPresence', 'adminAlert', 'systemAlert'],
      required: true,
      index: true,
    },
    aggregateType: { type: String, enum: ['Order', 'Payment', 'Shipment', 'Return', 'Refund', 'Buyback', 'Product', 'Notification', 'Appointment', 'User', 'System'], required: true },
    aggregateId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    actorType: { type: String, enum: ['system', 'user', 'admin', 'webhook'], default: 'system' },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    recipients: {
      users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
      roles: [{ type: String }],
      rooms: [{ type: String }],
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'published', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    publishedAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, maxlength: 1000 },
    correlationId: { type: String, index: true },
    occurredAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true, versionKey: false },
);

realTimeEventSchema.index({ status: 1, occurredAt: 1 });
realTimeEventSchema.index({ aggregateType: 1, aggregateId: 1, occurredAt: -1 });
realTimeEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RealTimeEvent', realTimeEventSchema);
