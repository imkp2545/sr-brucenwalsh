const mongoose = require('mongoose');

const reviewImageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
}, { _id: false });

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, trim: true, maxlength: 120 },
  body: { type: String, required: true, trim: true, maxlength: 2000 },
  images: { type: [reviewImageSchema], default: [] },
  isVerifiedPurchase: { type: Boolean, default: true, immutable: true },
  status: { type: String, enum: ['published', 'pending', 'approved', 'rejected'], default: 'published', index: true },
  moderationNote: { type: String, trim: true, maxlength: 1000 },
  moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  moderatedAt: { type: Date },
  helpfulBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  helpfulCount: { type: Number, default: 0, min: 0 },
  editedAt: { type: Date },
}, { timestamps: true, optimisticConcurrency: true });

reviewSchema.index({ user: 1, orderItemId: 1 }, { unique: true });
reviewSchema.index({ product: 1, status: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
