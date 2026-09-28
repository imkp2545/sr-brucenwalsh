const mongoose = require('mongoose');
const Review = require('../models/reviewModel');
const Product = require('../models/productModel');
const Order = require('../models/orderModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { flattenFiles, uploadBuffer, deleteAssets } = require('../utils/cloudinaryUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const publishedReviewFilter = (productId) => ({
  ...(productId ? { product: productId } : {}),
  status: { $ne: 'rejected' },
});

const recalculateProductRating = async (productId) => {
  const [summary] = await Review.aggregate([
    { $match: publishedReviewFilter(productId) },
    { $group: { _id: null, averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } },
  ]);
  await Product.updateOne({ _id: productId }, {
    $set: {
      averageRating: summary ? Math.round(summary.averageRating * 10) / 10 : 0,
      reviewCount: summary?.reviewCount || 0,
    },
  });
};

const createReview = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.body.orderId, user: req.user.id });
  if (!order) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  if (order.orderStatus !== 'delivered' && order.orderStatus !== 'closed') {
    throw new AppError('A review can be submitted after delivery', 409, 'ORDER_NOT_DELIVERED');
  }
  const orderItem = order.items.id(req.body.orderItemId);
  if (!orderItem || String(orderItem.product) !== String(req.body.productId)) {
    throw new AppError('Product is not part of this order item', 422, 'INVALID_REVIEW_PRODUCT');
  }
  if (orderItem.fulfillmentStatus !== 'delivered' && order.orderStatus !== 'closed') {
    throw new AppError('This item has not been delivered', 409, 'ITEM_NOT_DELIVERED');
  }
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('Rating must be an integer from 1 to 5', 422, 'INVALID_RATING');
  const body = String(req.body.body || '').trim();
  if (!body) throw new AppError('Review text is required', 422, 'REVIEW_BODY_REQUIRED');
  if (await Review.exists({ user: req.user.id, orderItemId: orderItem._id })) {
    throw new AppError('You have already reviewed this purchased item', 409, 'REVIEW_ALREADY_EXISTS');
  }

  const uploadedAssets = [];
  let review;
  try {
    for (const file of flattenFiles(req.files)) {
      const uploaded = await uploadBuffer(file, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/reviews`,
      });
      uploadedAssets.push(uploaded);
    }
    review = await Review.create({
      user: req.user.id,
      product: orderItem.product,
      order: order._id,
      orderItemId: orderItem._id,
      rating,
      title: req.body.title,
      body,
      images: uploadedAssets.map(({ url, publicId }) => ({ url, publicId })),
      status: 'published',
      isVerifiedPurchase: true,
    });
    await recalculateProductRating(review.product);
    await logAudit(req, { action: 'create', resourceType: 'Review', resourceId: review._id, description: 'Customer published a verified-purchase review', statusCode: 201 });
    return ApiResponse.success(res, { statusCode: 201, message: 'Review published', data: review });
  } catch (error) {
    if (review) await review.deleteOne().catch(() => undefined);
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const listProductReviews = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) throw new AppError('Invalid product id', 422, 'INVALID_PRODUCT_ID');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const sort = req.query.sort === 'ratingHigh' ? { rating: -1, createdAt: -1 }
    : req.query.sort === 'helpful' ? { helpfulCount: -1, createdAt: -1 }
      : { createdAt: -1 };
  const filter = publishedReviewFilter(req.params.productId);
  if (req.query.rating) {
    const rating = Number(req.query.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('Rating filter must be from 1 to 5', 422, 'INVALID_RATING');
    filter.rating = rating;
  }
  const [reviews, total, distribution] = await Promise.all([
    Review.find(filter).select('-helpfulBy -moderationNote -moderatedBy').populate('user', 'firstName lastName')
      .sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Review.countDocuments(filter),
    Review.aggregate([
      { $match: publishedReviewFilter(new mongoose.Types.ObjectId(req.params.productId)) },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]),
  ]);
  return ApiResponse.success(res, { data: reviews, meta: { page, limit, total, pages: Math.ceil(total / limit), distribution } });
});

const listMyReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user.id }).select('-helpfulBy')
    .populate('product', 'name slug images').populate('order', 'orderNumber').sort({ createdAt: -1 }).lean();
  return ApiResponse.success(res, { data: reviews });
});

const updateMyReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.reviewId, user: req.user.id });
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  if (req.body.rating !== undefined) {
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('Rating must be an integer from 1 to 5', 422, 'INVALID_RATING');
    review.rating = rating;
  }
  if (req.body.title !== undefined) review.title = req.body.title;
  if (req.body.body !== undefined) {
    const body = String(req.body.body).trim();
    if (!body) throw new AppError('Review text is required', 422, 'REVIEW_BODY_REQUIRED');
    review.body = body;
  }
  review.status = 'published';
  review.moderationNote = undefined;
  review.moderatedBy = undefined;
  review.moderatedAt = undefined;
  review.editedAt = new Date();
  await review.save();
  await recalculateProductRating(review.product);
  return ApiResponse.success(res, { message: 'Review updated and published', data: review });
});

const deleteMyReview = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.reviewId, user: req.user.id });
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  const wasPublished = review.status !== 'rejected';
  const { product, images } = review;
  await review.deleteOne();
  await deleteAssets(images);
  if (wasPublished) await recalculateProductRating(product);
  return ApiResponse.success(res, { message: 'Review deleted' });
});

const toggleHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findOne({ _id: req.params.reviewId, status: { $ne: 'rejected' } });
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  const index = review.helpfulBy.findIndex((id) => String(id) === String(req.user.id));
  if (index >= 0) review.helpfulBy.splice(index, 1);
  else review.helpfulBy.push(req.user.id);
  review.helpfulCount = review.helpfulBy.length;
  await review.save();
  return ApiResponse.success(res, { data: { helpful: index < 0, helpfulCount: review.helpfulCount } });
});

const listReviewsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.rating) {
    const rating = Number(req.query.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('Rating filter must be from 1 to 5', 422, 'INVALID_RATING');
    baseFilter.rating = rating;
  }
  if (req.query.productId) baseFilter.product = req.query.productId;
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [reviews, total, summary] = await Promise.all([
    Review.find(filter).select('-helpfulBy -status -moderationNote -moderatedBy -moderatedAt').populate('user', 'firstName lastName email')
      .populate('product', 'name slug sku').populate('order', 'orderNumber')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Review.countDocuments(filter),
    summarizeStatusFields(Review, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: reviews,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getReviewAdmin = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId)
    .select('-helpfulBy -status -moderationNote -moderatedBy -moderatedAt')
    .populate('user', 'firstName lastName email phone')
    .populate('product', 'name slug sku images averageRating reviewCount')
    .populate('order', 'orderNumber deliveredAt orderStatus');
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  return ApiResponse.success(res, { data: review });
});

const deleteReviewAdmin = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');
  const wasPublished = review.status !== 'rejected';
  const { product, images } = review;
  await review.deleteOne();
  await deleteAssets(images);
  if (wasPublished) await recalculateProductRating(product);
  await logAudit(req, { action: 'delete', resourceType: 'Review', resourceId: review._id, description: 'Admin deleted a customer review', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Review deleted' });
});

module.exports = {
  createReview, listProductReviews, listMyReviews, updateMyReview, deleteMyReview,
  toggleHelpful, listReviewsAdmin, getReviewAdmin, deleteReviewAdmin,
};
