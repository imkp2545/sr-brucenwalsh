const mongoose = require('mongoose');

const trackingEventSchema = new mongoose.Schema({
  statusCode: { type: String, trim: true },
  status: { type: String, required: true, trim: true },
  description: { type: String, trim: true, maxlength: 1000 },
  location: { type: String, trim: true, maxlength: 200 },
  occurredAt: { type: Date, required: true },
}, { _id: false });

const returnItemSchema = new mongoose.Schema(
  {
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    reason: {
      type: String,
      enum: ['damaged', 'defective', 'wrongItem', 'notAsDescribed', 'sizeIssue', 'qualityIssue', 'changedMind', 'other'],
      required: true,
    },
    reasonDetails: { type: String, maxlength: 1500 },
    condition: { type: String, enum: ['unopened', 'unused', 'opened', 'damaged'], required: true },
    resolution: { type: String, enum: ['refund', 'storeCredit'], required: true },
    images: [{ url: { type: String, required: true }, publicId: { type: String, required: true }, _id: false }],
    inspectionStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    inspectionNote: { type: String, maxlength: 1000 },
    approvedAmount: { type: Number, min: 0 },
    restockedAt: { type: Date },
  },
  { _id: true },
);

const returnSchema = new mongoose.Schema(
  {
    returnNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment' },
    items: { type: [returnItemSchema], required: true, validate: [(items) => items.length > 0, 'Return requires at least one item'] },
    status: {
      type: String,
      enum: ['requested', 'underReview', 'approved', 'rejected', 'pickupScheduled', 'pickedUp', 'received', 'inspected', 'refundInitiated', 'completed', 'cancelled'],
      default: 'requested',
      index: true,
    },
    pickupAddress: {
      recipientName: { type: String, required: true },
      phone: { type: String, required: true },
      line1: { type: String, required: true },
      line2: { type: String },
      landmark: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, default: 'India' },
    },
    returnShippingProvider: { type: String, enum: ['blueDart', 'customer', 'manual'] },
    returnAwbNumber: { type: String, uppercase: true, trim: true, sparse: true },
    reversePickup: {
      status: {
        type: String,
        enum: ['notScheduled', 'creating', 'pickupScheduled', 'cancelling', 'pickedUp', 'inTransit', 'received', 'cancelled', 'failed'],
        default: 'notScheduled',
      },
      awbNumber: { type: String, uppercase: true, trim: true },
      tokenNumber: { type: String, trim: true },
      registrationDate: { type: Date },
      requestedPickupAt: { type: Date },
      areaCode: { type: String, uppercase: true, trim: true, maxlength: 10 },
      weight: { type: Number, min: 0 },
      weightUnit: { type: String, enum: ['kg'], default: 'kg' },
      dimensions: {
        length: { type: Number, min: 0 },
        width: { type: Number, min: 0 },
        height: { type: Number, min: 0 },
        unit: { type: String, enum: ['cm'], default: 'cm' },
      },
      labelUrl: { type: String, trim: true },
      labelBase64: { type: String, select: false },
      trackingEvents: { type: [trackingEventSchema], default: [] },
      lastTrackedAt: { type: Date },
      pickedUpAt: { type: Date },
      receivedAt: { type: Date },
      cancelledAt: { type: Date },
      cancellationReason: { type: String, trim: true, maxlength: 1000 },
      failureCode: { type: String, trim: true, maxlength: 120 },
      failureReason: { type: String, trim: true, maxlength: 1000 },
      idempotencyKey: { type: String, select: false },
      cancelIdempotencyKey: { type: String, select: false },
      providerMetadata: { type: Map, of: String, default: {}, select: false },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    rejectionReason: { type: String, maxlength: 1500 },
    pickupScheduledAt: { type: Date },
    pickedUpAt: { type: Date },
    receivedAt: { type: Date },
    completedAt: { type: Date },
    resolutionReference: { type: String, trim: true, maxlength: 200 },
    resolutionNote: { type: String, trim: true, maxlength: 1500 },
    totalApprovedAmount: { type: Number, default: 0, min: 0 },
    statusHistory: [{
      status: { type: String, required: true },
      note: { type: String, maxlength: 1000 },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId },
      _id: false,
    }],
    internalNotes: { type: String, select: false, maxlength: 3000 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

returnSchema.index({ user: 1, createdAt: -1 });
returnSchema.index({ order: 1, status: 1 });
returnSchema.index({ status: 1, requestedAt: 1 });
returnSchema.index({ 'reversePickup.awbNumber': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Return', returnSchema);
