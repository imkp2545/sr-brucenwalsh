const mongoose = require('mongoose');

const preferredSlotSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  { _id: true },
);

const visitAddressSchema = new mongoose.Schema(
  {
    recipientName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 150 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true, trim: true, maxlength: 12 },
    country: { type: String, required: true, trim: true, default: 'India' },
  },
  { _id: false },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 1000 },
    changedByType: { type: String, enum: ['user', 'admin', 'system'], required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const appointmentSchema = new mongoose.Schema(
  {
    appointmentNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['homeVisit'],
      default: 'homeVisit',
      immutable: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 3000 },
    productIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      validate: [(items) => items.length > 0, 'At least one high-end product is required'],
    },
    customerSnapshot: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, required: true, trim: true },
    },
    visitAddress: { type: visitAddressSchema, required: true },
    preferredSlots: {
      type: [preferredSlotSchema],
      validate: [
        (slots) => slots.length >= 1 && slots.length <= 3,
        'Provide between one and three preferred home-visit slots',
      ],
    },
    budget: {
      minimum: { type: Number, min: 0 },
      maximum: { type: Number, min: 0 },
      currency: { type: String, enum: ['INR'], default: 'INR' },
    },
    occasion: {
      type: String,
      enum: ['wedding', 'engagement', 'anniversary', 'festival', 'gifting', 'personal', 'other'],
      default: 'personal',
    },
    visitRequirements: {
      preferredLanguage: { type: String, trim: true, maxlength: 50 },
      accessibilityNotes: { type: String, trim: true, maxlength: 500 },
      securityInstructions: { type: String, trim: true, maxlength: 500 },
    },
    scheduledStart: { type: Date, index: true },
    scheduledEnd: { type: Date },
    timezone: { type: String, default: 'Asia/Kolkata' },
    location: {
      name: { type: String, trim: true },
      address: { type: String, trim: true },
      meetingUrl: { type: String, trim: true },
    },
    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', index: true },
    status: {
      type: String,
      enum: ['requested', 'underReview', 'confirmed', 'rescheduled', 'enRoute', 'completed', 'rejected', 'cancelled', 'noShow'],
      default: 'requested',
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    reviewedAt: { type: Date },
    confirmedAt: { type: Date },
    enRouteAt: { type: Date },
    rejection: {
      reason: { type: String, trim: true, maxlength: 1000 },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      rejectedAt: { type: Date },
    },
    cancellation: {
      cancelledByType: { type: String, enum: ['user', 'admin'] },
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, refPath: 'cancellation.cancelledByModel' },
      cancelledByModel: { type: String, enum: ['User', 'Admin'] },
      reason: { type: String, maxlength: 1000 },
      cancelledAt: { type: Date },
    },
    reminderSentAt: { type: Date },
    internalNotes: { type: String, select: false, maxlength: 3000 },
    outcome: {
      visitSummary: { type: String, trim: true, maxlength: 3000 },
      interestedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      followUpRequired: { type: Boolean, default: false },
      followUpAt: { type: Date },
      quotationRequired: { type: Boolean, default: false },
      saleConverted: { type: Boolean, default: false },
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    completedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

appointmentSchema.index({ user: 1, scheduledStart: -1 });
appointmentSchema.index({ assignedAdmin: 1, scheduledStart: 1, status: 1 });
appointmentSchema.index({ status: 1, scheduledStart: 1 });

appointmentSchema.pre('validate', function validateSchedule(next) {
  for (const slot of this.preferredSlots || []) {
    if (slot.end <= slot.start) return next(new Error('Preferred slot end must be after its start'));
  }
  if ((this.scheduledStart && !this.scheduledEnd) || (!this.scheduledStart && this.scheduledEnd)) {
    return next(new Error('Confirmed visit requires both scheduled start and end'));
  }
  if (this.scheduledStart && this.scheduledEnd <= this.scheduledStart) {
    return next(new Error('Scheduled visit end must be after start'));
  }
  if (['confirmed', 'rescheduled', 'enRoute', 'completed', 'noShow'].includes(this.status)) {
    if (!this.scheduledStart || !this.scheduledEnd || !this.assignedAdmin) {
      return next(new Error('Scheduled home visit requires a consultant, start, and end time'));
    }
  }
  return next();
});

module.exports = mongoose.model('Appointment', appointmentSchema);
