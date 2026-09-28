const test = require('node:test');
const assert = require('node:assert/strict');
const { deterministicIntent, parseAmount } = require('../services/voiceIntentService');

test('extracts Indian-style voice budgets', () => {
  assert.equal(parseAmount('show rings under 20k'), 20000);
  assert.equal(parseAmount('necklace within 1.5 lakh'), 150000);
  assert.equal(parseAmount('earrings below ₹5000'), 5000);
});

test('turns a natural product search into catalog filters', () => {
  const result = deterministicIntent('Show me diamond rings under ₹20,000');
  assert.equal(result.intent, 'SEARCH_CATALOG');
  assert.equal(result.filters.category, 'rings');
  assert.equal(result.filters.gemstone, 'diamond');
  assert.equal(result.filters.maxPrice, 20000);
});

test('keeps session filters for cheaper follow-up requests', () => {
  const result = deterministicIntent('Show me something cheaper', {
    filters: { category: 'rings', gemstone: 'diamond', maxPrice: 20000 },
  });
  assert.equal(result.intent, 'SEARCH_CATALOG');
  assert.equal(result.filters.category, 'rings');
  assert.equal(result.filters.gemstone, 'diamond');
  assert.equal(result.filters.maxPrice, 16000);
  assert.equal(result.filters.sort, 'priceLow');
});

test('resolves ordinal product and commerce actions', () => {
  assert.deepEqual(
    deterministicIntent('Open the second product').intent,
    'OPEN_PRODUCT',
  );
  assert.equal(deterministicIntent('Open the second product').ordinal, 2);
  assert.equal(deterministicIntent('Add this to my cart').intent, 'ADD_TO_CART');
  assert.equal(deterministicIntent('Take me to checkout').destination, '/checkout');
});

test('opens visible products using natural English, Hindi, and Hinglish ordinals', () => {
  const commands = [
    ['Open product 2', 2],
    ['Open second product', 2],
    ['Show me number 2', 2],
    ['2 number product kholo', 2],
    ['Doosra product open karo', 2],
    ['दूसरा प्रोडक्ट खोलो', 2],
    ['Open first product', 1],
    ['Teesra product kholo', 3],
  ];
  for (const [command, expectedOrdinal] of commands) {
    const result = deterministicIntent(command);
    assert.equal(result.intent, 'OPEN_PRODUCT', command);
    assert.equal(result.ordinal, expectedOrdinal, command);
  }
});

test('routes narration playback controls without changing product context', () => {
  for (const phrase of ['Resume', 'Continue explaining', 'Aage bolo', 'आगे बोलो']) {
    assert.equal(deterministicIntent(phrase).intent, 'RESUME_NARRATION', phrase);
  }
  for (const phrase of ['Start again', 'Repeat from start', 'Shuru se bolo', 'शुरू से बताओ']) {
    assert.equal(deterministicIntent(phrase).intent, 'RESTART_NARRATION', phrase);
  }
  for (const phrase of ['Bas', 'Ruko', 'Band karo', 'रुको']) {
    assert.equal(deterministicIntent(phrase).intent, 'STOP', phrase);
  }
});

test('routes interruption phrases without waiting for AI', () => {
  for (const phrase of ['Stop', 'stop speaking', 'Cancel', 'Enough', 'Shut up', 'Be quiet']) {
    assert.equal(deterministicIntent(phrase).intent, 'STOP');
  }
});

test('maps existing cart, coupon, history, and account capabilities', () => {
  assert.equal(deterministicIntent('Remove the second item from my cart').intent, 'REMOVE_FROM_CART');
  assert.equal(deterministicIntent('Remove the second item from my cart').ordinal, 2);
  assert.equal(deterministicIntent('Change the quantity to three').quantity, 3);
  assert.equal(deterministicIntent('How much is my cart?').intent, 'CART_SUMMARY');
  assert.equal(deterministicIntent('Apply coupon SAVE20').couponCode, 'SAVE20');
  assert.equal(deterministicIntent('Go back').intent, 'GO_BACK');
  assert.equal(deterministicIntent('Open my orders').destination, '/orders');
});

test('maps global navigation and scrolling in English and Hinglish', () => {
  assert.equal(deterministicIntent('Open shop').destination, '/app/explore');
  assert.equal(deterministicIntent('Dukaan kholo').destination, '/app/explore');
  assert.equal(deterministicIntent('Wapas jao').intent, 'GO_BACK');
  assert.deepEqual(
    { intent: deterministicIntent('Scroll down').intent, direction: deterministicIntent('Scroll down').destination },
    { intent: 'SCROLL', direction: 'down' },
  );
  assert.equal(deterministicIntent('Upar scroll').destination, 'up');
});

test('applies any single supported catalog filter immediately', () => {
  assert.equal(deterministicIntent('Show me earrings').filters.category, 'earrings');
  assert.equal(deterministicIntent('Show me gold jewellery').filters.material, 'gold');
  assert.equal(deterministicIntent('Show me red products').filters.color, 'red');
  assert.equal(deterministicIntent('Products under 5000').filters.maxPrice, 5000);
});

test('routes valid partial shopping transcripts to the existing catalog search', () => {
  const phrases = [
    'display pendant',
    'show pendants',
    'show me rings',
    'style pendant',
    'under 5000',
    'budget 10000',
    'gold jewellery',
    'red earrings',
    'pendant dikhao',
    '5000 ke andar',
    'gold',
    'gold wale',
    'rings',
    'rings dikhao',
  ];
  for (const phrase of phrases) {
    assert.equal(deterministicIntent(phrase).intent, 'SEARCH_CATALOG', phrase);
  }
});

test('uses the generic fallback only when no known intent, filter, or action matches', () => {
  const result = deterministicIntent('please explain the weather on mars');
  assert.equal(result.intent, 'UNKNOWN');
  assert.equal(result.filters.category, '');
  assert.equal(result.filters.maxPrice, null);
});

test('combines partial filters without requiring a category', () => {
  const result = deterministicIntent('Diamond under 10000');
  assert.equal(result.intent, 'SEARCH_CATALOG');
  assert.equal(result.filters.gemstone, 'diamond');
  assert.equal(result.filters.maxPrice, 10000);
  assert.equal(result.filters.category, '');
});

test('preserves prior filters for incremental follow-up commands', () => {
  const first = deterministicIntent('Mujhe earrings dikhao');
  const second = deterministicIntent('5000 ke andar', { filters: first.filters });
  const third = deterministicIntent('Gold color mein', { filters: second.filters });
  assert.equal(third.filters.category, 'earrings');
  assert.equal(third.filters.maxPrice, 5000);
  assert.equal(third.filters.color, 'gold');
});

test('removes one filter or clears all filters without disturbing unrelated state', () => {
  const previous = { category: 'earrings', material: 'gold', color: 'red', maxPrice: 5000 };
  const withoutPrice = deterministicIntent('Price filter hata do', { filters: previous });
  assert.equal(withoutPrice.filters.maxPrice, null);
  assert.equal(withoutPrice.filters.category, 'earrings');
  assert.equal(withoutPrice.filters.material, 'gold');

  const withoutGold = deterministicIntent('Remove the gold filter', { filters: previous });
  assert.equal(withoutGold.filters.material, '');
  assert.equal(withoutGold.filters.color, 'red');

  const cleared = deterministicIntent('Sab filters clear kar do', { filters: previous });
  assert.equal(cleared.intent, 'SEARCH_CATALOG');
  assert.equal(cleared.filters.category, '');
  assert.equal(cleared.filters.maxPrice, null);
});

test('understands Hindi filters and explicit price ranges', () => {
  assert.equal(deterministicIntent('मुझे अंगूठियाँ दिखाओ').filters.category, 'rings');
  assert.equal(deterministicIntent('मुझे सोने की ज्वेलरी दिखाओ').filters.material, 'gold');
  const range = deterministicIntent('Show products between 5k and 15k').filters;
  assert.equal(range.minPrice, 5000);
  assert.equal(range.maxPrice, 15000);
});
