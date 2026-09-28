const mongoose = require('mongoose');
const Coupon = require('../models/couponModel');
const Cart = require('../models/cartModel');
const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const Collection = require('../models/collectionModel');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { recalculateCart } = require('../utils/calculationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const expireElapsedCoupons = () => Coupon.updateMany(
  { status: 'active', expiresAt: { $lte: new Date() } },
  { $set: { status: 'expired' } },
);

const parseList = (value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid list value', 422, 'INVALID_JSON'); }
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
};

const normalizeInput = (body) => {
  const allowed = [
    'code', 'name', 'description', 'discountType', 'discountValue', 'maximumDiscount',
    'minimumOrderValue', 'currency', 'appliesTo', 'customerEligibility', 'usageLimit',
    'usageLimitPerUser', 'startsAt', 'expiresAt', 'status', 'isPublic', 'stackable',
  ];
  const input = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
  for (const key of ['productIds', 'categoryIds', 'collectionIds', 'excludedProductIds', 'eligibleUserIds']) {
    if (body[key] !== undefined) input[key] = parseList(body[key]);
  }
  if (input.code) input.code = String(input.code).trim().toUpperCase();
  return input;
};

const validateReferences = async (input) => {
  const checks = [
    ['productIds', Product, { deletedAt: null }],
    ['excludedProductIds', Product, { deletedAt: null }],
    ['categoryIds', Category, { deletedAt: null }],
    ['collectionIds', Collection, { deletedAt: null }],
    ['eligibleUserIds', User, { status: { $ne: 'deleted' } }],
  ];
  for (const [field, Model, extraFilter] of checks) {
    if (!input[field]) continue;
    const ids = [...new Set(input[field].map(String))];
    if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new AppError(`Invalid ${field}`, 422, 'INVALID_REFERENCE');
    const count = await Model.countDocuments({ _id: { $in: ids }, ...extraFilter });
    if (count !== ids.length) throw new AppError(`One or more ${field} references are invalid`, 422, 'INVALID_REFERENCE');
    input[field] = ids;
  }
};

const validateCoupon = asyncHandler(async (req, res) => {
  await expireElapsedCoupons();
  const coupon = await Coupon.findOne({ code: String(req.body.code || '').trim().toUpperCase() });
  if (!coupon) throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart || !cart.items.length) throw new AppError('Cart is empty', 422, 'EMPTY_CART');

  const originalCoupon = cart.coupon;
  const originalCode = cart.couponCode;
  cart.coupon = coupon._id;
  cart.couponCode = coupon.code;
  const result = await recalculateCart(cart);
  cart.coupon = originalCoupon;
  cart.couponCode = originalCode;
  if (result.couponError) throw new AppError(result.couponError.message, 422, result.couponError.code);
  return ApiResponse.success(res, {
    message: 'Coupon is valid',
    data: { code: coupon.code, discount: cart.discount, total: cart.total, currency: cart.currency },
  });
});

const listCoupons = asyncHandler(async (req, res) => {
  await expireElapsedCoupons();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.search) baseFilter.$or = [
    { code: new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    { name: new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
  ];
  const filter = applyStatusFilter({ ...baseFilter }, 'status', req.query.status);
  const [coupons, total, summary] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Coupon.countDocuments(filter),
    summarizeStatusFields(Coupon, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: coupons,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getCoupon = asyncHandler(async (req, res) => {
  await expireElapsedCoupons();
  const coupon = await Coupon.findById(req.params.couponId);
  if (!coupon) throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
  return ApiResponse.success(res, { data: coupon });
});

const createCoupon = asyncHandler(async (req, res) => {
  const input = normalizeInput(req.body);
  for (const key of ['code', 'name', 'discountType', 'discountValue', 'startsAt', 'expiresAt']) {
    if (input[key] === undefined || input[key] === '') throw new AppError(`${key} is required`, 422, 'VALIDATION_ERROR');
  }
  if (input.discountType === 'freeShipping') {
    throw new AppError('Free-shipping coupons are unavailable because delivery has no charge', 422, 'INVALID_DISCOUNT_TYPE');
  }
  if (input.status === 'expired') {
    throw new AppError('New coupons cannot be created as expired', 422, 'INVALID_COUPON_STATUS');
  }
  if (await Coupon.exists({ code: input.code })) throw new AppError('Coupon code already exists', 409, 'COUPON_EXISTS');
  await validateReferences(input);
  const coupon = await Coupon.create({ ...input, createdBy: req.user.id, updatedBy: req.user.id });
  await logAudit(req, {
    action: 'create', resourceType: 'Coupon', resourceId: coupon._id, resourceLabel: coupon.code,
    description: 'Coupon created', statusCode: 201,
  });
  return ApiResponse.success(res, { statusCode: 201, message: 'Coupon created', data: coupon });
});

const updateCoupon = asyncHandler(async (req, res) => {
  await expireElapsedCoupons();
  const coupon = await Coupon.findById(req.params.couponId);
  if (!coupon) throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
  const input = normalizeInput(req.body);
  if (input.discountType === 'freeShipping') {
    throw new AppError('Free-shipping coupons are unavailable because delivery has no charge', 422, 'INVALID_DISCOUNT_TYPE');
  }
  if (input.code && await Coupon.exists({ code: input.code, _id: { $ne: coupon._id } })) {
    throw new AppError('Coupon code already exists', 409, 'COUPON_EXISTS');
  }
  if (input.status === 'active' && new Date(input.expiresAt || coupon.expiresAt) <= new Date()) {
    throw new AppError('Expired coupons cannot be activated. Extend the expiry date first.', 422, 'COUPON_EXPIRED');
  }
  if (input.status === 'expired' && new Date(input.expiresAt || coupon.expiresAt) > new Date()) {
    throw new AppError('Only elapsed coupons can be marked expired', 422, 'INVALID_COUPON_STATUS');
  }
  await validateReferences(input);
  Object.assign(coupon, input, { updatedBy: req.user.id });
  await coupon.save();
  await logAudit(req, {
    action: 'update', resourceType: 'Coupon', resourceId: coupon._id, resourceLabel: coupon.code,
    description: 'Coupon updated', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Coupon updated', data: coupon });
});

const deleteCoupon = asyncHandler(async (req, res) => {
  await expireElapsedCoupons();
  const coupon = await Coupon.findById(req.params.couponId);
  if (!coupon) throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
  const affectedCarts = await Cart.find({ coupon: coupon._id });
  await Coupon.deleteOne({ _id: coupon._id });
  await Promise.all(affectedCarts.map(async (cart) => {
    cart.coupon = null;
    cart.couponCode = null;
    cart.discount = 0;
    await recalculateCart(cart);
    await cart.save();
  }));
  await logAudit(req, {
    action: 'delete', resourceType: 'Coupon', resourceId: coupon._id, resourceLabel: coupon.code,
    description: 'Coupon permanently deleted', statusCode: 200,
  });
  return ApiResponse.success(res, {
    message: 'Coupon deleted',
    data: { id: coupon._id, code: coupon.code },
  });
});

module.exports = { validateCoupon, listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon };
