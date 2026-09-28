const mongoose = require('mongoose');

const addressSnapshotSchema = new mongoose.Schema(
  {
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    line1: { type: String, required: true },
    line2: { type: String },
    landmark: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true, default: 'India' },
  },
  { _id: false },
);

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    slug: { type: String },
    image: { type: String },
    attributes: [{ name: String, value: String, _id: false }],
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    discount: { type: Number, default: 0, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    cgstRate: { type: Number, min: 0, max: 100, default: 1.5 },
    cgstAmount: { type: Number, default: 0, min: 0 },
    sgstRate: { type: Number, min: 0, max: 100, default: 1.5 },
    sgstAmount: { type: Number, default: 0, min: 0 },
    igstRate: { type: Number, min: 0, max: 100, default: 0 },
    igstAmount: { type: Number, default: 0, min: 0 },
    gstRate: { type: Number, min: 0, max: 100, default: 3 },
    taxAmount: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    hsnCode: { type: String },
    buybackReservedQuantity: { type: Number, default: 0, min: 0 },
    buybackCompletedQuantity: { type: Number, default: 0, min: 0 },
    fulfillmentStatus: {
      type: String,
      enum: ['unfulfilled', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'unfulfilled',
    },
  },
  { _id: true },
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, maxlength: 1000 },
    changedByType: { type: String, enum: ['system', 'user', 'admin'], default: 'system' },
    changedBy: { type: mongoose.Schema.Types.ObjectId },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const legalAcceptanceSchema = new mongoose.Schema(
  {
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'CmsPage', required: true },
    title: { type: String, required: true, maxlength: 200 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    documentVersion: { type: String, required: true, maxlength: 40 },
    cmsVersion: { type: Number, required: true, min: 1 },
    effectiveAt: { type: Date, required: true },
    acceptedAt: { type: Date, required: true },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true, validate: [(items) => items.length > 0, 'Order requires at least one item'] },
    shippingAddress: { type: addressSnapshotSchema, required: true },
    billingAddress: { type: addressSnapshotSchema, required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    shippingCharge: { type: Number, default: 0, min: 0 },
    insuranceCharge: { type: Number, default: 0, min: 0 },
    cgst: { type: Number, default: 0, min: 0 },
    sgst: { type: Number, default: 0, min: 0 },
    igst: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    taxMode: { type: String, enum: ['intraState', 'interState'] },
    placeOfSupplyState: { type: String, trim: true, maxlength: 100 },
    supplierState: { type: String, trim: true, maxlength: 100 },
    roundOff: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    couponCode: { type: String, uppercase: true, trim: true },
    paymentMethod: { type: String, enum: ['hdfcCard', 'hdfcNetBanking', 'hdfcUpi', 'hdfcWallet', 'cod'], required: true },
    paymentStatus: { type: String, enum: ['pending', 'authorized', 'paid', 'failed', 'partiallyRefunded', 'refunded'], default: 'pending', index: true },
    fulfillmentStatus: {
      type: String,
      enum: ['unfulfilled', 'processing', 'packed', 'partiallyShipped', 'shipped', 'delivered', 'cancelled', 'partiallyReturned', 'returned'],
      default: 'unfulfilled',
      index: true,
    },
    orderStatus: {
      type: String,
      enum: ['pendingPayment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returnRequested', 'returned', 'closed'],
      default: 'pendingPayment',
      index: true,
    },
    source: { type: String, enum: ['web', 'mobileApp', 'admin'], default: 'web' },
    customerNote: { type: String, maxlength: 1000 },
    legalAcceptances: { type: [legalAcceptanceSchema], default: [] },
    internalNote: { type: String, select: false, maxlength: 3000 },
    statusHistory: { type: [statusHistorySchema], default: [] },
    confirmedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, maxlength: 1000 },
    deliveredAt: { type: Date },
    invoiceNumber: { type: String, unique: true, sparse: true },
    invoiceUrl: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true, select: false },
    metadata: { type: Map, of: String, default: {} },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform: (_document, value) => {
        if (Number(value.shippingCharge) === 0) delete value.shippingCharge;
        if (Number(value.insuranceCharge) === 0) delete value.insuranceCharge;
        return value;
      },
    },
  },
);

orderSchema.pre('validate', function enforceCurrentBillingPolicy() {
  const billingVersion = this.metadata?.get ? this.metadata.get('billingVersion') : this.metadata?.billingVersion;
  const taxMode = this.metadata?.get ? this.metadata.get('taxMode') : this.metadata?.taxMode;
  const usesExclusiveBilling = ['fixed-cgst-sgst-v1', 'state-based-gst-v2'].includes(billingVersion)
    || taxMode === 'exclusive'
    || ['intraState', 'interState'].includes(this.taxMode);
  if (this.isNew && usesExclusiveBilling) {
    this.shippingCharge = 0;
    this.insuranceCharge = 0;
  }
  if (this.isNew && billingVersion === 'state-based-gst-v2') {
    if (this.taxMode === 'intraState') this.igst = 0;
    if (this.taxMode === 'interState') {
      this.cgst = 0;
      this.sgst = 0;
    }
    this.tax = Math.round((Number(this.cgst) + Number(this.sgst) + Number(this.igst)) * 100) / 100;
  }
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'items.product': 1, createdAt: -1 });
orderSchema.index({ 'shippingAddress.phone': 1 });

module.exports = mongoose.model('Order', orderSchema);
