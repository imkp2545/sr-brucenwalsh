const mongoose = require('mongoose');

const legalMetadataSchema = new mongoose.Schema(
  {
    documentVersion: { type: String, trim: true, maxlength: 40 },
    effectiveAt: { type: Date },
    category: {
      type: String,
      enum: ['terms', 'privacy', 'shipping', 'returns', 'refunds', 'cancellation', 'buyback', 'general'],
      default: 'general',
    },
    displayOrder: { type: Number, default: 0, min: 0 },
    requiresAcceptance: { type: Boolean, default: false },
  },
  { _id: false },
);

const contentBlockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['richText', 'image', 'video', 'quote', 'accordion', 'gallery', 'productGrid', 'collectionGrid', 'html'],
      required: true,
    },
    heading: { type: String, trim: true, maxlength: 200 },
    content: { type: String, maxlength: 50000 },
    media: {
      url: { type: String },
      publicId: { type: String },
      alt: { type: String, maxlength: 160 },
      caption: { type: String, maxlength: 300 },
    },
    referenceIds: [{ type: mongoose.Schema.Types.ObjectId }],
    settings: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    displayOrder: { type: Number, default: 0, min: 0 },
    isVisible: { type: Boolean, default: true },
  },
  { _id: true },
);

const revisionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true },
    pageType: { type: String },
    excerpt: { type: String },
    blocks: { type: [contentBlockSchema], default: [] },
    legal: { type: legalMetadataSchema },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    changeNote: { type: String, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cmsPageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 230 },
    pageType: { type: String, enum: ['static', 'about', 'contact', 'policy', 'terms', 'faq', 'custom'], default: 'static' },
    excerpt: { type: String, trim: true, maxlength: 500 },
    blocks: { type: [contentBlockSchema], default: [] },
    seo: {
      title: { type: String, maxlength: 70 },
      description: { type: String, maxlength: 170 },
      keywords: [{ type: String, lowercase: true, trim: true }],
      canonicalUrl: { type: String },
      noIndex: { type: Boolean, default: false },
    },
    legal: { type: legalMetadataSchema, default: () => ({}) },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    version: { type: Number, default: 1, min: 1 },
    revisions: { type: [revisionSchema], default: [], select: false },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, versionKey: false },
);

cmsPageSchema.index({ status: 1, publishedAt: -1 });
cmsPageSchema.index({ pageType: 1, status: 1, 'legal.effectiveAt': 1, 'legal.displayOrder': 1 });
cmsPageSchema.index({ title: 'text', excerpt: 'text' });

module.exports = mongoose.model('CmsPage', cmsPageSchema);
