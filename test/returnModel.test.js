const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ReturnRequest = require('../models/returnModel');

test('return model stores operational pickup and status history', async () => {
  const request = new ReturnRequest({
    returnNumber: 'RET-TEST-001',
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{
      orderItemId: new mongoose.Types.ObjectId(),
      product: new mongoose.Types.ObjectId(),
      sku: 'BW-TEST-001',
      name: 'Test ring',
      quantity: 1,
      unitPrice: 25000,
      reason: 'sizeIssue',
      condition: 'unused',
      resolution: 'refund',
    }],
    pickupAddress: {
      recipientName: 'Customer', phone: '9999999999', line1: 'Test address',
      city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
    },
    status: 'pickupScheduled',
    pickupScheduledAt: new Date(),
    statusHistory: [{ status: 'requested', note: 'Created' }, { status: 'pickupScheduled', note: 'Pickup arranged' }],
  });
  await request.validate();
  assert.equal(request.statusHistory.length, 2);
  assert.equal(request.returnShippingProvider, undefined);
});

test('return model stores protected Blue Dart reverse pickup lifecycle data', async () => {
  const request = new ReturnRequest({
    returnNumber: 'RET-TEST-REVERSE-001',
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{
      orderItemId: new mongoose.Types.ObjectId(), product: new mongoose.Types.ObjectId(),
      sku: 'BW-TEST-002', name: 'Test pendant', quantity: 1, unitPrice: 30000,
      reason: 'damaged', condition: 'opened', resolution: 'storeCredit',
    }],
    pickupAddress: {
      recipientName: 'Customer', phone: '9999999999', line1: 'Test address',
      city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
    },
    status: 'pickupScheduled',
    returnShippingProvider: 'blueDart',
    returnAwbNumber: '90001755572',
    reversePickup: {
      status: 'pickupScheduled', awbNumber: '90001755572', tokenNumber: '123456',
      registrationDate: new Date(), requestedPickupAt: nextBusinessDay(), areaCode: 'BOM', weight: 0.5,
      idempotencyKey: 'return-pickup-test-001',
    },
  });
  await request.validate();
  assert.equal(request.reversePickup.status, 'pickupScheduled');
  assert.equal(request.reversePickup.awbNumber, '90001755572');
  assert.equal(request.reversePickup.weightUnit, 'kg');
});

test('return model rejects replacement as a resolution', async () => {
  const request = new ReturnRequest({
    returnNumber: 'RET-TEST-NO-REPLACEMENT',
    order: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{
      orderItemId: new mongoose.Types.ObjectId(), product: new mongoose.Types.ObjectId(),
      sku: 'BW-TEST-003', name: 'Test bracelet', quantity: 1, unitPrice: 18000,
      reason: 'damaged', condition: 'opened', resolution: 'replacement',
    }],
    pickupAddress: {
      recipientName: 'Customer', phone: '9999999999', line1: 'Test address',
      city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
    },
  });
  await assert.rejects(request.validate(), /`replacement` is not a valid enum value/);
});

function nextBusinessDay() {
  const value = new Date(Date.now() + 48 * 60 * 60 * 1000);
  if (value.getDay() === 0) value.setDate(value.getDate() + 1);
  return value;
}
