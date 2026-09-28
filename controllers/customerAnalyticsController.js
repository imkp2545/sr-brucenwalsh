const mongoose = require('mongoose');
const CustomerActivityEvent = require('../models/customerActivityEventModel');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const AppError = require('../utils/appError');
const analyticsService = require('../services/customerAnalyticsService');

const allowedNames = new Set(CustomerActivityEvent.schema.path('name').enumValues);
const allowedPlatforms = new Set(['ios', 'android', 'web', 'unknown']);
const allowedEntityTypes = new Set(['', 'product', 'category', 'collection']);
const cleanText = (value, max) => String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);

const ingest = asyncHandler(async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!events.length || events.length > 50) throw new AppError('Provide between 1 and 50 analytics events', 422, 'INVALID_EVENT_BATCH');
  const retentionDays = Math.min(365, Math.max(30, Number(process.env.CUSTOMER_ANALYTICS_RETENTION_DAYS) || 180));
  const now = Date.now();
  const documents = events.map((event) => {
    const occurredAt = new Date(event.occurredAt);
    if (!allowedNames.has(event.name) || !event.eventId || !event.sessionId || Number.isNaN(occurredAt.getTime())) {
      throw new AppError('Analytics event is invalid', 422, 'INVALID_ANALYTICS_EVENT');
    }
    if (Math.abs(now - occurredAt.getTime()) > 7 * 86400000) throw new AppError('Analytics event timestamp is outside the accepted window', 422, 'INVALID_EVENT_TIME');
    const entityType = allowedEntityTypes.has(event.entityType) ? event.entityType : '';
    const entityId = mongoose.isValidObjectId(event.entityId) ? event.entityId : null;
    const properties = event.properties && typeof event.properties === 'object' ? event.properties : {};
    return {
      eventId: cleanText(event.eventId, 100), user: req.user.id,
      sessionId: cleanText(event.sessionId, 100), name: event.name,
      screen: cleanText(event.screen, 160), entityType, entityId,
      durationSeconds: Math.min(3600, Math.max(0, Number(event.durationSeconds) || 0)),
      platform: allowedPlatforms.has(event.platform) ? event.platform : 'unknown',
      appVersion: cleanText(event.appVersion, 40), occurredAt,
      expiresAt: new Date(occurredAt.getTime() + retentionDays * 86400000),
      properties: {
        source: cleanText(properties.source, 80), query: cleanText(properties.query, 120),
        resultCount: Number.isFinite(Number(properties.resultCount)) ? Math.min(100000, Math.max(0, Number(properties.resultCount))) : undefined,
        categoryId: mongoose.isValidObjectId(properties.categoryId) ? properties.categoryId : null,
        collectionId: mongoose.isValidObjectId(properties.collectionId) ? properties.collectionId : null,
        price: Number.isFinite(Number(properties.price)) ? Math.min(100000000, Math.max(0, Number(properties.price))) : undefined,
        imageIndex: Number.isFinite(Number(properties.imageIndex)) ? Math.min(100, Math.max(0, Number(properties.imageIndex))) : undefined,
        filters: Array.isArray(properties.filters) ? properties.filters.slice(0, 20).map((item) => cleanText(item, 40)) : undefined,
      },
    };
  });
  let accepted = 0;
  try {
    const result = await CustomerActivityEvent.bulkWrite(
      documents.map((document) => ({
        updateOne: {
          filter: { eventId: document.eventId },
          update: { $setOnInsert: document },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    accepted = result.upsertedCount;
  } catch (error) {
    const duplicateOnly = error.code === 11000
      || error.writeErrors?.every((entry) => (entry.code || entry.err?.code) === 11000);
    if (!duplicateOnly) throw error;
    accepted = error.result?.upsertedCount || 0;
  }
  return ApiResponse.success(res, {
    statusCode: 202,
    message: 'Activity received',
    data: { accepted, duplicates: documents.length - accepted },
  });
});

const getOverview = asyncHandler(async (req, res) => ApiResponse.success(res, { data: await analyticsService.overview(req.query.days) }));
const getCustomer = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new AppError('Invalid customer ID', 422, 'INVALID_CUSTOMER');
  return ApiResponse.success(res, { data: await analyticsService.customerInsight(req.params.userId, req.query.days) });
});

module.exports = { ingest, getOverview, getCustomer };
