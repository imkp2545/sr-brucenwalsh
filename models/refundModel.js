const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    refundNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    returnRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'Return', default: null, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gateway: { type: String, enum: ['hdfc', 'manual', 'storeCredit'], required: true },
    gatewayRefundId: { type: String, unique: true, sparse: true },
    bankReferenceNumber: { type: String, sparse: true },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    reason: {
      type: String,
      enum: ['orderCancelled', 'returnApproved', 'itemUnavailable', 'duplicatePayment', 'priceAdjustment', 'goodwill', 'other'],
      required: true,
    },
    reasonDetails: { type: String, maxlength: 1500 },
    status: {
      type: String,
      enum: ['requested', 'approved', 'processing', 'succeeded', 'failed', 'cancelled'],
      default: 'requested',
      index: true,
    },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    processedAt: { type: Date },
    completedAt: { type: Date },
    failedAt: { type: Date },
    failureCode: { type: String },
    failureReason: { type: String, maxlength: 1000 },
    idempotencyKey: { type: String, unique: true, sparse: true, select: false },
    gatewayResponse: { type: Map, of: String, default: {}, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

refundSchema.index({ order: 1, createdAt: -1 });
refundSchema.index({ user: 1, createdAt: -1 });
refundSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Refund', refundSchema);
