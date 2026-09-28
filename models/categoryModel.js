const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 2000 },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    image: { url: { type: String }, publicId: { type: String }, alt: { type: String, maxlength: 160 } },
    icon: { url: { type: String }, publicId: { type: String } },
    seo: {
      title: { type: String, trim: true, maxlength: 70 },
      description: { type: String, trim: true, maxlength: 170 },
      keywords: [{ type: String, trim: true, lowercase: true }],
    },
    displayOrder: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'inactive'], default: 'active', index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    showInMenu: { type: Boolean, default: true, index: true },
    menuSection: {
      type: String,
      enum: ['recipient', 'gender', 'productType', 'more'],
      default: 'productType',
      index: true,
    },
    menuLabel: { type: String, trim: true, maxlength: 80 },
    menuFilterType: {
      type: String,
      enum: ['category', 'gender', 'tag'],
      default: 'category',
    },
    menuFilterValue: { type: String, trim: true, maxlength: 120 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

categorySchema.index({ parent: 1, displayOrder: 1 });
categorySchema.index({ status: 1, isFeatured: 1, displayOrder: 1 });
categorySchema.index({ status: 1, showInMenu: 1, menuSection: 1, displayOrder: 1 });
categorySchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Category', categorySchema);
