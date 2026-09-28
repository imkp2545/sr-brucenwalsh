const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    alt: { type: String, trim: true, maxlength: 160 },
    position: { type: Number, default: 0, min: 0 },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true },
);

const dimensionSchema = new mongoose.Schema(
  {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ['mm', 'cm', 'in'], default: 'mm' },
  },
  { _id: false },
);

const variantSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, trim: true, maxlength: 120 },
    attributes: [
      {
        name: { type: String, required: true, trim: true },
        value: { type: String, required: true, trim: true },
        _id: false,
      },
    ],
    price: {
      type: Number,
      required() { return this.ownerDocument()?.purchaseMode !== 'appointmentOnly'; },
      min: 0,
    },
    compareAtPrice: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0, select: false },
    stock: { type: Number, default: 0, min: 0 },
    reservedStock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    weight: { type: Number, min: 0 },
    dimensions: dimensionSchema,
    image: imageSchema,
    barcode: { type: String, trim: true },
    status: { type: String, enum: ['active', 'inactive', 'outOfStock'], default: 'active' },
  },
  { _id: true },
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 230 },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    shortDescription: { type: String, trim: true, maxlength: 500 },
    description: { type: String, required: true, trim: true, maxlength: 20000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }],
    brand: { type: String, trim: true, default: 'Bruce & Walsh', maxlength: 120 },
    productType: { type: String, enum: ['jewellery', 'watch', 'accessory', 'gift', 'other'], required: true },
    purchaseMode: { type: String, enum: ['online', 'appointmentOnly'], default: 'online', index: true },
    gender: { type: String, enum: ['men', 'women', 'unisex', 'kids'], default: 'unisex' },
    material: [{ type: String, trim: true }],
    gemstone: [{ type: String, trim: true }],
    color: [{ type: String, trim: true }],
    tags: [{ type: String, lowercase: true, trim: true }],
    price: {
      type: Number,
      required() { return this.purchaseMode !== 'appointmentOnly'; },
      min: 0,
    },
    compareAtPrice: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0, select: false },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    taxCode: { type: String, trim: true },
    gstRate: { type: Number, min: 0, max: 100, default: 3 },
    hsnCode: { type: String, trim: true },
    stock: { type: Number, default: 0, min: 0 },
    reservedStock: { type: Number, default: 0, min: 0 },
    trackInventory: { type: Boolean, default: true },
    allowBackorder: { type: Boolean, default: false },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    variants: { type: [variantSchema], default: [] },
    images: { type: [imageSchema], default: [] },
    video: { url: { type: String }, publicId: { type: String }, thumbnailUrl: { type: String } },
    weight: { type: Number, min: 0 },
    weightUnit: { type: String, enum: ['g', 'kg'], default: 'g' },
    dimensions: dimensionSchema,
    careInstructions: { type: String, maxlength: 3000 },
    warranty: { type: String, maxlength: 1000 },
    authenticityDetails: { type: String, maxlength: 2000 },
    seo: {
      title: { type: String, maxlength: 70 },
      description: { type: String, maxlength: 170 },
      keywords: [{ type: String, lowercase: true, trim: true }],
    },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    salesCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'inactive', 'archived'], default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    isNewArrival: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

productSchema.index({ name: 'text', description: 'text', tags: 'text', sku: 'text' });
productSchema.index({ status: 1, category: 1, price: 1 });
productSchema.index({ collections: 1, status: 1 });
productSchema.index({ purchaseMode: 1, status: 1, createdAt: -1 });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
productSchema.index({ isFeatured: 1, status: 1, createdAt: -1 });
productSchema.index({ salesCount: -1, status: 1 });

productSchema.virtual('availableStock').get(function availableStock() {
  return Math.max(0, this.stock - this.reservedStock);
});

module.exports = mongoose.model('Product', productSchema);
