const mongoose = require('mongoose');

const inventoryMovementSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    sku: { type: String, required: true, uppercase: true, trim: true, index: true },
    productName: { type: String, required: true, trim: true },
    variantName: { type: String, trim: true },
    type: {
      type: String,
      enum: ['initial', 'add', 'remove', 'set', 'correction', 'damaged', 'sale', 'restock'],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['manual', 'productEdit', 'payment', 'return', 'refund', 'system'],
      required: true,
      index: true,
    },
    quantityBefore: { type: Number, required: true, min: 0 },
    quantityAfter: { type: Number, required: true, min: 0 },
    reservedBefore: { type: Number, default: 0, min: 0 },
    reservedAfter: { type: Number, default: 0, min: 0 },
    delta: { type: Number, required: true },
    reason: { type: String, trim: true, maxlength: 160 },
    note: { type: String, trim: true, maxlength: 1000 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    referenceModel: { type: String, trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    referenceLabel: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true, versionKey: false },
);

inventoryMovementSchema.index({ product: 1, variantId: 1, createdAt: -1 });
inventoryMovementSchema.index({ createdAt: -1 });
inventoryMovementSchema.index({ sku: 'text', productName: 'text', variantName: 'text', reason: 'text' });

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);
