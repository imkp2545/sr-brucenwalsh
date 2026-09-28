require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/dbConfig');
const Product = require('../models/productModel');
const Review = require('../models/reviewModel');

const migrateReviewsImmediatePublish = async () => {
  await connectDatabase();

  const published = await Review.updateMany(
    { status: { $in: ['pending', 'approved'] } },
    {
      $set: { status: 'published' },
      $unset: { moderationNote: '', moderatedBy: '', moderatedAt: '' },
    },
  );

  const summaries = await Review.aggregate([
    { $match: { status: { $ne: 'rejected' } } },
    {
      $group: {
        _id: '$product',
        averageRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  const products = await Product.find({}).select('_id').lean();
  const summariesByProduct = new Map(
    summaries.map((summary) => [String(summary._id), summary]),
  );
  if (products.length) {
    await Product.bulkWrite(
      products.map((product) => {
        const summary = summariesByProduct.get(String(product._id));
        return {
          updateOne: {
            filter: { _id: product._id },
            update: {
              $set: {
                averageRating: summary ? Math.round(summary.averageRating * 10) / 10 : 0,
                reviewCount: summary?.reviewCount || 0,
              },
            },
          },
        };
      }),
    );
  }

  console.info(
    `${published.modifiedCount} legacy reviews published; ${summaries.length} product ratings recalculated`,
  );
};

migrateReviewsImmediatePublish()
  .catch((error) => {
    console.error(`Review publication migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
