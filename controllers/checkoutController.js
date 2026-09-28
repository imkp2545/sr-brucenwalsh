const Cart = require('../models/cartModel');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { calculateCheckout } = require('../utils/calculationUtils');

const findAddress = (user, addressId, fallbackToDefault = true) => {
  if (addressId) return user.addresses.id(addressId);
  if (!fallbackToDefault) return null;
  return user.addresses.find((address) => address.isDefault) || user.addresses[0];
};

const addressSnapshot = (address, user) => ({
  recipientName: address.recipientName,
  phone: address.phone,
  email: user.email,
  line1: address.line1,
  line2: address.line2,
  landmark: address.landmark,
  city: address.city,
  state: address.state,
  postalCode: address.postalCode,
  country: address.country,
});

const prepareCheckout = async (userId, input = {}) => {
  const [user, cart] = await Promise.all([
    User.findOne({ _id: userId, status: 'active', isEmailVerified: true }),
    Cart.findOne({ user: userId }),
  ]);
  if (!user) throw new AppError('Active verified customer account is required', 403, 'CUSTOMER_NOT_ELIGIBLE');
  if (!cart || !cart.items.length) throw new AppError('Cart is empty', 422, 'EMPTY_CART');

  const shippingAddress = findAddress(user, input.shippingAddressId);
  if (!shippingAddress) throw new AppError('A shipping address is required', 422, 'SHIPPING_ADDRESS_REQUIRED');
  const billingAddress = input.billingSameAsShipping === false
    ? findAddress(user, input.billingAddressId, false)
    : (findAddress(user, input.billingAddressId, false) || shippingAddress);
  if (!billingAddress) throw new AppError('A billing address is required', 422, 'BILLING_ADDRESS_REQUIRED');

  const shippingSnapshot = addressSnapshot(shippingAddress, user);
  const billingSnapshot = addressSnapshot(billingAddress, user);
  const summary = await calculateCheckout(cart, {
    shippingAddress: shippingSnapshot,
    billingAddress: billingSnapshot,
  });
  cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await cart.save();
  return {
    user,
    cart,
    summary,
    shippingAddress: shippingSnapshot,
    billingAddress: billingSnapshot,
  };
};

const getCheckoutSummary = asyncHandler(async (req, res) => {
  const checkout = await prepareCheckout(req.user.id, req.body);
  return ApiResponse.success(res, {
    message: checkout.summary.validation.priceChanges.length
      ? 'Checkout recalculated with current prices'
      : 'Checkout summary ready',
    data: {
      items: checkout.summary.items,
      subtotal: checkout.summary.subtotal,
      discount: checkout.summary.discount,
      taxableSubtotal: checkout.summary.taxableSubtotal,
      cgst: checkout.summary.cgst,
      sgst: checkout.summary.sgst,
      igst: checkout.summary.igst,
      gst: checkout.summary.tax,
      tax: checkout.summary.tax,
      taxMode: checkout.summary.taxMode,
      placeOfSupplyState: checkout.summary.placeOfSupplyState,
      supplierState: checkout.summary.supplierState,
      taxBreakup: checkout.summary.taxBreakup,
      grandTotal: checkout.summary.grandTotal,
      currency: checkout.summary.currency,
      couponCode: checkout.summary.couponCode,
      priceChanges: checkout.summary.validation.priceChanges,
      shippingAddress: checkout.shippingAddress,
      billingAddress: checkout.billingAddress,
    },
  });
});

module.exports = { getCheckoutSummary, prepareCheckout };
