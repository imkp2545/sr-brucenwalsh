const Collection = require('../models/collectionModel');
const Product = require('../models/productModel');
const Coupon = require('../models/couponModel');
const AuditLog = require('../models/auditLogModel');
const { cloudinary } = require('../config/cloudinaryConfig');
const { emitToAll } = require('../config/socketConfig');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const { presentProductsForCustomer } = require('../utils/productPresentationUtils');

const slugify = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const requestFiles = (req) => Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();

const uploadBuffer = (file) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/collections`, resource_type: 'image' },
    (error, result) => (error ? reject(error) : resolve(result)),
  );
  stream.end(file.buffer);
});

const removeAsset = async (publicId) => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); } catch (error) { console.error('Cloudinary cleanup failed', error.message); }
};

const emit = (event, payload) => emitToAll(event, payload);

const productCardProjection = '-costPrice -variants.costPrice -careInstructions -warranty -authenticityDetails';

const collectionProductQuery = (filter = {}, sort = { createdAt: -1 }, limit = 8) =>
  Product.find({ status: 'active', deletedAt: null, ...filter })
    .select(productCardProjection)
    .populate('category', 'name slug')
    .populate('collections', 'name slug')
    .sort(sort)
    .limit(limit)
    .lean();

const section = (key, title, products, options = {}) => ({
  key,
  title,
  type: options.type || 'productGrid',
  cta: options.cta,
  collection: options.collection,
  products,
});

const resolveCollectionProducts = async (collection, limit = 12) => presentProductsForCustomer(
  await collectionProductQuery(
    { collections: collection._id },
    { isFeatured: -1, publishedAt: -1, createdAt: -1 },
    limit,
  ),
);

const audit = async (req, action, collection) => {
  try {
    await AuditLog.create({
      actorType: 'admin', actor: req.user.id, actorModel: 'Admin', action,
      resourceType: 'Collection', resourceId: collection._id, resourceLabel: collection.name,
      description: `Collection ${action}d`, ipAddress: req.ip, userAgent: req.get('user-agent'),
      requestId: req.id, route: req.originalUrl, method: req.method, statusCode: action === 'create' ? 201 : 200,
    });
  } catch (error) { console.error('Audit log write failed', error.message); }
};

const publicFilter = () => ({
  deletedAt: null,
  $and: [
    { $or: [{ status: 'active' }, { status: 'scheduled', startsAt: { $lte: new Date() } }] },
    { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: new Date() } }] },
    { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: new Date() } }] },
  ],
});

const listCollections = asyncHandler(async (req, res) => {
  const filter = publicFilter();
  if (req.query.featured === 'true') filter.isFeatured = true;
  const collections = await Collection.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean();
  return ApiResponse.success(res, { data: collections });
});

const getCollection = asyncHandler(async (req, res) => {
  const value = req.params.identifier;
  const identity = /^[a-f\d]{24}$/i.test(value) ? { _id: value } : { slug: value.toLowerCase() };
  const collection = await Collection.findOne({ ...publicFilter(), ...identity }).lean();
  if (!collection) throw new AppError('Collection not found', 404, 'COLLECTION_NOT_FOUND');
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const products = await resolveCollectionProducts(collection, limit);
  return ApiResponse.success(res, { data: { ...collection, productCount: products.length, products } });
});

const getCollectionScreen = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(2, Number(req.query.limit) || 8));
  const collections = await Collection.find({
    ...publicFilter(),
    showOnCollectionsScreen: true,
  })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

  const sections = (
    await Promise.all(
      collections.map(async (collection) => {
        const products = await resolveCollectionProducts(collection, limit);
        if (!products.length) return null;
        return section(`collection-${collection.slug}`, collection.name, products, {
          type: collection.presentation || 'productCarousel',
          cta: {
            label: 'View Collection',
            target: 'collection',
            identifier: collection.slug,
          },
          collection: {
            id: collection._id,
            slug: collection.slug,
            subtitle: collection.subtitle,
            description: collection.description,
            heroImage: collection.heroImage,
            mobileImage: collection.mobileImage,
          },
        });
      }),
    )
  ).filter(Boolean);

  const categoryFilters = new Map();
  let hasAppointmentOnlyProducts = false;
  sections.forEach((collectionSection) => {
    collectionSection.products.forEach((product) => {
      if (product.purchaseMode === 'appointmentOnly') hasAppointmentOnlyProducts = true;
      const category = product.category;
      if (!category?._id || !category.name) return;
      const key = category.slug || String(category._id);
      categoryFilters.set(key, {
        label: category.name,
        filter: {
          category: String(category._id),
          categorySlug: category.slug,
        },
      });
    });
  });

  const chips = [
    { label: 'All', filter: {} },
    ...Array.from(categoryFilters.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  ];
  if (hasAppointmentOnlyProducts) {
    chips.push({ label: 'High-End', filter: { purchaseMode: 'appointmentOnly' } });
  }

  return ApiResponse.success(res, {
    data: {
      chips,
      sections,
    },
  });
});

const getHomeCollections = asyncHandler(async (req, res) => {
  const limit = Math.min(12, Math.max(2, Number(req.query.limit) || 8));
  const collections = await Collection.find({
    ...publicFilter(),
    showOnHome: true,
  })
    .sort({ homeDisplayOrder: 1, displayOrder: 1, createdAt: -1 })
    .lean();

  const sections = (
    await Promise.all(
      collections.map(async (collection) => {
        const products = await resolveCollectionProducts(collection, limit);
        if (!products.length) return null;
        return section(`home-collection-${collection.slug}`, collection.homeTitle || collection.name, products, {
          type: collection.presentation || 'productCarousel',
          cta: {
            label: 'View collection',
            target: 'collection',
            identifier: collection.slug,
          },
          collection: {
            id: collection._id,
            name: collection.name,
            slug: collection.slug,
            subtitle: collection.subtitle,
          },
        });
      }),
    )
  ).filter(Boolean);

  return ApiResponse.success(res, { data: { sections } });
});

const listAllCollections = asyncHandler(async (req, res) => {
  const baseFilter = { deletedAt: null };
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [collections, summary] = await Promise.all([
    Collection.find(filter).sort({ displayOrder: 1, createdAt: -1 }).lean(),
    summarizeStatusFields(Collection, baseFilter),
  ]);
  const ids = collections.map((collection) => collection._id);
  const productCounts = ids.length ? await Product.aggregate([
    { $match: { deletedAt: null, collections: { $in: ids } } },
    { $unwind: '$collections' },
    { $match: { collections: { $in: ids } } },
    { $group: { _id: '$collections', count: { $sum: 1 } } },
  ]) : [];
  const countsByCollection = new Map(productCounts.map((item) => [String(item._id), item.count]));
  return ApiResponse.success(res, {
    data: collections.map((collection) => ({
      ...collection,
      productCount: countsByCollection.get(String(collection._id)) || 0,
    })),
    meta: { total: collections.length, summary },
  });
});

const createCollection = asyncHandler(async (req, res) => {
  if (!req.body.name) throw new AppError('Collection name is required', 422, 'VALIDATION_ERROR');
  const slug = slugify(req.body.slug || req.body.name);
  if (!slug) throw new AppError('A valid collection slug is required', 422, 'INVALID_SLUG');
  if (await Collection.exists({ slug })) throw new AppError('Collection slug already exists', 409, 'SLUG_EXISTS');
  const type = req.body.type || 'manual';
  const uploaded = {};
  let collection;
  try {
    for (const file of requestFiles(req)) {
      const result = await uploadBuffer(file);
      uploaded[file.fieldname] = { url: result.secure_url, publicId: result.public_id, alt: req.body.name };
    }
    collection = await Collection.create({
      ...req.body,
      slug,
      type,
      seo: parseJson(req.body.seo, undefined),
      heroImage: uploaded.heroImage,
      mobileImage: uploaded.mobileImage,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    await audit(req, 'create', collection);
    emit('collection:created', { id: collection._id, slug: collection.slug, status: collection.status });
    return ApiResponse.success(res, { statusCode: 201, message: 'Collection created', data: collection });
  } catch (error) {
    if (collection?._id) {
      await Collection.deleteOne({ _id: collection._id });
    }
    await Promise.all(Object.values(uploaded).map((asset) => removeAsset(asset.publicId)));
    throw error;
  }
});

const updateCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findOne({ _id: req.params.collectionId, deletedAt: null });
  if (!collection) throw new AppError('Collection not found', 404, 'COLLECTION_NOT_FOUND');
  if (req.body.slug) {
    const slug = slugify(req.body.slug);
    if (!slug) throw new AppError('Invalid collection slug', 422, 'INVALID_SLUG');
    if (await Collection.exists({ slug, _id: { $ne: collection._id } })) throw new AppError('Collection slug already exists', 409, 'SLUG_EXISTS');
    collection.slug = slug;
  }
  const oldAssets = [];
  const newAssets = [];
  try {
    for (const file of requestFiles(req)) {
      const result = await uploadBuffer(file);
      const asset = { url: result.secure_url, publicId: result.public_id, alt: req.body.name || collection.name };
      newAssets.push(asset);
      if (collection[file.fieldname]?.publicId) oldAssets.push(collection[file.fieldname].publicId);
      collection[file.fieldname] = asset;
    }
    const allowed = [
      'name', 'subtitle', 'description', 'type', 'startsAt', 'endsAt', 'displayOrder', 'presentation',
      'showOnCollectionsScreen', 'showOnHome', 'homeTitle', 'homeDisplayOrder', 'status', 'isFeatured',
    ];
    allowed.forEach((key) => { if (req.body[key] !== undefined) collection[key] = req.body[key]; });
    if (req.body.seo !== undefined) collection.seo = parseJson(req.body.seo);
    collection.updatedBy = req.user.id;
    await collection.save();
    await Promise.all(oldAssets.map(removeAsset));
    await audit(req, 'update', collection);
    emit('collection:updated', { id: collection._id, slug: collection.slug, status: collection.status });
    return ApiResponse.success(res, { message: 'Collection updated', data: collection });
  } catch (error) {
    await Promise.all(newAssets.map((asset) => removeAsset(asset.publicId)));
    throw error;
  }
});

const deleteCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw new AppError('Collection not found', 404, 'COLLECTION_NOT_FOUND');
  await Promise.all([
    Product.updateMany({ collections: collection._id }, { $pull: { collections: collection._id } }),
    Coupon.updateMany({ collectionIds: collection._id }, { $pull: { collectionIds: collection._id } }),
  ]);
  const assetPublicIds = [collection.heroImage?.publicId, collection.mobileImage?.publicId].filter(Boolean);
  await Collection.deleteOne({ _id: collection._id });
  await Promise.all(assetPublicIds.map(removeAsset));
  await audit(req, 'delete', collection);
  emit('collection:deleted', { id: collection._id });
  return ApiResponse.success(res, { message: 'Collection permanently deleted' });
});

module.exports = {
  listCollections,
  getCollection,
  getCollectionScreen,
  getHomeCollections,
  listAllCollections,
  createCollection,
  updateCollection,
  deleteCollection,
};
