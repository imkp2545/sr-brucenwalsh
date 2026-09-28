const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const CustomerActivityEvent = require('../models/customerActivityEventModel');

const validEvent = () => ({
  eventId: 'evt-12345678', user: new mongoose.Types.ObjectId(), sessionId: 'session-12345678',
  name: 'screen_time', screen: '/app/home', durationSeconds: 45,
  occurredAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
});

test('customer activity accepts privacy-safe active screen timing', async () => {
  const event = new CustomerActivityEvent(validEvent());
  await event.validate();
  assert.equal(event.durationSeconds, 45);
  assert.equal(event.properties.query, '');
});

test('customer activity rejects unsupported event names and excessive durations', async () => {
  const event = new CustomerActivityEvent({ ...validEvent(), name: 'password_typed', durationSeconds: 5000 });
  await assert.rejects(event.validate(), /password_typed.*not a valid enum|maximum allowed/i);
});
