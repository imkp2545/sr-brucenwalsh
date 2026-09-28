const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['new', 'inProgress', 'waitingForCustomer', 'resolved', 'closed'],
      required: true,
    },
    note: { type: String, trim: true, maxlength: 1000 },
    changedByType: { type: String, enum: ['user', 'admin', 'system'], required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const responseSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const customerReplySchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const supportEnquirySchema = new mongoose.Schema(
  {
    enquiryNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerSnapshot: {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
      phone: { type: String, trim: true, maxlength: 24 },
    },
    category: {
      type: String,
      enum: ['order', 'delivery', 'product', 'appointment', 'payment', 'returnRefund', 'account', 'other'],
      required: true,
      index: true,
    },
    subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
    message: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
    reference: { type: String, trim: true, maxlength: 100 },
    preferredContact: { type: String, enum: ['email', 'phone'], default: 'email' },
    status: {
      type: String,
      enum: ['new', 'inProgress', 'waitingForCustomer', 'resolved', 'closed'],
      default: 'new',
      index: true,
    },
    priority: {
      type: String,
      enum: ['normal', 'high', 'urgent'],
      default: 'normal',
      index: true,
    },
    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null, index: true },
    responses: { type: [responseSchema], default: [] },
    customerReplies: { type: [customerReplySchema], default: [] },
    internalNotes: { type: String, trim: true, maxlength: 3000, select: false },
    statusHistory: { type: [statusHistorySchema], default: [] },
    firstRespondedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

supportEnquirySchema.index({ user: 1, createdAt: -1 });
supportEnquirySchema.index({ status: 1, priority: 1, createdAt: -1 });
supportEnquirySchema.index({ assignedAdmin: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('SupportEnquiry', supportEnquirySchema);
