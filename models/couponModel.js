const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    discountType: { type: String, enum: ['percentage', 'fixedAmount', 'freeShipping'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maximumDiscount: { type: Number, min: 0 },
    minimumOrderValue: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    appliesTo: { type: String, enum: ['allProducts', 'specificProducts', 'categories', 'collections'], default: 'allProducts' },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    collectionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }],
    excludedProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    customerEligibility: { type: String, enum: ['all', 'newCustomers', 'existingCustomers', 'specificCustomers'], default: 'all' },
    eligibleUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    usageLimit: { type: Number, min: 1 },
    usageLimitPerUser: { type: Number, default: 1, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'active', 'inactive', 'expired'], default: 'draft', index: true },
    isPublic: { type: Boolean, default: true },
    stackable: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true, versionKey: false },
);

couponSchema.index({ status: 1, startsAt: 1, expiresAt: 1 });
couponSchema.index({ isPublic: 1, status: 1 });

couponSchema.pre('validate', function validateCoupon(next) {
  if (this.expiresAt <= this.startsAt) return next(new Error('Coupon expiry must be after its start date'));
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    return next(new Error('Percentage discount cannot exceed 100'));
  }
  return next();
});

module.exports = mongoose.model('Coupon', couponSchema);
