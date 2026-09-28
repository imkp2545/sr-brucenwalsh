const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema(
  {
    metric: {
      type: String,
      enum: ['revenue', 'orders', 'customers', 'products', 'inventory', 'conversion', 'traffic', 'returns', 'refunds', 'appointments', 'campaign'],
      required: true,
      index: true,
    },
    granularity: { type: String, enum: ['hourly', 'daily', 'weekly', 'monthly', 'yearly'], required: true },
    periodStart: { type: Date, required: true, index: true },
    periodEnd: { type: Date, required: true },
    dimension: {
      type: { type: String, enum: ['global', 'product', 'category', 'collection', 'channel', 'region', 'campaign'], default: 'global' },
      referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
      key: { type: String, default: 'all' },
      label: { type: String },
    },
    values: {
      count: { type: Number, default: 0 },
      grossAmount: { type: Number, default: 0 },
      netAmount: { type: Number, default: 0 },
      taxAmount: { type: Number, default: 0 },
      discountAmount: { type: Number, default: 0 },
      shippingAmount: { type: Number, default: 0 },
      averageValue: { type: Number, default: 0 },
      minimumValue: { type: Number, default: 0 },
      maximumValue: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 },
      uniqueUsers: { type: Number, default: 0, min: 0 },
    },
    breakdown: { type: Map, of: Number, default: {} },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    source: { type: String, enum: ['aggregation', 'event', 'manual'], default: 'aggregation' },
    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false },
);

analyticsSchema.index(
  { metric: 1, granularity: 1, periodStart: 1, 'dimension.type': 1, 'dimension.key': 1 },
  { unique: true },
);
analyticsSchema.index({ metric: 1, periodStart: -1 });
analyticsSchema.index({ 'dimension.referenceId': 1, periodStart: -1 });

module.exports = mongoose.model('Analytics', analyticsSchema);
