const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildTaxBreakup, calculateBillingLines } = require('../utils/calculationUtils');
const Order = require('../models/orderModel');

test('Maharashtra billing adds 1.5 percent CGST and 1.5 percent SGST', () => {
  const result = calculateBillingLines([{ unitPrice: 25000, quantity: 1 }]);

  assert.equal(result.subtotal, 25000);
  assert.equal(result.taxableSubtotal, 25000);
  assert.equal(result.cgst, 375);
  assert.equal(result.sgst, 375);
  assert.equal(result.igst, 0);
  assert.equal(result.tax, 750);
  assert.equal(result.grandTotal, 25750);
  assert.equal(result.taxMode, 'intraState');
  assert.equal(result.lines[0].gstRate, 3);
});

test('delivery outside Maharashtra adds only 3 percent IGST', () => {
  const result = calculateBillingLines(
    [{ unitPrice: 25000, quantity: 1 }],
    0,
    { shippingAddress: { state: 'Gujarat' } },
  );

  assert.equal(result.subtotal, 25000);
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  assert.equal(result.igst, 750);
  assert.equal(result.tax, 750);
  assert.equal(result.grandTotal, 25750);
  assert.equal(result.taxMode, 'interState');
  assert.equal(result.placeOfSupplyState, 'Gujarat');
  assert.equal(result.lines[0].igstRate, 3);
  assert.equal(result.lines[0].igstAmount, 750);
});

test('Maharashtra state aliases remain intra-state', () => {
  const result = calculateBillingLines(
    [{ unitPrice: 1000, quantity: 1 }],
    0,
    { placeOfSupplyState: 'MH' },
  );

  assert.equal(result.taxMode, 'intraState');
  assert.equal(result.cgst, 15);
  assert.equal(result.sgst, 15);
  assert.equal(result.igst, 0);
});

test('shipping state controls place of supply when billing state differs', () => {
  const result = calculateBillingLines(
    [{ unitPrice: 1000, quantity: 1 }],
    0,
    {
      shippingAddress: { state: 'Karnataka' },
      billingAddress: { state: 'Maharashtra' },
    },
  );

  assert.equal(result.taxMode, 'interState');
  assert.equal(result.placeOfSupplyState, 'Karnataka');
  assert.equal(result.cgst, 0);
  assert.equal(result.sgst, 0);
  assert.equal(result.igst, 30);
});

test('component rounding preserves the same 3 percent line tax total', () => {
  const intraState = calculateBillingLines([{ unitPrice: 1, quantity: 1 }]);
  const interState = calculateBillingLines(
    [{ unitPrice: 1, quantity: 1 }],
    0,
    { placeOfSupplyState: 'Gujarat' },
  );

  assert.equal(intraState.tax, 0.03);
  assert.equal(intraState.cgst + intraState.sgst, 0.03);
  assert.equal(interState.tax, 0.03);
  assert.equal(interState.igst, 0.03);
});

test('tax presentation reconciles stale CGST and SGST as IGST for an inter-state order', () => {
  const breakup = buildTaxBreakup({
    shippingAddress: { state: 'Gujarat' },
    supplierState: 'Maharashtra',
    taxMode: 'intraState',
    cgst: 375,
    sgst: 375,
    igst: 0,
    tax: 750,
  });

  assert.equal(breakup.mode, 'interState');
  assert.equal(breakup.cgst.amount, 0);
  assert.equal(breakup.sgst.amount, 0);
  assert.equal(breakup.igst.amount, 750);
  assert.equal(breakup.igst.rate, 3);
  assert.equal(breakup.reconciled, true);
});

test('tax presentation reconciles stale IGST as CGST and SGST for Maharashtra', () => {
  const breakup = buildTaxBreakup({
    placeOfSupplyState: 'MH',
    supplierState: 'Maharashtra',
    taxMode: 'interState',
    cgst: 0,
    sgst: 0,
    igst: 750,
    tax: 750,
  });

  assert.equal(breakup.mode, 'intraState');
  assert.equal(breakup.cgst.amount, 375);
  assert.equal(breakup.sgst.amount, 375);
  assert.equal(breakup.igst.amount, 0);
  assert.equal(breakup.cgst.rate, 1.5);
  assert.equal(breakup.sgst.rate, 1.5);
  assert.equal(breakup.reconciled, true);
});

test('billing applies discounts before the fixed GST split', () => {
  const result = calculateBillingLines([
    { unitPrice: 100, quantity: 1 },
    { unitPrice: 50, quantity: 2 },
  ], 20);

  assert.equal(result.subtotal, 200);
  assert.equal(result.discount, 20);
  assert.equal(result.taxableSubtotal, 180);
  assert.equal(result.cgst, 2.7);
  assert.equal(result.sgst, 2.7);
  assert.equal(result.igst, 0);
  assert.equal(result.grandTotal, 185.4);
  assert.equal(result.lines.reduce((sum, line) => sum + line.lineTotal, 0), result.grandTotal);
});

test('state-based inter-state orders persist only IGST', async () => {
  const maharashtraAddress = {
    recipientName: 'Test Customer',
    phone: '9999999999',
    line1: 'Test address',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
  };
  const gujaratAddress = {
    ...maharashtraAddress,
    city: 'Ahmedabad',
    state: 'Gujarat',
    postalCode: '380001',
  };
  const order = new Order({
    orderNumber: 'BWL-INTERSTATE-TEST',
    user: new mongoose.Types.ObjectId(),
    items: [{
      product: new mongoose.Types.ObjectId(),
      sku: 'BW-TEST-002',
      name: 'Test jewellery',
      unitPrice: 25000,
      quantity: 1,
      taxableAmount: 25000,
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: 3,
      igstAmount: 750,
      gstRate: 3,
      taxAmount: 750,
      lineTotal: 25750,
    }],
    shippingAddress: gujaratAddress,
    billingAddress: maharashtraAddress,
    subtotal: 25000,
    shippingCharge: 500,
    insuranceCharge: 125,
    cgst: 375,
    sgst: 375,
    igst: 750,
    tax: 1500,
    taxMode: 'interState',
    placeOfSupplyState: 'Gujarat',
    supplierState: 'Maharashtra',
    grandTotal: 25750,
    paymentMethod: 'hdfcUpi',
    metadata: { billingVersion: 'state-based-gst-v2', taxMode: 'interState' },
  });

  await order.validate();
  assert.equal(order.shippingCharge, 0);
  assert.equal(order.insuranceCharge, 0);
  assert.equal(order.cgst, 0);
  assert.equal(order.sgst, 0);
  assert.equal(order.igst, 750);
  assert.equal(order.tax, 750);
});

test('new orders cannot persist shipping or insurance charges', async () => {
  const address = {
    recipientName: 'Test Customer',
    phone: '9999999999',
    line1: 'Test address',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    country: 'India',
  };
  const order = new Order({
    orderNumber: 'BWL-BILLING-TEST',
    user: new mongoose.Types.ObjectId(),
    items: [{
      product: new mongoose.Types.ObjectId(),
      sku: 'BW-TEST-001',
      name: 'Test jewellery',
      unitPrice: 25000,
      quantity: 1,
      taxableAmount: 25000,
      cgstRate: 1.5,
      cgstAmount: 375,
      sgstRate: 1.5,
      sgstAmount: 375,
      gstRate: 3,
      taxAmount: 750,
      lineTotal: 25750,
    }],
    shippingAddress: address,
    billingAddress: address,
    subtotal: 25000,
    shippingCharge: 500,
    insuranceCharge: 125,
    cgst: 375,
    sgst: 375,
    tax: 750,
    grandTotal: 25750,
    paymentMethod: 'hdfcUpi',
    metadata: { taxMode: 'exclusive' },
  });

  await order.validate();
  assert.equal(order.shippingCharge, 0);
  assert.equal(order.insuranceCharge, 0);
});
