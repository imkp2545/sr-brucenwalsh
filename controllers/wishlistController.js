const mongoose = require('mongoose');
const Wishlist = require('../models/wishlistModel');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { logAudit } = require('../utils/auditLogUtils');
const { addProductToCart } = require('./cartController');
const { presentProductForCustomer } = require('../utils/productPresentationUtils');

const getOrCreateWishlist = async (userId) => {
  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    try { wishlist = await Wishlist.create({ user: userId, items: [] }); } catch (error) {
      if (error.code !== 11000) throw error;
      wishlist = await Wishlist.findOne({ user: userId });
    }
  }
  return wishlist;
};

const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  await wishlist.populate({
    path: 'items.product',
    match: { status: 'active', deletedAt: null },
    select: 'name slug sku purchaseMode price compareAtPrice images variants stock reservedStock status',
  });
  const data = wishlist.toObject();
  data.items = data.items.map((item) => ({
    ...item,
    product: presentProductForCustomer(item.product),
  }));
  return ApiResponse.success(res, { data });
});

const addToWishlist = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.body;
  if (!mongoose.isValidObjectId(productId)) throw new AppError('Valid product ID is required', 422, 'INVALID_PRODUCT');
  const product = await Product.findOne({ _id: productId, status: 'active', deletedAt: null });
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  if (variantId && !product.variants.id(variantId)) throw new AppError('Product variant not found', 404, 'VARIANT_NOT_FOUND');

  const wishlist = await getOrCreateWishlist(req.user.id);
  const normalizedVariant = variantId ? String(variantId) : null;
  const exists = wishlist.items.some((item) => (
    String(item.product) === String(productId) && (item.variantId ? String(item.variantId) : null) === normalizedVariant
  ));
  if (exists) throw new AppError('Product is already in your wishlist', 409, 'WISHLIST_ITEM_EXISTS');
  wishlist.items.push({ product: productId, variantId: variantId || null });
  await wishlist.save();
  await logAudit(req, { action: 'update', resourceType: 'Wishlist', resourceId: wishlist._id, description: 'Product added to wishlist', statusCode: 201 });
  return ApiResponse.success(res, { statusCode: 201, message: 'Added to wishlist', data: wishlist.items.at(-1) });
});

const removeFromWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id });
  const item = wishlist?.items.id(req.params.itemId);
  if (!wishlist || !item) throw new AppError('Wishlist item not found', 404, 'WISHLIST_ITEM_NOT_FOUND');
  item.deleteOne();
  await wishlist.save();
  await logAudit(req, { action: 'update', resourceType: 'Wishlist', resourceId: wishlist._id, description: 'Product removed from wishlist', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Removed from wishlist' });
});

const moveToCart = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id });
  const item = wishlist?.items.id(req.params.itemId);
  if (!wishlist || !item) throw new AppError('Wishlist item not found', 404, 'WISHLIST_ITEM_NOT_FOUND');
  const cartResult = await addProductToCart({
    userId: req.user.id,
    productId: item.product,
    variantId: item.variantId,
    quantity: req.body.quantity || 1,
  });
  item.deleteOne();
  await wishlist.save();
  await logAudit(req, { action: 'update', resourceType: 'Wishlist', resourceId: wishlist._id, description: 'Wishlist item moved to cart', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Moved to cart', data: cartResult });
});

const clearWishlist = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  wishlist.items = [];
  await wishlist.save();
  return ApiResponse.success(res, { message: 'Wishlist cleared' });
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist, moveToCart, clearWishlist };
