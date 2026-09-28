const mongoose = require('mongoose');
const Cart = require('../models/cartModel');
const Product = require('../models/productModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { productSnapshot, recalculateCart, findActiveCoupon } = require('../utils/calculationUtils');
const { logAudit } = require('../utils/auditLogUtils');

const normalizeVariantId = (variantId) => variantId ? String(variantId) : null;

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    try { cart = await Cart.create({ user: userId, items: [] }); } catch (error) {
      if (error.code !== 11000) throw error;
      cart = await Cart.findOne({ user: userId });
    }
  }
  return cart;
};

const addProductToCart = async ({ userId, productId, variantId, quantity = 1 }) => {
  if (!mongoose.isValidObjectId(productId)) throw new AppError('Valid product ID is required', 422, 'INVALID_PRODUCT');
  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 20) {
    throw new AppError('Quantity must be an integer between 1 and 20', 422, 'INVALID_QUANTITY');
  }

  const product = await Product.findOne({ _id: productId, status: 'active', deletedAt: null });
  if (!product) throw new AppError('Product is unavailable', 404, 'PRODUCT_NOT_FOUND');
  if (product.purchaseMode === 'appointmentOnly') {
    throw new AppError('This product is available by appointment only', 409, 'APPOINTMENT_ONLY_PRODUCT');
  }
  const snapshot = productSnapshot(product, variantId);
  const cart = await getOrCreateCart(userId);
  const requestedVariant = normalizeVariantId(snapshot.variantId);
  const existingItem = cart.items.find((item) => (
    String(item.product) === String(productId) && normalizeVariantId(item.variantId) === requestedVariant
  ));
  const desiredQuantity = (existingItem?.quantity || 0) + parsedQuantity;
  if (desiredQuantity > 20) throw new AppError('Maximum quantity per cart item is 20', 422, 'QUANTITY_LIMIT');
  if (snapshot.availableStock < desiredQuantity && !product.allowBackorder) {
    throw new AppError(`Only ${snapshot.availableStock} item(s) are available`, 409, 'INSUFFICIENT_STOCK');
  }

  if (existingItem) {
    existingItem.quantity = desiredQuantity;
  } else {
    cart.items.push({ ...snapshot, quantity: parsedQuantity });
  }
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const validation = await recalculateCart(cart, { removeInvalidCoupon: true });
  await cart.save();
  return { cart, validation };
};

const getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const validation = await recalculateCart(cart);
  return ApiResponse.success(res, { data: { cart, ...validation } });
});

const addItem = asyncHandler(async (req, res) => {
  const result = await addProductToCart({
    userId: req.user.id,
    productId: req.body.productId,
    variantId: req.body.variantId,
    quantity: req.body.quantity,
  });
  await logAudit(req, {
    action: 'update', resourceType: 'Cart', resourceId: result.cart._id,
    description: 'Item added to cart', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Item added to cart', data: result });
});

const updateItem = asyncHandler(async (req, res) => {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new AppError('Quantity must be an integer between 1 and 20', 422, 'INVALID_QUANTITY');
  }
  const cart = await Cart.findOne({ user: req.user.id });
  const item = cart?.items.id(req.params.itemId);
  if (!cart || !item) throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');

  const product = await Product.findOne({ _id: item.product, status: 'active', deletedAt: null });
  if (!product) throw new AppError('Product is unavailable', 409, 'PRODUCT_UNAVAILABLE');
  if (product.purchaseMode === 'appointmentOnly') {
    throw new AppError('This product is available by appointment only', 409, 'APPOINTMENT_ONLY_PRODUCT');
  }
  const snapshot = productSnapshot(product, item.variantId);
  if (snapshot.availableStock < quantity && !product.allowBackorder) {
    throw new AppError(`Only ${snapshot.availableStock} item(s) are available`, 409, 'INSUFFICIENT_STOCK');
  }
  item.quantity = quantity;
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const validation = await recalculateCart(cart, { removeInvalidCoupon: true });
  await cart.save();
  await logAudit(req, { action: 'update', resourceType: 'Cart', resourceId: cart._id, description: 'Cart quantity updated', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Cart updated', data: { cart, ...validation } });
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });
  const item = cart?.items.id(req.params.itemId);
  if (!cart || !item) throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');
  item.deleteOne();
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (!cart.items.length) {
    cart.coupon = null;
    cart.couponCode = null;
  }
  const validation = await recalculateCart(cart, { removeInvalidCoupon: true });
  await cart.save();
  await logAudit(req, { action: 'update', resourceType: 'Cart', resourceId: cart._id, description: 'Item removed from cart', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Item removed', data: { cart, ...validation } });
});

const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.items = [];
  cart.coupon = null;
  cart.couponCode = null;
  cart.discount = 0;
  cart.cgst = 0;
  cart.sgst = 0;
  cart.igst = 0;
  cart.tax = 0;
  cart.shipping = 0;
  cart.insurance = 0;
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await cart.save();
  await logAudit(req, { action: 'update', resourceType: 'Cart', resourceId: cart._id, description: 'Cart cleared', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Cart cleared', data: cart });
});

const applyCoupon = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart || !cart.items.length) throw new AppError('Cart is empty', 422, 'EMPTY_CART');
  const coupon = await findActiveCoupon(req.body.code);
  if (!coupon) throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
  cart.coupon = coupon._id;
  cart.couponCode = coupon.code;
  const validation = await recalculateCart(cart);
  if (validation.couponError) throw new AppError(validation.couponError.message, 422, validation.couponError.code);
  await cart.save();
  await logAudit(req, { action: 'update', resourceType: 'Cart', resourceId: cart._id, description: `Coupon ${coupon.code} applied`, statusCode: 200 });
  return ApiResponse.success(res, { message: 'Coupon applied', data: { cart, ...validation } });
});

const removeCoupon = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.coupon = null;
  cart.couponCode = null;
  cart.discount = 0;
  await recalculateCart(cart);
  await cart.save();
  return ApiResponse.success(res, { message: 'Coupon removed', data: cart });
});

const refreshPrices = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const validation = await recalculateCart(cart, { refreshPrices: true, removeInvalidCoupon: true });
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await cart.save();
  return ApiResponse.success(res, {
    message: validation.priceChanges.length ? 'Cart prices refreshed' : 'Cart prices are current',
    data: { cart, ...validation },
  });
});

module.exports = {
  getCart, addItem, updateItem, removeItem, clearCart, applyCoupon, removeCoupon,
  refreshPrices, addProductToCart,
};
