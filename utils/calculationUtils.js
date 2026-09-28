const mongoose = require('mongoose');
const Product = require('../models/productModel');
const Coupon = require('../models/couponModel');
const Order = require('../models/orderModel');
const AppError = require('./appError');

const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const CGST_RATE = 1.5;
const SGST_RATE = 1.5;
const GST_RATE = CGST_RATE + SGST_RATE;
const IGST_RATE = GST_RATE;
const DEFAULT_SUPPLIER_STATE = 'Maharashtra';
const DEFAULT_SUPPLIER_STATE_CODE = '27';

const normalizeState = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const resolveTaxContext = (context = {}) => {
  const supplierState = String(
    context.supplierState
      || process.env.INVOICE_STATE_NAME
      || DEFAULT_SUPPLIER_STATE,
  ).trim();
  const supplierStateCode = String(
    context.supplierStateCode
      || process.env.INVOICE_STATE_CODE
      || DEFAULT_SUPPLIER_STATE_CODE,
  ).trim();
  const placeOfSupplyState = String(
    context.placeOfSupplyState
      || context.shippingAddress?.state
      || context.billingAddress?.state
      || supplierState,
  ).trim();
  const normalizedPlace = normalizeState(placeOfSupplyState);
  const supplierAliases = new Set([
    normalizeState(supplierState),
    normalizeState(supplierStateCode),
  ]);
  if (normalizeState(supplierState) === 'maharashtra') supplierAliases.add('mh');
  const taxMode = supplierAliases.has(normalizedPlace) ? 'intraState' : 'interState';

  return {
    taxMode,
    placeOfSupplyState,
    supplierState,
    cgstRate: taxMode === 'intraState' ? CGST_RATE : 0,
    sgstRate: taxMode === 'intraState' ? SGST_RATE : 0,
    igstRate: taxMode === 'interState' ? IGST_RATE : 0,
    gstRate: GST_RATE,
  };
};

const buildTaxBreakup = (billing = {}) => {
  const placeOfSupplyState = String(
    billing.placeOfSupplyState
      || billing.shippingAddress?.state
      || billing.billingAddress?.state
      || '',
  ).trim();
  const supplierState = String(
    billing.supplierState
      || process.env.INVOICE_STATE_NAME
      || DEFAULT_SUPPLIER_STATE,
  ).trim();
  const hasStateContext = Boolean(placeOfSupplyState);
  const resolvedContext = resolveTaxContext({
    ...billing,
    placeOfSupplyState: placeOfSupplyState || undefined,
    supplierState,
  });

  const rawCgst = roundCurrency(billing.cgst ?? billing.cgstAmount ?? 0);
  const rawSgst = roundCurrency(billing.sgst ?? billing.sgstAmount ?? 0);
  const rawIgst = roundCurrency(billing.igst ?? billing.igstAmount ?? 0);
  const rawComponentTotal = roundCurrency(rawCgst + rawSgst + rawIgst);
  const declaredTax = Number(billing.tax ?? billing.totalTax);
  const totalTax = roundCurrency(
    Number.isFinite(declaredTax) && (declaredTax > 0 || rawComponentTotal === 0)
      ? declaredTax
      : rawComponentTotal,
  );
  const persistedMode = ['intraState', 'interState'].includes(billing.taxMode || billing.mode)
    ? (billing.taxMode || billing.mode)
    : null;
  const amountMode = rawIgst > 0
    ? 'interState'
    : (rawCgst + rawSgst > 0 ? 'intraState' : null);
  const mode = hasStateContext
    ? resolvedContext.taxMode
    : (persistedMode || amountMode || resolvedContext.taxMode);
  const approximatelyEqual = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.01;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (mode === 'intraState') {
    const storedSplitIsValid = approximatelyEqual(rawCgst + rawSgst, totalTax)
      && approximatelyEqual(rawIgst, 0);
    if (storedSplitIsValid) {
      cgst = rawCgst;
      sgst = rawSgst;
    } else {
      cgst = roundCurrency(totalTax / 2);
      sgst = roundCurrency(totalTax - cgst);
    }
  } else {
    const storedIgstIsValid = approximatelyEqual(rawIgst, totalTax)
      && approximatelyEqual(rawCgst + rawSgst, 0);
    igst = storedIgstIsValid ? rawIgst : totalTax;
  }

  const reconciled = !approximatelyEqual(rawCgst, cgst)
    || !approximatelyEqual(rawSgst, sgst)
    || !approximatelyEqual(rawIgst, igst)
    || (persistedMode && persistedMode !== mode);

  return {
    mode,
    placeOfSupplyState: placeOfSupplyState || resolvedContext.placeOfSupplyState,
    supplierState,
    totalRate: GST_RATE,
    cgst: { rate: mode === 'intraState' ? CGST_RATE : 0, amount: cgst },
    sgst: { rate: mode === 'intraState' ? SGST_RATE : 0, amount: sgst },
    igst: { rate: mode === 'interState' ? IGST_RATE : 0, amount: igst },
    totalTax,
    reconciled,
  };
};

const calculateBillingLines = (items = [], discount = 0, taxContext = {}) => {
  const resolvedTax = resolveTaxContext(taxContext);
  const grossAmounts = items.map((item) => roundCurrency(Number(item.unitPrice) * Number(item.quantity)));
  const subtotal = roundCurrency(grossAmounts.reduce((sum, amount) => sum + amount, 0));
  const boundedDiscount = roundCurrency(Math.min(Math.max(Number(discount) || 0, 0), subtotal));
  let allocatedDiscount = 0;

  const lines = items.map((item, index) => {
    const grossAmount = grossAmounts[index];
    const isLastLine = index === items.length - 1;
    const remainingDiscount = roundCurrency(Math.max(0, boundedDiscount - allocatedDiscount));
    const proposedDiscount = isLastLine
      ? remainingDiscount
      : roundCurrency(subtotal > 0 ? boundedDiscount * grossAmount / subtotal : 0);
    const itemDiscount = roundCurrency(Math.min(grossAmount, remainingDiscount, proposedDiscount));
    allocatedDiscount = roundCurrency(allocatedDiscount + itemDiscount);
    const taxableAmount = roundCurrency(Math.max(0, grossAmount - itemDiscount));
    const taxAmount = roundCurrency(taxableAmount * GST_RATE / 100);
    const cgstAmount = resolvedTax.taxMode === 'intraState'
      ? roundCurrency(taxableAmount * resolvedTax.cgstRate / 100)
      : 0;
    const sgstAmount = resolvedTax.taxMode === 'intraState'
      ? roundCurrency(taxAmount - cgstAmount)
      : 0;
    const igstAmount = resolvedTax.taxMode === 'interState' ? taxAmount : 0;
    return {
      item,
      grossAmount,
      discount: itemDiscount,
      taxableAmount,
      cgstRate: resolvedTax.cgstRate,
      cgstAmount,
      sgstRate: resolvedTax.sgstRate,
      sgstAmount,
      igstRate: resolvedTax.igstRate,
      igstAmount,
      gstRate: resolvedTax.gstRate,
      taxAmount,
      lineTotal: roundCurrency(taxableAmount + taxAmount),
    };
  });

  const taxableSubtotal = roundCurrency(lines.reduce((sum, line) => sum + line.taxableAmount, 0));
  const appliedDiscount = roundCurrency(lines.reduce((sum, line) => sum + line.discount, 0));
  const cgst = roundCurrency(lines.reduce((sum, line) => sum + line.cgstAmount, 0));
  const sgst = roundCurrency(lines.reduce((sum, line) => sum + line.sgstAmount, 0));
  const igst = roundCurrency(lines.reduce((sum, line) => sum + line.igstAmount, 0));
  const tax = roundCurrency(cgst + sgst + igst);
  return {
    lines,
    subtotal,
    discount: appliedDiscount,
    taxableSubtotal,
    cgst,
    sgst,
    igst,
    tax,
    ...resolvedTax,
    grandTotal: roundCurrency(taxableSubtotal + tax),
  };
};

const getVariant = (product, variantId) => {
  if (!variantId) return null;
  const variant = product.variants.id ? product.variants.id(variantId) : product.variants.find((item) => String(item._id) === String(variantId));
  if (!variant) throw new AppError('Product variant not found', 404, 'VARIANT_NOT_FOUND');
  if (variant.status !== 'active') throw new AppError('Product variant is unavailable', 409, 'VARIANT_UNAVAILABLE');
  return variant;
};

const productSnapshot = (product, variantId) => {
  const variant = getVariant(product, variantId);
  const source = variant || product;
  const availableStock = Math.max(0, source.stock - source.reservedStock);
  const primaryImage = variant?.image?.url || product.images.find((image) => image.isPrimary)?.url || product.images[0]?.url;
  return {
    product: product._id,
    variantId: variant?._id || null,
    sku: variant?.sku || product.sku,
    name: variant?.name ? `${product.name} - ${variant.name}` : product.name,
    image: primaryImage,
    attributes: variant?.attributes || [],
    unitPrice: variant?.price ?? product.price,
    availableStock,
  };
};

const couponAppliesToProduct = (coupon, product) => {
  const productId = String(product._id);
  if (coupon.excludedProductIds.some((id) => String(id) === productId)) return false;
  if (coupon.appliesTo === 'allProducts') return true;
  if (coupon.appliesTo === 'specificProducts') return coupon.productIds.some((id) => String(id) === productId);
  if (coupon.appliesTo === 'categories') {
    const categories = [product.category, ...(product.subcategories || [])].map(String);
    return coupon.categoryIds.some((id) => categories.includes(String(id)));
  }
  if (coupon.appliesTo === 'collections') {
    return coupon.collectionIds.some((id) => (product.collections || []).map(String).includes(String(id)));
  }
  return false;
};

const validateCouponForCart = async (coupon, cart, userId, productsById) => {
  const now = new Date();
  if (!coupon || coupon.status !== 'active' || coupon.startsAt > now || coupon.expiresAt <= now) {
    throw new AppError('Coupon is inactive or expired', 422, 'COUPON_UNAVAILABLE');
  }
  if (coupon.discountType === 'freeShipping') {
    throw new AppError('Free-shipping coupons are not applicable because delivery has no charge', 422, 'COUPON_NOT_APPLICABLE');
  }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new AppError('Coupon usage limit has been reached', 422, 'COUPON_LIMIT_REACHED');
  if (cart.subtotal < coupon.minimumOrderValue) {
    throw new AppError(`Minimum order value for this coupon is ₹${coupon.minimumOrderValue}`, 422, 'MINIMUM_ORDER_NOT_MET');
  }
  if (coupon.customerEligibility === 'specificCustomers' && !coupon.eligibleUserIds.some((id) => String(id) === String(userId))) {
    throw new AppError('Coupon is not available for this account', 403, 'COUPON_NOT_ELIGIBLE');
  }

  const previousOrders = await Order.countDocuments({ user: userId, orderStatus: { $nin: ['pendingPayment', 'cancelled'] } });
  if (coupon.customerEligibility === 'newCustomers' && previousOrders > 0) throw new AppError('Coupon is only for new customers', 422, 'COUPON_NOT_ELIGIBLE');
  if (coupon.customerEligibility === 'existingCustomers' && previousOrders === 0) throw new AppError('Coupon is only for existing customers', 422, 'COUPON_NOT_ELIGIBLE');
  if (coupon.usageLimitPerUser) {
    const usageCount = await Order.countDocuments({ user: userId, coupon: coupon._id, orderStatus: { $ne: 'cancelled' } });
    if (usageCount >= coupon.usageLimitPerUser) throw new AppError('You have already used this coupon', 422, 'COUPON_USER_LIMIT_REACHED');
  }

  const applicableSubtotal = roundCurrency(cart.items.reduce((sum, item) => {
    const product = productsById.get(String(item.product));
    return product && couponAppliesToProduct(coupon, product) ? sum + item.unitPrice * item.quantity : sum;
  }, 0));
  if (applicableSubtotal <= 0) throw new AppError('Coupon does not apply to items in this cart', 422, 'COUPON_NOT_APPLICABLE');

  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = applicableSubtotal * (coupon.discountValue / 100);
    if (coupon.maximumDiscount !== undefined && coupon.maximumDiscount !== null) discount = Math.min(discount, coupon.maximumDiscount);
  } else if (coupon.discountType === 'fixedAmount') {
    discount = Math.min(coupon.discountValue, applicableSubtotal);
  }
  return roundCurrency(discount);
};

const recalculateCart = async (
  cart,
  { refreshPrices = false, removeInvalidCoupon = false, taxContext = {} } = {},
) => {
  const hasExplicitTaxContext = Boolean(
    taxContext.placeOfSupplyState
      || taxContext.shippingAddress?.state
      || taxContext.billingAddress?.state,
  );
  const effectiveTaxContext = hasExplicitTaxContext
    ? taxContext
    : {
      placeOfSupplyState: cart.placeOfSupplyState,
      supplierState: cart.supplierState,
    };
  const productIds = [...new Set(cart.items.map((item) => String(item.product)))];
  const products = await Product.find({ _id: { $in: productIds }, status: 'active', deletedAt: null });
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const priceChanges = [];
  const unavailableItems = [];

  for (const item of cart.items) {
    const product = productsById.get(String(item.product));
    if (!product) {
      unavailableItems.push({ itemId: item._id, reason: 'productUnavailable' });
      continue;
    }
    if (product.purchaseMode === 'appointmentOnly') {
      unavailableItems.push({ itemId: item._id, reason: 'appointmentOnly' });
      continue;
    }
    try {
      const latest = productSnapshot(product, item.variantId);
      if (latest.availableStock < item.quantity && !product.allowBackorder) {
        unavailableItems.push({ itemId: item._id, reason: 'insufficientStock', availableStock: latest.availableStock });
      }
      if (roundCurrency(item.unitPrice) !== roundCurrency(latest.unitPrice)) {
        priceChanges.push({ itemId: item._id, previousPrice: item.unitPrice, latestPrice: latest.unitPrice });
        if (refreshPrices) item.unitPrice = latest.unitPrice;
      }
      if (refreshPrices) {
        item.sku = latest.sku;
        item.name = latest.name;
        item.image = latest.image;
        item.attributes = latest.attributes;
      }
    } catch (error) {
      unavailableItems.push({ itemId: item._id, reason: error.code || 'variantUnavailable' });
    }
  }

  cart.subtotal = roundCurrency(cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  cart.discount = 0;
  let couponError = null;
  if (cart.coupon) {
    const coupon = await Coupon.findById(cart.coupon);
    try {
      cart.discount = await validateCouponForCart(coupon, cart, cart.user, productsById);
    } catch (error) {
      couponError = { code: error.code, message: error.message };
      if (removeInvalidCoupon) {
        cart.coupon = null;
        cart.couponCode = null;
      }
    }
  }
  const billing = calculateBillingLines(cart.items, cart.discount, effectiveTaxContext);
  cart.discount = billing.discount;
  cart.cgst = billing.cgst;
  cart.sgst = billing.sgst;
  cart.igst = billing.igst;
  cart.tax = billing.tax;
  cart.taxMode = billing.taxMode;
  cart.placeOfSupplyState = billing.placeOfSupplyState;
  cart.supplierState = billing.supplierState;
  cart.shipping = 0;
  cart.insurance = 0;
  cart.total = billing.grandTotal;
  return { priceChanges, unavailableItems, couponError };
};

const calculateCheckout = async (cart, taxContext = {}) => {
  const validation = await recalculateCart(cart, {
    refreshPrices: true,
    removeInvalidCoupon: true,
    taxContext,
  });
  if (validation.unavailableItems.length) {
    throw new AppError('One or more cart items are unavailable or have insufficient stock', 409, 'CART_ITEMS_UNAVAILABLE', validation.unavailableItems);
  }

  const productIds = [...new Set(cart.items.map((item) => String(item.product)))];
  const products = await Product.find({ _id: { $in: productIds } }).select('hsnCode allowBackorder');
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const billing = calculateBillingLines(cart.items, cart.discount, taxContext);
  cart.discount = billing.discount;
  const items = cart.items.map((item, index) => {
    const product = productsById.get(String(item.product));
    const line = billing.lines[index];
    return {
      product: item.product,
      variantId: item.variantId || null,
      sku: item.sku,
      name: item.name,
      image: item.image,
      attributes: item.attributes.map((attribute) => ({ name: attribute.name, value: attribute.value })),
      unitPrice: roundCurrency(item.unitPrice),
      quantity: item.quantity,
      discount: line.discount,
      taxableAmount: line.taxableAmount,
      cgstRate: line.cgstRate,
      cgstAmount: line.cgstAmount,
      sgstRate: line.sgstRate,
      sgstAmount: line.sgstAmount,
      igstRate: line.igstRate,
      igstAmount: line.igstAmount,
      gstRate: line.gstRate,
      taxAmount: line.taxAmount,
      lineTotal: line.lineTotal,
      hsnCode: product?.hsnCode,
      allowBackorder: Boolean(product?.allowBackorder),
    };
  });

  cart.cgst = billing.cgst;
  cart.sgst = billing.sgst;
  cart.igst = billing.igst;
  cart.tax = billing.tax;
  cart.taxMode = billing.taxMode;
  cart.placeOfSupplyState = billing.placeOfSupplyState;
  cart.supplierState = billing.supplierState;
  cart.shipping = 0;
  cart.insurance = 0;
  cart.total = billing.grandTotal;

  return {
    items,
    subtotal: billing.subtotal,
    discount: billing.discount,
    taxableSubtotal: billing.taxableSubtotal,
    cgst: billing.cgst,
    sgst: billing.sgst,
    igst: billing.igst,
    tax: billing.tax,
    taxMode: billing.taxMode,
    placeOfSupplyState: billing.placeOfSupplyState,
    supplierState: billing.supplierState,
    taxBreakup: buildTaxBreakup(billing),
    grandTotal: billing.grandTotal,
    currency: cart.currency,
    coupon: cart.coupon || null,
    couponCode: cart.couponCode || null,
    validation,
  };
};

const findActiveCoupon = async (code) => Coupon.findOne({ code: String(code || '').trim().toUpperCase() });

module.exports = {
  CGST_RATE,
  SGST_RATE,
  GST_RATE,
  IGST_RATE,
  roundCurrency,
  resolveTaxContext,
  buildTaxBreakup,
  calculateBillingLines,
  productSnapshot,
  validateCouponForCart,
  recalculateCart,
  findActiveCoupon,
  calculateCheckout,
};
