const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Review = require('../models/reviewModel');
const reviewRouter = require('../routes/reviewRoutes');

const validReview = () => ({
  user: new mongoose.Types.ObjectId(),
  product: new mongoose.Types.ObjectId(),
  order: new mongoose.Types.ObjectId(),
  orderItemId: new mongoose.Types.ObjectId(),
  rating: 5,
  body: 'Beautifully finished and exactly as presented.',
});

test('review model accepts a verified-purchase review', async () => {
  const review = new Review(validReview());
  await review.validate();
  assert.equal(review.status, 'published');
  assert.equal(review.isVerifiedPurchase, true);
  assert.equal(review.helpfulCount, 0);
});

test('review model rejects ratings outside one to five', async () => {
  const review = new Review({ ...validReview(), rating: 6 });
  await assert.rejects(review.validate(), /rating/i);
});

test('review admin routes allow deletion without moderation actions', () => {
  const routes = reviewRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
    }));

  assert.ok(routes.some(({ path, methods }) => (
    path === '/manage/:reviewId' && methods.includes('delete')
  )));
  assert.equal(routes.some(({ path }) => path.includes('moderate')), false);
});
