const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 150 },
    group: {
      type: String,
      enum: ['general', 'app', 'appointment', 'store', 'tax', 'shipping', 'payment', 'email', 'notification', 'security', 'inventory', 'order', 'return', 'seo', 'social', 'maintenance'],
      required: true,
      index: true,
    },
    label: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, trim: true, maxlength: 1000 },
    valueType: { type: String, enum: ['string', 'number', 'boolean', 'json', 'array', 'date'], required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    defaultValue: { type: mongoose.Schema.Types.Mixed },
    validation: {
      required: { type: Boolean, default: false },
      minimum: { type: Number },
      maximum: { type: Number },
      pattern: { type: String },
      options: [{ type: mongoose.Schema.Types.Mixed }],
    },
    isPublic: { type: Boolean, default: false, index: true },
    isEditable: { type: Boolean, default: true },
    isSensitive: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, versionKey: false },
);

settingSchema.index({ group: 1, key: 1 });
settingSchema.index({ isPublic: 1, group: 1 });

module.exports = mongoose.model('Setting', settingSchema);
