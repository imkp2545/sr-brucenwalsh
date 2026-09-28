const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['product', 'igiCertificate', 'inspection', 'settlementProof'],
      required: true,
    },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    deliveryType: { type: String, default: 'authenticated' },
    originalName: { type: String, trim: true, maxlength: 255 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const slotSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  { _id: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 1200 },
    changedByType: { type: String, enum: ['user', 'admin', 'system'], required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const buybackSchema = new mongoose.Schema(
  {
    buybackNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    itemSnapshot: {
      sku: { type: String, required: true, uppercase: true, trim: true },
      name: { type: String, required: true, trim: true },
      image: { type: String },
      attributes: [{ name: String, value: String, _id: false }],
      quantity: { type: Number, required: true, min: 1 },
      purchasedQuantity: { type: Number, required: true, min: 1 },
      unitPrice: { type: Number, required: true, min: 0 },
      discount: { type: Number, default: 0, min: 0 },
      taxableAmount: { type: Number, required: true, min: 0 },
      taxAmount: { type: Number, default: 0, min: 0 },
      invoiceLineTotal: { type: Number, required: true, min: 0 },
      buybackBaseAmount: { type: Number, required: true, min: 0 },
    },
    policy: {
      ratePercent: { type: Number, required: true, min: 0, max: 100 },
      windowMonths: { type: Number, required: true, min: 1 },
      version: { type: String, required: true, trim: true },
      estimatedAmount: { type: Number, required: true, min: 0 },
      purchaseDate: { type: Date, required: true },
      eligibilityDeadline: { type: Date, required: true, index: true },
      invoiceNumber: { type: String, required: true, trim: true },
    },
    igiCertificateNumber: { type: String, required: true, uppercase: true, trim: true, maxlength: 100 },
    reason: { type: String, trim: true, maxlength: 500 },
    customerNote: { type: String, trim: true, maxlength: 3000 },
    declarations: {
      jewellerySameCondition: { type: Boolean, required: true },
      originalIgiCertificateAvailable: { type: Boolean, required: true },
      originalInvoiceAvailable: { type: Boolean, required: true },
      policyAccepted: { type: Boolean, required: true },
      acceptedAt: { type: Date, required: true },
    },
    evidence: { type: [mediaSchema], default: [], select: false },
    appointment: {
      preferredSlots: {
        type: [slotSchema],
        validate: [(slots) => slots.length >= 1 && slots.length <= 3, 'Provide between one and three preferred slots'],
      },
      shop: {
        name: { type: String, trim: true, maxlength: 160 },
        address: { type: String, trim: true, maxlength: 500 },
        city: { type: String, trim: true, maxlength: 100 },
        state: { type: String, trim: true, maxlength: 100 },
        postalCode: { type: String, trim: true, maxlength: 12 },
        phone: { type: String, trim: true, maxlength: 20 },
      },
      scheduledStart: { type: Date, index: true },
      scheduledEnd: { type: Date },
      assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      confirmedAt: { type: Date },
      checkedInAt: { type: Date },
    },
    inspection: {
      identityVerified: { type: Boolean, default: false },
      ownershipVerified: { type: Boolean, default: false },
      originalInvoicePresented: { type: Boolean, default: false },
      originalIgiCertificatePresented: { type: Boolean, default: false },
      igiCertificateGoodCondition: { type: Boolean, default: false },
      jewellerySameCondition: { type: Boolean, default: false },
      productMatched: { type: Boolean, default: false },
      note: { type: String, trim: true, maxlength: 3000 },
      images: { type: [mediaSchema], default: [], select: false },
      startedAt: { type: Date },
      startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      completedAt: { type: Date },
      completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    },
    offer: {
      amount: { type: Number, min: 0 },
      ratePercent: { type: Number, min: 0, max: 100 },
      generatedAt: { type: Date },
      acceptedAt: { type: Date },
      declinedAt: { type: Date },
      customerAcceptanceIp: { type: String },
      policyVersion: { type: String },
    },
    settlement: {
      mode: { type: String, enum: ['neft', 'imps', 'cheque', 'cash', 'storeCredit'] },
      reference: { type: String, trim: true, maxlength: 160 },
      paidAt: { type: Date },
      note: { type: String, trim: true, maxlength: 2000 },
      proof: { type: mediaSchema, select: false },
      startedAt: { type: Date },
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    },
    closure: {
      reason: { type: String, trim: true, maxlength: 1500 },
      itemReturnedAt: { type: Date },
      returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      handoverNote: { type: String, trim: true, maxlength: 1500 },
    },
    status: {
      type: String,
      enum: [
        'requested', 'appointmentScheduled', 'checkedIn', 'underInspection', 'offerReady',
        'customerAccepted', 'settlementPending', 'withdrawalRequested', 'customerDeclined',
        'rejected', 'cancelled', 'noShow', 'closed', 'completed',
      ],
      default: 'requested',
      index: true,
    },
    rejectionReason: { type: String, trim: true, maxlength: 1500 },
    idempotencyKey: { type: String, unique: true, sparse: true, select: false },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true },
);

buybackSchema.index({ user: 1, createdAt: -1 });
buybackSchema.index({ order: 1, orderItemId: 1, status: 1 });
buybackSchema.index({ status: 1, 'appointment.scheduledStart': 1 });

buybackSchema.pre('validate', function validateAppointment(next) {
  for (const slot of this.appointment?.preferredSlots || []) {
    if (slot.end <= slot.start) return next(new Error('Preferred slot end must be after its start'));
  }
  const { scheduledStart, scheduledEnd } = this.appointment || {};
  if ((scheduledStart && !scheduledEnd) || (!scheduledStart && scheduledEnd)) {
    return next(new Error('Scheduled shop visit requires start and end times'));
  }
  if (scheduledStart && scheduledEnd <= scheduledStart) {
    return next(new Error('Scheduled shop visit end must be after its start'));
  }
  return next();
});

module.exports = mongoose.model('Buyback', buybackSchema);
