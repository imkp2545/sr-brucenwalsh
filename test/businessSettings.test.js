const test = require('node:test');
const assert = require('node:assert/strict');
const {
  businessSettingDefinitions,
  businessSettingDefinitionByKey,
  normalizeBusinessSetting,
  defaultFor,
} = require('../config/businessSettings');

test('business settings use a unique explicit allowlist', () => {
  const keys = businessSettingDefinitions.map((definition) => definition.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(businessSettingDefinitionByKey.size, keys.length);
  assert.ok(keys.includes('appointment.home_visit_min_product_price'));
  assert.ok(keys.includes('return.window_days'));
  assert.ok(keys.includes('maintenance.enabled'));
  assert.equal(keys.some((key) => /secret|password|token|api_key/i.test(key)), false);
});

test('business setting normalization enforces type and range rules', () => {
  const returnWindow = businessSettingDefinitionByKey.get('return.window_days');
  const maintenance = businessSettingDefinitionByKey.get('maintenance.enabled');
  const email = businessSettingDefinitionByKey.get('store.support_email');

  assert.equal(normalizeBusinessSetting(returnWindow, '30'), 30);
  assert.equal(normalizeBusinessSetting(maintenance, 'true'), true);
  assert.equal(normalizeBusinessSetting(email, ' support@example.com '), 'support@example.com');
  assert.throws(() => normalizeBusinessSetting(returnWindow, 0), /cannot be below 1/);
  assert.throws(() => normalizeBusinessSetting(returnWindow, 7.5), /whole number/);
  assert.throws(() => normalizeBusinessSetting(email, 'not-an-email'), /invalid format/);
});

test('every business setting has a default matching its declared type', () => {
  for (const definition of businessSettingDefinitions) {
    const value = defaultFor(definition);
    if (definition.valueType === 'number') assert.equal(typeof value, 'number', definition.key);
    if (definition.valueType === 'boolean') assert.equal(typeof value, 'boolean', definition.key);
    if (definition.valueType === 'string') assert.equal(typeof value, 'string', definition.key);
  }
});
