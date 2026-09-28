const test = require('node:test');
const assert = require('node:assert/strict');
const { rankRelatedProducts } = require('../utils/productRecommendationUtils');

const source = {
  category: 'rings',
  subcategories: ['diamond-rings'],
  collections: ['bridal'],
  productType: 'jewellery',
  material: ['Gold'],
  gemstone: ['Diamond'],
  color: ['Gold'],
  tags: ['solitaire'],
  gender: 'women',
};

test('related products prioritize close catalogue matches', () => {
  const unrelatedPopular = {
    _id: 'watch', category: 'watches', productType: 'watch', salesCount: 900,
  };
  const sameCategory = {
    _id: 'ring', category: 'rings', productType: 'jewellery', material: ['Gold'], gemstone: ['Diamond'],
  };
  const sameCollection = {
    _id: 'necklace', category: 'necklaces', collections: ['bridal'], productType: 'jewellery',
  };

  const ranked = rankRelatedProducts(source, [unrelatedPopular, sameCollection, sameCategory]);
  assert.deepEqual(ranked.map((product) => product._id), ['ring', 'necklace', 'watch']);
});

test('related product ranking uses quality signals to break affinity ties', () => {
  const lowerRated = { _id: 'lower', category: 'rings', averageRating: 3.8, salesCount: 100 };
  const higherRated = { _id: 'higher', category: 'rings', averageRating: 4.8, salesCount: 2 };

  const ranked = rankRelatedProducts(source, [lowerRated, higherRated], 1);
  assert.equal(ranked[0]._id, 'higher');
});

test('related products prefer the same purchase experience when other signals match', () => {
  const appointment = {
    _id: 'appointment', category: 'rings', purchaseMode: 'appointmentOnly',
  };
  const online = { _id: 'online', category: 'rings', purchaseMode: 'online' };

  const ranked = rankRelatedProducts(
    { ...source, purchaseMode: 'appointmentOnly' },
    [online, appointment],
  );
  assert.equal(ranked[0]._id, 'appointment');
});
