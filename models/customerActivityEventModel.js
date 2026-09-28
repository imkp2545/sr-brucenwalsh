const mongoose = require('mongoose');

const customerActivityEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, maxlength: 100 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sessionId: { type: String, required: true, maxlength: 100, index: true },
    name: {
      type: String,
      required: true,
      enum: [
        'session_started', 'session_ended', 'screen_view', 'screen_time',
        'product_view', 'product_time', 'product_image_view', 'product_share', 'reviews_view',
        'search', 'filters_applied', 'wishlist_add', 'wishlist_remove',
        'cart_add', 'cart_remove', 'checkout_started', 'payment_started',
      ],
      index: true,
    },
    screen: { type: String, maxlength: 160, default: '' },
    entityType: { type: String, enum: ['', 'product', 'category', 'collection'], default: '' },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    durationSeconds: { type: Number, min: 0, max: 3600, default: 0 },
    properties: {
      source: { type: String, maxlength: 80, default: '' },
      query: { type: String, maxlength: 120, default: '' },
      resultCount: { type: Number, min: 0, max: 100000 },
      categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
      collectionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      price: { type: Number, min: 0, max: 100000000 },
      imageIndex: { type: Number, min: 0, max: 100 },
      filters: { type: [String], default: undefined },
    },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
    appVersion: { type: String, maxlength: 40, default: '' },
    occurredAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

customerActivityEventSchema.index({ user: 1, occurredAt: -1 });
customerActivityEventSchema.index({ name: 1, occurredAt: -1 });
customerActivityEventSchema.index({ user: 1, sessionId: 1, occurredAt: 1 });
customerActivityEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CustomerActivityEvent', customerActivityEventSchema);
