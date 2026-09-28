if (false) {
const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({ url: { type: String, required: true }, publicId: String, alt: String, isMain: { type: Boolean, default: false } }, { _id: false });
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 }, slug: { type: String, required: true, unique: true, lowercase: true },
  image: imageSchema, banner: imageSchema, parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true }, displayOrder: { type: Number, default: 0 },
}, { timestamps: true });
const collectionSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true }, slug: { type: String, required: true, unique: true, lowercase: true }, description: String, image: imageSchema, status: { type: String, enum: ['active', 'inactive'], default: 'active' }, displayOrder: { type: Number, default: 0 } }, { timestamps: true });
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 180, index: 'text' }, sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, trim: true }, shortDescription: { type: String, maxlength: 500 }, description: { type: String, maxlength: 10000, index: 'text' },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true }, subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true }, collectionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection', index: true }],
  images: { type: [imageSchema], validate: [(v) => v.length > 0 && v.some((i) => i.isMain), 'A main image is required'] },
  price: { type: Number, required: true, min: 0, index: true }, offerPrice: { type: Number, min: 0 }, stock: { type: Number, required: true, min: 0, default: 0 }, lowStockThreshold: { type: Number, default: 3, min: 0 },
  metalType: { type: String, trim: true, index: true }, purity: { type: String, trim: true, index: true }, weight: { type: Number, min: 0 }, colors: [String], size: String,
  certification: { name: String, number: String, url: String }, specifications: { type: Map, of: String },
  availability: { type: String, enum: ['inStock', 'outOfStock', 'madeToOrder', 'limitedStock', 'priceOnRequest', 'comingSoon', 'inactive'], default: 'inStock', index: true },
  status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'draft', index: true }, isFeatured: { type: Boolean, default: false, index: true }, soldCount: { type: Number, default: 0, index: true },
}, { timestamps: true, optimisticConcurrency: true });
productSchema.pre('validate', function validateOffer() { if (this.offerPrice != null && this.offerPrice > this.price) this.invalidate('offerPrice', 'Offer price cannot exceed price'); });
productSchema.index({ status: 1, categoryId: 1, price: 1, createdAt: -1 });
const couponSchema = new mongoose.Schema({ code: { type: String, required: true, unique: true, uppercase: true, trim: true }, type: { type: String, enum: ['percentage', 'fixed'], required: true }, value: { type: Number, required: true, min: 0 }, minimumOrder: { type: Number, default: 0 }, maximumDiscount: Number, startsAt: Date, expiresAt: Date, usageLimit: Number, usedCount: { type: Number, default: 0 }, isActive: { type: Boolean, default: true } }, { timestamps: true });
const contentSchema = new mongoose.Schema({ title: { type: String, required: true }, slug: { type: String, required: true, unique: true }, content: String, status: { type: String, enum: ['draft', 'published'], default: 'draft' }, metadata: mongoose.Schema.Types.Mixed }, { timestamps: true });
const bannerSchema = new mongoose.Schema({ title: String, image: { type: imageSchema, required: true }, link: String, position: String, displayOrder: { type: Number, default: 0 }, status: { type: String, enum: ['active', 'inactive'], default: 'active' }, startsAt: Date, endsAt: Date }, { timestamps: true });
module.exports = { Category: mongoose.model('Category', categorySchema), Collection: mongoose.model('Collection', collectionSchema), Product: mongoose.model('Product', productSchema), Coupon: mongoose.model('Coupon', couponSchema), CmsPage: mongoose.model('CmsPage', contentSchema), Banner: mongoose.model('Banner', bannerSchema) };
}

module.exports = {
  Category: require('./categoryModel'),
  Collection: require('./collectionModel'),
  Product: require('./productModel'),
  Coupon: require('./couponModel'),
  CmsPage: require('./cmsPageModel'),
  Banner: require('./bannerModel'),
};
