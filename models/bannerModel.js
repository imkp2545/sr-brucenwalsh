const mongoose = require('mongoose');

const collectionPlacementsRequiringTarget = new Set(['collectionHero', 'collectionInline']);

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    subtitle: { type: String, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 1000 },
    placement: {
      type: String,
      enum: ['homeHero', 'homeSecondary', 'homeFeature', 'homeStrip', 'categoryHero', 'collectionHero', 'collectionInline', 'productStrip', 'cart', 'wishlistHero', 'mobileHome'],
      required: true,
      index: true,
    },
    mobileImage: {
      url: { type: String, required: true },
      publicId: { type: String, required: true },
      alt: { type: String, required: true, maxlength: 160 },
      width: { type: Number, min: 1 },
      height: { type: Number, min: 1 },
    },
    video: { url: { type: String }, publicId: { type: String } },
    cta: {
      label: { type: String, trim: true, maxlength: 80 },
      linkType: { type: String, enum: ['internal', 'external', 'product', 'category', 'collection', 'none'], default: 'none' },
      url: { type: String, trim: true },
      referenceId: { type: mongoose.Schema.Types.ObjectId },
      openInNewTab: { type: Boolean, default: false },
    },
    audience: { type: String, enum: ['all', 'guest', 'authenticated', 'newCustomer', 'returningCustomer'], default: 'all' },
    platforms: [{ type: String, enum: ['web', 'ios', 'android'] }],
    targetPath: { type: String, trim: true, maxlength: 300, default: '', index: true },
    displayStyle: {
      type: String,
      enum: ['overlay', 'minimal', 'imageOnly'],
      default: 'overlay',
    },
    inlinePosition: {
      type: String,
      enum: ['distributed', 'top', 'bottom'],
      default: 'distributed',
    },
    inlineGroup: {
      type: String,
      enum: ['setA', 'setB', 'setC', 'setD'],
      default: 'setA',
    },
    showContent: { type: Boolean, default: true },
    contentAlignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    contentTheme: { type: String, enum: ['light', 'dark'], default: 'light' },
    displayOrder: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'inactive', 'expired'], default: 'draft', index: true },
    clickCount: { type: Number, default: 0, min: 0 },
    impressionCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, versionKey: false },
);

bannerSchema.index({ placement: 1, status: 1, startsAt: 1, endsAt: 1 });
bannerSchema.index({ placement: 1, displayOrder: 1 });

bannerSchema.pre('validate', function validateSchedule(next) {
  if (collectionPlacementsRequiringTarget.has(this.placement) && !this.targetPath) {
    return next(new Error('A specific collection page is required for collection banners'));
  }
  if (this.endsAt && this.endsAt <= this.startsAt) return next(new Error('Banner end must be after start'));
  return next();
});

module.exports = mongoose.model('Banner', bannerSchema);
