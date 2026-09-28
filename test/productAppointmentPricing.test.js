const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../models/productModel');
const { presentProductForCustomer } = require('../utils/productPresentationUtils');

const productInput = (overrides = {}) => ({
  name: 'Royal Heritage Necklace',
  slug: 'royal-heritage-necklace',
  sku: 'BW-NEC-001',
  description: 'A private-viewing jewellery piece.',
  category: new mongoose.Types.ObjectId(),
  productType: 'jewellery',
  ...overrides,
});

test('appointment-only products validate without a price', async () => {
  const product = new Product(productInput({ purchaseMode: 'appointmentOnly' }));
  await product.validate();
  assert.equal(product.price, undefined);
});

test('products sold online still require a price', async () => {
  const product = new Product(productInput({ purchaseMode: 'online' }));
  await assert.rejects(product.validate(), /price/i);
});

test('customer presentation removes appointment-only base and variant prices', () => {
  const presented = presentProductForCustomer({
    ...productInput({ purchaseMode: 'appointmentOnly' }),
    price: 250000,
    compareAtPrice: 275000,
    variants: [{ name: 'Private selection', price: 260000, compareAtPrice: 280000 }],
  });

  assert.equal('price' in presented, false);
  assert.equal('compareAtPrice' in presented, false);
  assert.equal('price' in presented.variants[0], false);
  assert.equal('compareAtPrice' in presented.variants[0], false);
});

test('customer presentation retains prices for products sold online', () => {
  const presented = presentProductForCustomer(productInput({ purchaseMode: 'online', price: 60000 }));
  assert.equal(presented.price, 60000);
});
