const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmedOrderForPayment, updateUnconfirmedPayment } = require('../services/paymentConfirmationService');
const Payment = require('../models/paymentModel');
const Order = require('../models/orderModel');
const { finalizeVerifiedPayment, verifyPayment } = require('../controllers/paymentController');

const payment = { _id: 'payment-1', paymentReference: 'PAY-1', user: 'customer-1', order: 'order-1' };
const receipt = { _id: 'order-1', user: 'customer-1', paymentStatus: 'paid' };

test('receipt recovery requires an existing paid order belonging to the payment customer', async () => {
  assert.equal(await confirmedOrderForPayment({ ...payment, order: null }, {}), null);
  assert.equal(await confirmedOrderForPayment(payment, { findById: async () => receipt }), receipt);
  for (const invalid of [null, { ...receipt, user: 'another-customer' }, { ...receipt, paymentStatus: 'pending' }]) {
    await assert.rejects(confirmedOrderForPayment(payment, { findById: async () => invalid }), { code: 'PAYMENT_RECEIPT_INCONSISTENT' });
  }
});

test('stale failure writes are conditional and exclude captured/refunded or linked payments', async () => {
  let actualFilter;
  const updated = await updateUnconfirmedPayment({ updateOne: async (filter) => {
    actualFilter = filter;
    return { matchedCount: 0 };
  } }, payment, { status: 'failed' });
  assert.equal(updated, false);
  assert.equal(actualFilter.order, null);
  assert.deepEqual(actualFilter.status.$nin, ['captured', 'partiallyRefunded', 'refunded']);
});

test('repeat verification returns the persisted receipt without bank or notification dependencies', async (t) => {
  t.mock.method(Payment, 'findOne', (filter) => {
    assert.deepEqual(filter, { paymentReference: 'PAY-1', user: 'customer-1' });
    return { select: async () => payment };
  });
  t.mock.method(Order, 'findById', async () => receipt);
  let body;
  const res = { status() { return this; }, json(value) { body = value; return this; } };
  await verifyPayment({ body: { paymentReference: 'PAY-1' }, user: { id: 'customer-1' } }, res, error => { throw error; });
  assert.equal(body.data, receipt);
});

test('another customer cannot recover the payment receipt', async (t) => {
  t.mock.method(Payment, 'findOne', (filter) => {
    assert.equal(filter.user, 'another-customer');
    return { select: async () => null };
  });
  await assert.rejects(verifyPayment({ body: { paymentReference: 'PAY-1' }, user: { id: 'another-customer' } }, {}, error => { throw error; }), { code: 'PAYMENT_NOT_FOUND' });
});

test('a late failed gateway response cannot overwrite an already confirmed payment', async (t) => {
  t.mock.method(Payment, 'findById', async () => payment);
  t.mock.method(Order, 'findById', async () => receipt);
  t.mock.method(Payment, 'updateOne', async () => { throw new Error('Must not write'); });
  const result = await finalizeVerifiedPayment({ payment: { ...payment, order: null }, gatewayResult: { verified: false, failed: true, status: 'AUTHORIZATION_FAILED' }, req: {} });
  assert.equal(result, receipt);
});

test('captured payment awaiting reconciliation cannot be downgraded to failed', async (t) => {
  t.mock.method(Payment, 'findById', async () => ({ ...payment, order: null, status: 'captured' }));
  t.mock.method(Payment, 'updateOne', async () => ({ matchedCount: 0 }));
  await assert.rejects(finalizeVerifiedPayment({ payment: { ...payment, order: null }, gatewayResult: { verified: false, failed: true, status: 'AUTHORIZATION_FAILED', raw: {} }, req: {} }), { code: 'PAYMENT_RECONCILIATION_REQUIRED' });
});
