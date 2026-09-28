const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRoleDashboardPolicy,
  assertFinanciallySafeWorkspace,
} = require('../services/dashboardWorkspaceService');

const expectedActions = {
  superAdmin: ['orders', 'products', 'appointments', 'banners'],
  admin: ['orders', 'shipments', 'appointments', 'customers'],
  catalogManager: ['productNew', 'categories', 'collections', 'reviews'],
  orderManager: ['shipments', 'orders', 'returns', 'buybacks'],
  supportManager: ['appointments', 'returns', 'buybacks', 'customers'],
  marketingManager: ['banners', 'coupons', 'collections', 'notifications'],
};

test('every admin role has an explicit dashboard policy and action allowlist', () => {
  for (const [role, actions] of Object.entries(expectedActions)) {
    const policy = getRoleDashboardPolicy(role);
    assert.ok(policy, `${role} dashboard policy should exist`);
    assert.deepEqual(policy.quickActions, actions);
    assert.equal(policy.metricKeys.length, 4);
  }
});

test('role policies expose only corresponding operational resources', () => {
  assert.deepEqual(getRoleDashboardPolicy('catalogManager').resources.sort(), ['products']);
  assert.deepEqual(getRoleDashboardPolicy('marketingManager').resources.sort(), ['banners', 'cms', 'collections', 'coupons']);
  assert.deepEqual(getRoleDashboardPolicy('supportManager').resources.sort(), ['appointments', 'buybacks', 'returns', 'shipments']);
  assert.equal(getRoleDashboardPolicy('customer'), null);
});

test('workspace payload security guard rejects financial fields at any depth', () => {
  assert.doesNotThrow(() => assertFinanciallySafeWorkspace({
    role: 'orderManager',
    metrics: [{ key: 'ordersAwaitingShipment', value: 4 }],
    trend: { series: [{ name: 'Orders', data: [0, 1, 3] }] },
  }));
  assert.throws(
    () => assertFinanciallySafeWorkspace({ metrics: [{ revenue: 25000 }] }),
    /Financial field is not permitted/,
  );
  assert.throws(
    () => assertFinanciallySafeWorkspace({ workQueue: { items: [{ grandTotal: 25750 }] } }),
    /Financial field is not permitted/,
  );
});
