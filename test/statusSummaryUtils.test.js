const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyStatusFilter,
  countsFromRows,
  statusValues,
} = require('../utils/statusSummaryUtils');

test('statusValues normalizes comma-separated status filters', () => {
  assert.deepEqual(statusValues(' requested, underReview ,,approved '), [
    'requested',
    'underReview',
    'approved',
  ]);
});

test('applyStatusFilter uses equality for one status and $in for multiple statuses', () => {
  assert.deepEqual(applyStatusFilter({}, 'status', 'captured'), { status: 'captured' });
  assert.deepEqual(applyStatusFilter({}, 'status', 'created,pending'), {
    status: { $in: ['created', 'pending'] },
  });
});

test('countsFromRows safely converts aggregation rows to a status map', () => {
  assert.deepEqual(countsFromRows([
    { _id: 'requested', count: 3 },
    { _id: 'completed', count: 2 },
    { _id: null, count: 1 },
  ]), {
    requested: 3,
    completed: 2,
  });
});
