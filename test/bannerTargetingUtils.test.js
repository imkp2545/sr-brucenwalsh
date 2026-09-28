const assert = require('node:assert/strict');
const test = require('node:test');
const { activeBannerFilter } = require('../utils/bannerTargetingUtils');

test('activeBannerFilter applies schedule, placement, platform, and audience assignments', () => {
  const now = new Date('2026-08-01T12:00:00.000Z');
  const filter = activeBannerFilter({
    placement: 'collectionHero,collectionInline',
    platform: 'ios',
    audience: 'authenticated',
    targetPath: '/collections/bridal',
  }, now);

  assert.equal(filter.status, 'active');
  assert.deepEqual(filter.startsAt, { $lte: now });
  assert.deepEqual(filter.placement, { $in: ['collectionHero', 'collectionInline'] });
  assert.deepEqual(filter.audience, { $in: ['all', 'authenticated'] });
  assert.equal(filter.$and.length, 3);
  assert.deepEqual(filter.$and[1].$or[0], { platforms: 'ios' });
  assert.deepEqual(filter.$and[2], { targetPath: '/collections/bridal' });
});

test('activeBannerFilter preserves generic fallback for non-collection placements', () => {
  const filter = activeBannerFilter({
    placement: 'productStrip',
    targetPath: '/products/diamond-ring',
  }, new Date('2026-08-01T12:00:00.000Z'));

  assert.deepEqual(filter.$and[1].$or[0], { targetPath: '/products/diamond-ring' });
  assert.deepEqual(filter.$and[1].$or[1], { targetPath: '' });
});

test('activeBannerFilter leaves optional targets unrestricted when omitted', () => {
  const filter = activeBannerFilter({}, new Date('2026-08-01T12:00:00.000Z'));

  assert.equal(filter.placement, undefined);
  assert.equal(filter.audience, undefined);
  assert.equal(filter.$and.length, 1);
});
