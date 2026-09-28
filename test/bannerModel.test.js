const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const Banner = require('../models/bannerModel');

const image = {
  url: 'https://cdn.example.com/collection-inline.jpg',
  publicId: 'banners/collection-inline',
  alt: 'Diamond collection editorial',
  width: 1080,
  height: 480,
};

test('banner model supports targeted collection inline placements', async () => {
  const banner = new Banner({
    title: 'The Bridal Edit',
    placement: 'collectionInline',
    mobileImage: image,
    targetPath: '/collections/bridal',
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await banner.validate();
  assert.equal(banner.placement, 'collectionInline');
  assert.equal(banner.targetPath, '/collections/bridal');
});

test('banner model rejects collection banners without a specific page', async () => {
  const banner = new Banner({
    title: 'Generic collection campaign',
    placement: 'collectionHero',
    mobileImage: image,
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await assert.rejects(
    banner.validate(),
    /specific collection page is required/i,
  );
});

test('banner model supports image-only linked creatives', async () => {
  const banner = new Banner({
    title: 'The Diamond Story',
    placement: 'homeHero',
    displayStyle: 'imageOnly',
    showContent: false,
    mobileImage: image,
    cta: {
      label: 'Open the Diamond Story',
      linkType: 'collection',
      url: '/collections/diamond-story',
    },
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await banner.validate();
  assert.equal(banner.displayStyle, 'imageOnly');
  assert.equal(banner.cta.url, '/collections/diamond-story');
});

test('banner model supports stacked collection inline positions', async () => {
  const banner = new Banner({
    title: 'Bridal Stories',
    placement: 'collectionInline',
    inlinePosition: 'top',
    inlineGroup: 'setB',
    mobileImage: image,
    targetPath: '/collections/bridal',
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await banner.validate();
  assert.equal(banner.inlinePosition, 'top');
  assert.equal(banner.inlineGroup, 'setB');
});

test('banner model uses one mobile-first creative', async () => {
  const banner = new Banner({
    title: 'Wishlist campaign',
    placement: 'wishlistHero',
    mobileImage: image,
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await banner.validate();
  assert.equal(Banner.schema.path('desktopImage'), undefined);
  assert.equal(banner.placement, 'wishlistHero');
  assert.equal(banner.mobileImage.url, image.url);
});

test('banner model supports each Home inline creative size', async () => {
  const placements = ['homeSecondary', 'homeFeature', 'homeStrip'];

  await Promise.all(placements.map((placement) => new Banner({
    title: `Home campaign ${placement}`,
    placement,
    mobileImage: image,
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  }).validate()));
});

test('Home inline banners support grouped top and bottom positions', async () => {
  const banner = new Banner({
    title: 'Home editorial stories',
    placement: 'homeFeature',
    inlinePosition: 'bottom',
    inlineGroup: 'setC',
    mobileImage: image,
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: new mongoose.Types.ObjectId(),
  });

  await banner.validate();
  assert.equal(banner.inlinePosition, 'bottom');
  assert.equal(banner.inlineGroup, 'setC');
});
