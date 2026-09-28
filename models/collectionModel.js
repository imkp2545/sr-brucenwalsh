const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
    subtitle: { type: String, trim: true, maxlength: 250 },
    description: { type: String, trim: true, maxlength: 5000 },
    type: { type: String, enum: ['manual', 'seasonal'], default: 'manual' },
    heroImage: { url: { type: String }, publicId: { type: String }, alt: { type: String, maxlength: 160 } },
    mobileImage: { url: { type: String }, publicId: { type: String }, alt: { type: String, maxlength: 160 } },
    seo: {
      title: { type: String, maxlength: 70 },
      description: { type: String, maxlength: 170 },
      keywords: [{ type: String, trim: true, lowercase: true }],
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    displayOrder: { type: Number, default: 0, min: 0 },
    presentation: { type: String, enum: ['productCarousel', 'productGrid'], default: 'productCarousel' },
    showOnCollectionsScreen: { type: Boolean, default: true, index: true },
    showOnHome: { type: Boolean, default: false, index: true },
    homeTitle: { type: String, trim: true, maxlength: 150 },
    homeDisplayOrder: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'inactive', 'expired'], default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

collectionSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
collectionSchema.index({ isFeatured: 1, displayOrder: 1 });
collectionSchema.index({ status: 1, showOnCollectionsScreen: 1, displayOrder: 1 });
collectionSchema.index({ status: 1, showOnHome: 1, homeDisplayOrder: 1 });
collectionSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Collection', collectionSchema);
