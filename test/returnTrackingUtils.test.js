const test = require('node:test');
const assert = require('node:assert/strict');
const { applyReverseTracking } = require('../utils/returnTrackingUtils');

const returnFixture = () => ({
  status: 'pickupScheduled',
  pickedUpAt: undefined,
  receivedAt: undefined,
  reversePickup: { status: 'pickupScheduled', trackingEvents: [] },
  statusHistory: [],
});

test('reverse tracking advances a scheduled return to picked up', () => {
  const request = returnFixture();
  const changes = applyReverseTracking(request, {
    events: [{ code: 'PU', status: 'Shipment Picked Up', occurredAt: '2026-07-20T10:00:00.000Z' }],
  });
  assert.equal(changes.addedEvents, 1);
  assert.equal(request.status, 'pickedUp');
  assert.equal(request.reversePickup.status, 'pickedUp');
  assert.equal(request.statusHistory.at(-1).status, 'pickedUp');
});

test('reverse tracking advances an in-flight return to received', () => {
  const request = returnFixture();
  request.status = 'pickedUp';
  request.reversePickup.status = 'inTransit';
  const changes = applyReverseTracking(request, {
    events: [{ code: 'DL', status: 'Delivered', occurredAt: '2026-07-21T12:00:00.000Z' }],
  });
  assert.equal(changes.statusChanged, true);
  assert.equal(request.status, 'received');
  assert.equal(request.reversePickup.status, 'received');
  assert.equal(request.statusHistory.at(-1).status, 'received');
});
