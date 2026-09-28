const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../models/notificationModel');
const controller = require('../controllers/notificationController');

const response = () => ({ status() { return this; }, json(body) { this.body = body; return this; } });
const customerRequest = { user: { id: 'customer-one', role: 'customer' }, params: { notificationId: 'notification-one' }, query: {} };

test('mark unread scopes writes to the owner and removes the old read timestamp', async (t) => {
  let received;
  t.mock.method(Notification, 'findOneAndUpdate', async (...args) => { received = args; return { isRead: false }; });
  const res = response();
  await controller.markAsUnread(customerRequest, res, (error) => { throw error; });
  assert.deepEqual(received[0], { _id: 'notification-one', user: 'customer-one' });
  assert.deepEqual(received[1], { $set: { isRead: false }, $unset: { readAt: 1 } });
  assert.equal(res.body.data.isRead, false);
});

test('a missing or another customer’s notification cannot be marked unread', async (t) => {
  t.mock.method(Notification, 'findOneAndUpdate', async () => null);
  let failure;
  await controller.markAsUnread(customerRequest, response(), (error) => { failure = error; });
  assert.equal(failure.code, 'NOTIFICATION_NOT_FOUND');
});

test('order and offer filters are applied before pagination without dropping ownership', async (t) => {
  const filters = [];
  t.mock.method(Notification, 'find', (filter) => {
    filters.push(filter);
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
  });
  t.mock.method(Notification, 'countDocuments', async () => 0);
  for (const category of ['orders', 'offers']) {
    await controller.listNotifications({ ...customerRequest, query: { category, page: '2' } }, response(), (error) => { throw error; });
  }
  assert.deepEqual(filters[0], { user: 'customer-one', type: { $in: ['order', 'payment', 'shipment', 'return', 'refund', 'buyback'] } });
  assert.deepEqual(filters[1], { user: 'customer-one', type: 'promotion' });
});
