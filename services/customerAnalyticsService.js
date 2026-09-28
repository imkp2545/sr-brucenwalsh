const mongoose = require('mongoose');
const Event = require('../models/customerActivityEventModel');

const interestWeights = { product_view: 3, product_image_view: 1, product_share: 7, reviews_view: 2, wishlist_add: 10, wishlist_remove: -5, cart_add: 15, cart_remove: -7, checkout_started: 20, payment_started: 25 };
const score = { $switch: { branches: Object.entries(interestWeights).map(([name, weight]) => ({ case: { $eq: ['$name', name] }, then: weight })), default: 0 } };
const range = (days = 30) => { const safe = Math.min(365, Math.max(1, Number(days) || 30)); return { start: new Date(Date.now() - safe * 86400000), end: new Date(), days: safe }; };
const productPipeline = (match, limit, full = true) => [
  { $match: { ...match, entityType: 'product', entityId: { $ne: null } } },
  { $group: { _id: '$entityId', views: { $sum: { $cond: [{ $eq: ['$name', 'product_view'] }, 1, 0] } }, activeSeconds: { $sum: { $cond: [{ $eq: ['$name', 'product_time'] }, '$durationSeconds', 0] } }, wishlists: { $sum: { $cond: [{ $eq: ['$name', 'wishlist_add'] }, 1, 0] } }, cartAdds: { $sum: { $cond: [{ $eq: ['$name', 'cart_add'] }, 1, 0] } }, score: { $sum: score }, users: { $addToSet: '$user' } } },
  { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
  { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
  { $project: { productId: '$_id', _id: 0, name: { $ifNull: ['$product.name', 'Unavailable product'] }, sku: '$product.sku', views: 1, activeSeconds: 1, score: 1, ...(full ? { wishlists: 1, cartAdds: 1, uniqueUsers: { $size: '$users' } } : {}) } },
  { $sort: { score: -1, activeSeconds: -1 } }, { $limit: limit },
];

const overview = async (days) => {
  const period = range(days); const match = { occurredAt: { $gte: period.start, $lte: period.end } };
  const [summary, eventCounts, screens, products, daily, searches] = await Promise.all([
    Event.aggregate([{ $match: match }, { $group: { _id: null, users: { $addToSet: '$user' }, sessions: { $addToSet: { user: '$user', session: '$sessionId' } }, activeSeconds: { $sum: { $cond: [{ $eq: ['$name', 'screen_time'] }, '$durationSeconds', 0] } } } }, { $project: { _id: 0, uniqueUsers: { $size: '$users' }, sessions: { $size: '$sessions' }, activeSeconds: 1 } }]),
    Event.aggregate([{ $match: match }, { $group: { _id: '$name', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Event.aggregate([{ $match: { ...match, name: 'screen_time' } }, { $group: { _id: '$screen', activeSeconds: { $sum: '$durationSeconds' }, visits: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $project: { screen: '$_id', _id: 0, activeSeconds: 1, visits: 1, uniqueUsers: { $size: '$users' } } }, { $sort: { activeSeconds: -1 } }, { $limit: 20 }]),
    Event.aggregate(productPipeline(match, 20)),
    Event.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Asia/Kolkata' } }, users: { $addToSet: '$user' }, sessions: { $addToSet: { user: '$user', session: '$sessionId' } }, activeSeconds: { $sum: { $cond: [{ $eq: ['$name', 'screen_time'] }, '$durationSeconds', 0] } } } }, { $project: { date: '$_id', _id: 0, uniqueUsers: { $size: '$users' }, sessions: { $size: '$sessions' }, activeSeconds: 1 } }, { $sort: { date: 1 } }]),
    Event.aggregate([{ $match: { ...match, name: 'search', 'properties.query': { $ne: '' } } }, { $group: { _id: { query: { $toLower: '$properties.query' }, zeroResults: { $eq: ['$properties.resultCount', 0] } }, searches: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $project: { query: '$_id.query', zeroResults: '$_id.zeroResults', searches: 1, uniqueUsers: { $size: '$users' }, _id: 0 } }, { $sort: { searches: -1 } }, { $limit: 20 }]),
  ]);
  const totals = summary[0] || { uniqueUsers: 0, sessions: 0, activeSeconds: 0 };
  return { period, summary: { ...totals, averageSessionSeconds: totals.sessions ? Math.round(totals.activeSeconds / totals.sessions) : 0 }, eventCounts, screens, products, daily, searches };
};

const customerInsight = async (userId, days = 90) => {
  const period = range(days); const match = { user: new mongoose.Types.ObjectId(userId), occurredAt: { $gte: period.start, $lte: period.end } };
  const [summary, screens, products, recent] = await Promise.all([
    Event.aggregate([{ $match: match }, { $group: { _id: null, sessions: { $addToSet: '$sessionId' }, activeSeconds: { $sum: { $cond: [{ $eq: ['$name', 'screen_time'] }, '$durationSeconds', 0] } }, lastActiveAt: { $max: '$occurredAt' } } }, { $project: { _id: 0, sessions: { $size: '$sessions' }, activeSeconds: 1, lastActiveAt: 1 } }]),
    Event.aggregate([{ $match: { ...match, name: 'screen_time' } }, { $group: { _id: '$screen', activeSeconds: { $sum: '$durationSeconds' }, visits: { $sum: 1 } } }, { $sort: { activeSeconds: -1 } }, { $limit: 10 }]),
    Event.aggregate(productPipeline(match, 10, false)),
    Event.find(match).select('name screen entityType entityId durationSeconds occurredAt').sort({ occurredAt: -1 }).limit(20).lean(),
  ]);
  const totals = summary[0] || { sessions: 0, activeSeconds: 0, lastActiveAt: null };
  return { period, summary: { ...totals, averageSessionSeconds: totals.sessions ? Math.round(totals.activeSeconds / totals.sessions) : 0 }, screens, products, recent };
};
module.exports = { overview, customerInsight, interestWeights };
