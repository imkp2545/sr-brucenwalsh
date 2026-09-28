const mongoose = require('mongoose');

const trackingEventSchema = new mongoose.Schema(
  {
    statusCode: { type: String },
    status: { type: String, required: true },
    description: { type: String, maxlength: 1000 },
    location: { type: String },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const packageItemSchema = new mongoose.Schema(
  {
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const shipmentSchema = new mongoose.Schema(
  {
    shipmentNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['blueDart', 'manual'], default: 'blueDart' },
    awbNumber: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    referenceNumber: { type: String, trim: true },
    serviceType: { type: String, trim: true },
    packageType: { type: String, enum: ['document', 'nonDocument'], default: 'nonDocument' },
    items: { type: [packageItemSchema], required: true },
    packageCount: { type: Number, default: 1, min: 1 },
    weight: { type: Number, required: true, min: 0 },
    weightUnit: { type: String, enum: ['g', 'kg'], default: 'kg' },
    dimensions: {
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
      unit: { type: String, enum: ['cm', 'in'], default: 'cm' },
    },
    status: {
      type: String,
      enum: ['pending', 'pickupScheduled', 'pickedUp', 'inTransit', 'outForDelivery', 'delivered', 'deliveryFailed', 'rtoInitiated', 'returned', 'cancelled'],
      default: 'pending',
      index: true,
    },
    trackingEvents: { type: [trackingEventSchema], default: [] },
    pickupScheduledAt: { type: Date },
    pickedUpAt: { type: Date },
    estimatedDeliveryAt: { type: Date },
    deliveredAt: { type: Date },
    recipientName: { type: String },
    proofOfDelivery: { url: { type: String }, publicId: { type: String }, receivedBy: { type: String } },
    labelUrl: { type: String },
    manifestNumber: { type: String },
    lastTrackedAt: { type: Date },
    deliveryAttempts: { type: Number, default: 0, min: 0 },
    failureReason: { type: String, maxlength: 1000 },
    providerMetadata: { type: Map, of: String, default: {}, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

shipmentSchema.index({ order: 1, createdAt: -1 });
shipmentSchema.index({ status: 1, estimatedDeliveryAt: 1 });
shipmentSchema.index({ user: 1, createdAt: -1 });
shipmentSchema.index({ referenceNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Shipment', shipmentSchema);
