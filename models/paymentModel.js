const mongoose = require('mongoose');

const paymentAttemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true, min: 1 },
    gatewayRequestId: { type: String },
    status: { type: String, enum: ['initiated', 'pending', 'authorized', 'captured', 'failed', 'cancelled'], required: true },
    errorCode: { type: String },
    errorMessage: { type: String, maxlength: 1000 },
    initiatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { _id: true },
);

const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    paymentReference: { type: String, required: true, unique: true, uppercase: true, trim: true },
    gateway: { type: String, enum: ['hdfc', 'cod'], required: true },
    gatewayOrderId: { type: String, trim: true, index: true, sparse: true },
    transactionId: { type: String, unique: true, sparse: true, trim: true },
    bankReferenceNumber: { type: String, trim: true },
    method: { type: String, enum: ['card', 'netBanking', 'upi', 'wallet', 'cod'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'pending', 'authorized', 'captured', 'failed', 'cancelled', 'partiallyRefunded', 'refunded'],
      default: 'created',
      index: true,
    },
    cardDetails: {
      network: { type: String, enum: ['visa', 'mastercard', 'rupay', 'amex', 'diners', 'other'] },
      last4: { type: String, minlength: 4, maxlength: 4 },
      issuer: { type: String },
      cardType: { type: String, enum: ['credit', 'debit', 'prepaid'] },
    },
    upiDetails: { vpaMasked: { type: String }, app: { type: String } },
    responseCode: { type: String },
    responseMessage: { type: String, maxlength: 1000 },
    signatureVerified: { type: Boolean, default: false },
    attempts: { type: [paymentAttemptSchema], default: [] },
    authorizedAt: { type: Date },
    capturedAt: { type: Date },
    failedAt: { type: Date },
    expiresAt: { type: Date },
    refundedAmount: { type: Number, default: 0, min: 0 },
    idempotencyKey: { type: String, unique: true, sparse: true, select: false },
    gatewayMetadata: { type: Map, of: String, default: {}, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ bankReferenceNumber: 1 }, { sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
