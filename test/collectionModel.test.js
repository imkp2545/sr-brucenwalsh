const test = require('node:test');
const assert = require('node:assert/strict');
const Collection = require('../models/collectionModel');

const validCollection = () => ({
  name: 'Bridal Icons',
  slug: 'bridal-icons',
  status: 'active',
});

test('collection Home placement is opt-in by default', async () => {
  const collection = new Collection(validCollection());
  await collection.validate();

  assert.equal(collection.showOnHome, false);
  assert.equal(collection.homeDisplayOrder, 0);
});

test('collection accepts Admin-managed Home title and ordering', async () => {
  const collection = new Collection({
    ...validCollection(),
    showOnHome: true,
    homeTitle: 'The Bridal Edit',
    homeDisplayOrder: 2,
  });
  await collection.validate();

  assert.equal(collection.showOnHome, true);
  assert.equal(collection.homeTitle, 'The Bridal Edit');
  assert.equal(collection.homeDisplayOrder, 2);
});

test('collection rejects a negative Home display order', async () => {
  const collection = new Collection({
    ...validCollection(),
    showOnHome: true,
    homeDisplayOrder: -1,
  });

  await assert.rejects(collection.validate(), /homeDisplayOrder/i);
});
