const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const wishlistSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [wishlistItemSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

wishlistSchema.index({ user: 1, 'items.product': 1 });

module.exports = mongoose.model('Wishlist', wishlistSchema);
