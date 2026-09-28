const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    image: { type: String },
    attributes: [
      {
        name: { type: String, required: true },
        value: { type: String, required: true },
        _id: false,
      },
    ],
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    couponCode: { type: String, uppercase: true, trim: true, default: null },
    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    cgst: { type: Number, default: 0, min: 0 },
    sgst: { type: Number, default: 0, min: 0 },
    igst: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    taxMode: { type: String, enum: ['intraState', 'interState'], default: 'intraState' },
    placeOfSupplyState: { type: String, trim: true, maxlength: 100, default: 'Maharashtra' },
    supplierState: { type: String, trim: true, maxlength: 100, default: 'Maharashtra' },
    shipping: { type: Number, default: 0, min: 0 },
    insurance: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform: (_document, value) => {
        delete value.shipping;
        delete value.insurance;
        value.taxBreakup = {
          mode: value.taxMode,
          placeOfSupplyState: value.placeOfSupplyState,
          supplierState: value.supplierState,
          totalRate: 3,
          cgst: { rate: value.taxMode === 'intraState' ? 1.5 : 0, amount: Number(value.cgst || 0) },
          sgst: { rate: value.taxMode === 'intraState' ? 1.5 : 0, amount: Number(value.sgst || 0) },
          igst: { rate: value.taxMode === 'interState' ? 3 : 0, amount: Number(value.igst || 0) },
          totalTax: Number(value.tax || 0),
        };
        return value;
      },
    },
  },
);

cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
cartSchema.index({ 'items.product': 1 });

cartSchema.pre('save', function calculateTotals() {
  this.subtotal = this.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  this.shipping = 0;
  this.insurance = 0;
  const cgst = Number(this.cgst || 0);
  const sgst = Number(this.sgst || 0);
  const igst = Number(this.igst || 0);
  this.tax = Math.round((cgst + sgst + igst) * 100) / 100;
  this.total = Math.round(
    Math.max(0, this.subtotal - this.discount + cgst + sgst + igst) * 100,
  ) / 100;
});

module.exports = mongoose.model('Cart', cartSchema);
