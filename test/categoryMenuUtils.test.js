const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCategoryMenuSections } = require('../utils/categoryMenuUtils');

test('buildCategoryMenuSections uses only supplied Admin records and omits empty sections', () => {
  const sections = buildCategoryMenuSections(
    [
      {
        _id: 'rings-id',
        name: 'Rings',
        slug: 'rings',
        menuSection: 'productType',
        menuFilterType: 'category',
        icon: { url: 'https://cdn.example.com/ring.png' },
      },
      {
        _id: 'women-id',
        name: 'For Her',
        menuLabel: 'Women',
        menuSection: 'gender',
        menuFilterType: 'gender',
        menuFilterValue: 'Women',
      },
    ],
    [
      {
        _id: 'bridal-id',
        name: 'Bridal Jewellery',
        slug: 'bridal-jewellery',
        mobileImage: { url: 'https://cdn.example.com/bridal.jpg' },
      },
    ],
  );

  assert.deepEqual(sections.map((section) => section.key), ['gender', 'productType', 'collections']);
  assert.deepEqual(sections[0].items[0].filter, { gender: 'women' });
  assert.deepEqual(sections[1].items[0].filter, { category: 'rings' });
  assert.equal(sections[1].items[0].icon.url, 'https://cdn.example.com/ring.png');
  assert.equal(sections[2].items[0].identifier, 'bridal-jewellery');
  assert.equal(sections[2].items[0].target, 'collection');
});

test('category menu tag shortcuts retain the Admin label and tag value', () => {
  const [section] = buildCategoryMenuSections([
    {
      _id: 'gift-id',
      name: 'Gift category',
      menuLabel: 'Gifts for Her',
      menuSection: 'recipient',
      menuFilterType: 'tag',
      menuFilterValue: 'Gifts-For-Her',
    },
  ]);

  assert.equal(section.title, 'Shop by Recipient');
  assert.equal(section.items[0].label, 'Gifts for Her');
  assert.deepEqual(section.items[0].filter, { tags: 'gifts-for-her' });
});
