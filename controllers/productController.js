const mongoose = require('mongoose');
const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const Collection = require('../models/collectionModel');
const Appointment = require('../models/appointmentModel');
const Cart = require('../models/cartModel');
const Coupon = require('../models/couponModel');
const Order = require('../models/orderModel');
const ReturnRequest = require('../models/returnModel');
const Wishlist = require('../models/wishlistModel');
const AuditLog = require('../models/auditLogModel');
const { cloudinary } = require('../config/cloudinaryConfig');
const { emitToAll } = require('../config/socketConfig');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { applyStatusFilter, countsFromRows, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const { presentProductForCustomer, presentProductsForCustomer } = require('../utils/productPresentationUtils');
const { rankRelatedProducts } = require('../utils/productRecommendationUtils');
const { recordInventoryMovement } = require('../services/inventoryMovementService');

const slugify = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 230);

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const parseList = (value) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) return parseJson(value, []);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
};

const caseInsensitiveList = (value) => parseList(value).map((item) =>
  new RegExp(`^${String(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

const requestFiles = (req) => Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();

const uploadImage = (file) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    {
      folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/products`,
      resource_type: 'image',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    },
    (error, result) => (error ? reject(error) : resolve(result)),
  );
  stream.end(file.buffer);
});

const removeImage = async (publicId) => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); } catch (error) { console.error('Cloudinary cleanup failed', error.message); }
};

const removeVideo = async (publicId) => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }); } catch (error) { console.error('Cloudinary video cleanup failed', error.message); }
};

const emit = (event, payload) => emitToAll(event, payload);

const audit = async (req, action, product, description) => {
  try {
    await AuditLog.create({
      actorType: 'admin', actor: req.user.id, actorModel: 'Admin', action,
      resourceType: 'Product', resourceId: product._id, resourceLabel: product.name,
      description, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.id,
      route: req.originalUrl, method: req.method, statusCode: action === 'create' ? 201 : 200,
    });
  } catch (error) { console.error('Audit log write failed', error.message); }
};

const validateReferences = async ({ category, subcategories = [], collections = [] }) => {
  if (!category || !mongoose.isValidObjectId(category)) throw new AppError('Valid category is required', 422, 'INVALID_CATEGORY');
  const [categoryExists, subcategoryCount, collectionCount] = await Promise.all([
    Category.exists({ _id: category, deletedAt: null }),
    Category.countDocuments({ _id: { $in: subcategories }, deletedAt: null }),
    Collection.countDocuments({ _id: { $in: collections }, deletedAt: null }),
  ]);
  if (!categoryExists) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  if (subcategoryCount !== new Set(subcategories.map(String)).size) throw new AppError('One or more subcategories are invalid', 422, 'INVALID_SUBCATEGORY');
  if (collectionCount !== new Set(collections.map(String)).size) throw new AppError('One or more collections are invalid', 422, 'INVALID_COLLECTION');
};

const buildProductInput = (body) => {
  const result = {};
  const direct = [
    'name', 'sku', 'shortDescription', 'description', 'category', 'brand', 'productType', 'gender',
    'purchaseMode', 'price', 'compareAtPrice', 'costPrice', 'currency', 'taxCode', 'gstRate', 'hsnCode', 'stock',
    'reservedStock', 'trackInventory', 'allowBackorder', 'lowStockThreshold', 'weight', 'weightUnit',
    'careInstructions', 'warranty', 'authenticityDetails', 'status', 'isFeatured', 'isNewArrival', 'publishedAt',
  ];
  direct.forEach((key) => { if (body[key] !== undefined) result[key] = body[key]; });
  for (const key of ['subcategories', 'collections', 'material', 'gemstone', 'color', 'tags']) {
    if (body[key] !== undefined) result[key] = parseList(body[key]);
  }
  for (const key of ['variants', 'dimensions', 'seo']) {
    if (body[key] !== undefined) result[key] = parseJson(body[key]);
  }
  return result;
};

const productProjection = '-costPrice -variants.costPrice';
const hasValidPrice = (value) => value !== undefined && value !== null && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= 0;

const normalizeAppointmentPricing = (input) => {
  if (input.purchaseMode !== 'appointmentOnly') return input;
  delete input.price;
  delete input.compareAtPrice;
  delete input.costPrice;
  if (Array.isArray(input.variants)) {
    input.variants = input.variants.map(({ price, compareAtPrice, costPrice, ...variant }) => variant);
  }
  return input;
};

const resolveCategoryId = async (value) => {
  if (!value) return null;
  if (mongoose.isValidObjectId(value)) return value;
  const slug = slugify(value);
  if (!slug) return null;
  const category = await Category.findOne({ slug, deletedAt: null }).select('_id').lean();
  return category?._id || null;
};

const listProducts = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const filter = { status: 'active', deletedAt: null };
  if (req.query.search) filter.$text = { $search: String(req.query.search).trim().slice(0, 120) };
  if (req.query.category) {
    const categoryId = await resolveCategoryId(req.query.category);
    if (!categoryId) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    filter.$or = [{ category: categoryId }, { subcategories: categoryId }];
  }
  if (req.query.collection && mongoose.isValidObjectId(req.query.collection)) filter.collections = req.query.collection;
  if (req.query.gender) filter.gender = req.query.gender;
  if (req.query.productType) filter.productType = req.query.productType;
  if (req.query.purchaseMode) filter.purchaseMode = req.query.purchaseMode;
  if (req.query.material) filter.material = { $in: caseInsensitiveList(req.query.material) };
  if (req.query.gemstone) filter.gemstone = { $in: caseInsensitiveList(req.query.gemstone) };
  if (req.query.color) filter.color = { $in: caseInsensitiveList(req.query.color) };
  if (req.query.tags) filter.tags = { $all: parseList(req.query.tags) };
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.newArrival === 'true') filter.isNewArrival = true;
  if (req.query.onSale === 'true') {
    filter.compareAtPrice = { $exists: true, $gt: 0 };
    filter.$expr = { $gt: ['$compareAtPrice', '$price'] };
  }
  if (req.query.minPrice || req.query.maxPrice) {
    filter.price = {};
    if (Number.isFinite(Number(req.query.minPrice))) filter.price.$gte = Math.max(0, Number(req.query.minPrice));
    if (Number.isFinite(Number(req.query.maxPrice))) filter.price.$lte = Math.max(0, Number(req.query.maxPrice));
  }
  if (req.query.inStock === 'true') {
    filter.$and = [{ $or: [{ stock: { $gt: 0 } }, { variants: { $elemMatch: { stock: { $gt: 0 }, status: 'active' } } }] }];
  }

  const sortMap = {
    newest: { publishedAt: -1, createdAt: -1 },
    oldest: { publishedAt: 1 },
    priceLow: { price: 1 },
    priceHigh: { price: -1 },
    popular: { salesCount: -1, viewCount: -1 },
    trending: { viewCount: -1, salesCount: -1, createdAt: -1 },
    rating: { averageRating: -1, reviewCount: -1 },
    nameAsc: { name: 1 },
    nameDesc: { name: -1 },
  };
  const sort = req.query.trending === 'true'
    ? sortMap.trending
    : (req.query.search && !req.query.sort ? { score: { $meta: 'textScore' } } : (sortMap[req.query.sort] || sortMap.newest));
  let query = Product.find(filter).select(productProjection);
  if (req.query.search) query = query.select({ score: { $meta: 'textScore' } });

  const [products, total] = await Promise.all([
    query.populate('category', 'name slug').populate('collections', 'name slug')
      .sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return ApiResponse.success(res, { data: presentProductsForCustomer(products), meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getProduct = asyncHandler(async (req, res) => {
  const value = req.params.identifier;
  const identity = mongoose.isValidObjectId(value) ? { _id: value } : { slug: String(value).toLowerCase() };
  const product = await Product.findOneAndUpdate(
    { ...identity, status: 'active', deletedAt: null },
    { $inc: { viewCount: 1 } },
    { new: true },
  ).select(productProjection).populate('category', 'name slug').populate('subcategories', 'name slug')
    .populate('collections', 'name slug').lean();
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  return ApiResponse.success(res, { data: presentProductForCustomer(product) });
});

const getRelatedProducts = asyncHandler(async (req, res) => {
  const value = req.params.identifier;
  const identity = mongoose.isValidObjectId(value) ? { _id: value } : { slug: String(value).toLowerCase() };
  const source = await Product.findOne({ ...identity, status: 'active', deletedAt: null })
    .select('category subcategories collections productType purchaseMode gender material gemstone color tags')
    .lean();
  if (!source) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const requestedLimit = Number(req.query.limit);
  const limit = Math.min(12, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 6));
  const baseFilter = {
    _id: { $ne: source._id },
    status: 'active',
    deletedAt: null,
  };
  const relationFilters = [
    { category: source.category },
    { subcategories: source.category },
    ...(source.subcategories?.length
      ? [{ category: { $in: source.subcategories } }, { subcategories: { $in: source.subcategories } }]
      : []),
    ...(source.collections?.length ? [{ collections: { $in: source.collections } }] : []),
    ...(source.material?.length ? [{ material: { $in: source.material } }] : []),
    ...(source.gemstone?.length ? [{ gemstone: { $in: source.gemstone } }] : []),
    ...(source.tags?.length ? [{ tags: { $in: source.tags } }] : []),
  ];

  const candidates = await Product.find({ ...baseFilter, $or: relationFilters })
    .select(productProjection)
    .sort({ salesCount: -1, averageRating: -1, viewCount: -1, createdAt: -1 })
    .limit(Math.min(100, Math.max(32, limit * 8)))
    .lean();
  let related = rankRelatedProducts(source, candidates, limit);

  if (related.length < limit) {
    const excludedIds = [source._id, ...related.map((product) => product._id)];
    const fallback = await Product.find({
      ...baseFilter,
      _id: { $nin: excludedIds },
    })
      .select(productProjection)
      .sort({ salesCount: -1, averageRating: -1, viewCount: -1, createdAt: -1 })
      .limit(limit - related.length)
      .lean();
    related = [...related, ...fallback];
  }

  await Product.populate(related, [
    { path: 'category', select: 'name slug' },
    { path: 'collections', select: 'name slug' },
  ]);
  return ApiResponse.success(res, { data: presentProductsForCustomer(related) });
});

const curatedProducts = (filter, defaultLimit = 12, sort = { createdAt: -1 }) => asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || defaultLimit));
  const products = await Product.find({ status: 'active', deletedAt: null, ...filter })
    .select(productProjection).populate('category', 'name slug').sort(sort).limit(limit).lean();
  return ApiResponse.success(res, { data: presentProductsForCustomer(products) });
});

const getFeaturedProducts = curatedProducts({ isFeatured: true });
const getNewArrivals = curatedProducts({ isNewArrival: true }, 12, { publishedAt: -1, createdAt: -1 });
const getBestSellers = curatedProducts({}, 12, { salesCount: -1, createdAt: -1 });
const getTrendingProducts = curatedProducts({}, 12, { viewCount: -1, salesCount: -1, createdAt: -1 });
const getOnSaleProducts = curatedProducts({ compareAtPrice: { $exists: true, $gt: 0 }, $expr: { $gt: ['$compareAtPrice', '$price'] } }, 12, { createdAt: -1 });

const listAllProducts = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = { deletedAt: null };
  if (req.query.category) baseFilter.category = req.query.category;
  if (req.query.purchaseMode) baseFilter.purchaseMode = req.query.purchaseMode;
  if (req.query.search) baseFilter.$text = { $search: String(req.query.search).slice(0, 120) };
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [products, total, summary] = await Promise.all([
    Product.find(filter).populate('category', 'name slug').populate('subcategories', 'name slug')
      .populate('collections', 'name slug type status').sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
    summarizeStatusFields(Product, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: products,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const listBrandsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {
    deletedAt: null,
    brand: { $type: 'string', $ne: '' },
  };
  if (req.query.search) {
    const escaped = String(req.query.search).trim().slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) baseFilter.brand = { ...baseFilter.brand, $regex: escaped, $options: 'i' };
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);

  const brandGroup = {
    _id: '$brand',
    productCount: { $sum: 1 },
    activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
    draftProducts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
    inactiveProducts: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
    archivedProducts: { $sum: { $cond: [{ $eq: ['$status', 'archived'] }, 1, 0] } },
  };

  const [brandResult = {}, summaryResult = {}] = await Promise.all([
    Product.aggregate([
      { $match: filter },
      { $group: brandGroup },
      { $sort: { _id: 1 } },
      {
        $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]).then(([result = {}]) => result),
    Product.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$brand', statuses: { $addToSet: '$status' } } },
      {
        $facet: {
          total: [{ $count: 'count' }],
          statusCounts: [
            { $unwind: '$statuses' },
            { $group: { _id: '$statuses', count: { $sum: 1 } } },
          ],
        },
      },
    ]).then(([result = {}]) => result),
  ]);

  const rows = (brandResult.rows || []).map((brand) => ({
    id: brand._id,
    name: brand._id,
    productCount: brand.productCount,
    activeProducts: brand.activeProducts,
    draftProducts: brand.draftProducts,
    inactiveProducts: brand.inactiveProducts,
    archivedProducts: brand.archivedProducts,
  }));
  const total = Number(brandResult.total?.[0]?.count) || 0;
  const summary = {
    total: Number(summaryResult.total?.[0]?.count) || 0,
    statusCounts: countsFromRows(summaryResult.statusCounts),
  };
  return ApiResponse.success(res, {
    data: rows,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getProductAdmin = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.productId, deletedAt: null })
    .populate('category', 'name slug').populate('subcategories', 'name slug')
    .populate('collections', 'name slug type status');
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  return ApiResponse.success(res, { data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  const input = normalizeAppointmentPricing(buildProductInput(req.body));
  for (const key of ['name', 'sku', 'description', 'category', 'productType']) {
    if (input[key] === undefined || input[key] === '') throw new AppError(`${key} is required`, 422, 'VALIDATION_ERROR');
  }
  if (input.purchaseMode !== 'appointmentOnly' && !hasValidPrice(input.price)) {
    throw new AppError('price is required', 422, 'VALIDATION_ERROR');
  }
  input.slug = slugify(req.body.slug || input.name);
  if (!input.slug) throw new AppError('A valid product slug is required', 422, 'INVALID_SLUG');
  if (await Product.exists({ $or: [{ slug: input.slug }, { sku: String(input.sku).toUpperCase() }] })) {
    throw new AppError('Product slug or SKU already exists', 409, 'PRODUCT_EXISTS');
  }
  await validateReferences(input);
  const uploadedImages = [];
  let product;
  try {
    const altTexts = parseList(req.body.imageAltTexts) || [];
    let position = 0;
    for (const file of requestFiles(req)) {
      const result = await uploadImage(file);
      uploadedImages.push({
        url: result.secure_url, publicId: result.public_id,
        alt: altTexts[position] || input.name, position, isPrimary: position === 0,
      });
      position += 1;
    }
    product = await Product.create({
      ...input, images: uploadedImages, createdBy: req.user.id, updatedBy: req.user.id,
      publishedAt: input.status === 'active' ? (input.publishedAt || new Date()) : input.publishedAt,
    });
    await audit(req, 'create', product, 'Product created');
    if (Number(product.stock || 0) > 0) {
      await recordInventoryMovement({
        product,
        type: 'initial',
        source: 'productEdit',
        quantityBefore: 0,
        quantityAfter: Number(product.stock || 0),
        reservedBefore: 0,
        reservedAfter: Number(product.reservedStock || 0),
        reason: 'Initial product stock',
        actor: req.user.id,
        reference: { model: 'Product', id: product._id, label: product.sku },
      });
    }
    emit('product:created', { id: product._id, slug: product.slug, status: product.status, stock: product.stock });
    return ApiResponse.success(res, { statusCode: 201, message: 'Product created', data: product });
  } catch (error) {
    if (product?._id) {
      await Product.deleteOne({ _id: product._id });
    }
    await Promise.all(uploadedImages.map((image) => removeImage(image.publicId)));
    throw error;
  }
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.productId, deletedAt: null });
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  const input = buildProductInput(req.body);
  const nextPurchaseMode = input.purchaseMode || product.purchaseMode;
  if (nextPurchaseMode === 'appointmentOnly') normalizeAppointmentPricing(input);
  else if (!hasValidPrice(input.price !== undefined ? input.price : product.price)) {
    throw new AppError('price is required for products sold online', 422, 'VALIDATION_ERROR');
  }
  const previousStock = Number(product.stock || 0);
  const previousReserved = Number(product.reservedStock || 0);
  if (req.body.slug) {
    const slug = slugify(req.body.slug);
    if (!slug) throw new AppError('Invalid product slug', 422, 'INVALID_SLUG');
    if (await Product.exists({ slug, _id: { $ne: product._id } })) throw new AppError('Product slug already exists', 409, 'SLUG_EXISTS');
    input.slug = slug;
  }
  if (input.sku && await Product.exists({ sku: String(input.sku).toUpperCase(), _id: { $ne: product._id } })) {
    throw new AppError('Product SKU already exists', 409, 'SKU_EXISTS');
  }
  await validateReferences({
    category: input.category || product.category,
    subcategories: input.subcategories || product.subcategories,
    collections: input.collections || product.collections,
  });

  const uploadedImages = [];
  try {
    const altTexts = parseList(req.body.imageAltTexts) || [];
    let position = product.images.length;
    for (const file of requestFiles(req)) {
      const result = await uploadImage(file);
      uploadedImages.push({
        url: result.secure_url, publicId: result.public_id, alt: altTexts[uploadedImages.length] || input.name || product.name,
        position, isPrimary: product.images.length === 0 && uploadedImages.length === 0,
      });
      position += 1;
    }
    Object.assign(product, input);
    if (nextPurchaseMode === 'appointmentOnly') {
      product.price = undefined;
      product.compareAtPrice = undefined;
      product.costPrice = undefined;
    }
    product.images.push(...uploadedImages);
    if (input.status === 'active' && !product.publishedAt) product.publishedAt = new Date();
    product.updatedBy = req.user.id;
    await product.save();
    await audit(req, 'update', product, 'Product updated');
    if (input.stock !== undefined && Number(product.stock || 0) !== previousStock) {
      await recordInventoryMovement({
        product,
        type: 'correction',
        source: 'productEdit',
        quantityBefore: previousStock,
        quantityAfter: Number(product.stock || 0),
        reservedBefore: previousReserved,
        reservedAfter: Number(product.reservedStock || 0),
        reason: 'Product editor stock update',
        actor: req.user.id,
        reference: { model: 'Product', id: product._id, label: product.sku },
      });
    }
    emit('product:updated', { id: product._id, slug: product.slug, status: product.status, stock: product.stock });
    return ApiResponse.success(res, { message: 'Product updated', data: product });
  } catch (error) {
    await Promise.all(uploadedImages.map((image) => removeImage(image.publicId)));
    throw error;
  }
});

const removeProductImage = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.productId, deletedAt: null });
  const image = product?.images.id(req.params.imageId);
  if (!product || !image) throw new AppError('Product image not found', 404, 'IMAGE_NOT_FOUND');
  const publicId = image.publicId;
  const wasPrimary = image.isPrimary;
  image.deleteOne();
  if (wasPrimary && product.images.length) product.images[0].isPrimary = true;
  product.images.forEach((item, index) => { item.position = index; });
  product.updatedBy = req.user.id;
  await product.save();
  await removeImage(publicId);
  await audit(req, 'update', product, 'Product image removed');
  emit('product:updated', { id: product._id, imagesChanged: true });
  return ApiResponse.success(res, { message: 'Product image removed', data: product.images });
});

const setPrimaryImage = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.productId, deletedAt: null });
  const image = product?.images.id(req.params.imageId);
  if (!product || !image) throw new AppError('Product image not found', 404, 'IMAGE_NOT_FOUND');
  product.images.forEach((item) => { item.isPrimary = String(item._id) === String(image._id); });
  product.updatedBy = req.user.id;
  await product.save();
  await audit(req, 'update', product, 'Product primary image changed');
  emit('product:updated', { id: product._id, imagesChanged: true });
  return ApiResponse.success(res, { message: 'Primary image updated', data: product.images });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

  const [hasOrders, hasReturns, hasAppointments] = await Promise.all([
    Order.exists({ 'items.product': product._id }),
    ReturnRequest.exists({ 'items.product': product._id }),
    Appointment.exists({
      $or: [
        { productIds: product._id },
        { 'outcome.interestedProductIds': product._id },
      ],
    }),
  ]);
  if (hasOrders || hasReturns || hasAppointments) {
    throw new AppError(
      'Product has order, return, or appointment history and cannot be permanently deleted',
      409,
      'PRODUCT_IN_USE',
    );
  }

  const carts = await Cart.find({ 'items.product': product._id });
  await Promise.all(carts.map(async (cart) => {
    cart.items = cart.items.filter((item) => String(item.product) !== String(product._id));
    cart.coupon = null;
    cart.couponCode = null;
    cart.discount = 0;
    await cart.save();
  }));
  await Promise.all([
    Wishlist.updateMany({ 'items.product': product._id }, { $pull: { items: { product: product._id } } }),
    Coupon.updateMany(
      { $or: [{ productIds: product._id }, { excludedProductIds: product._id }] },
      { $pull: { productIds: product._id, excludedProductIds: product._id } },
    ),
  ]);

  const imagePublicIds = [
    ...(product.images || []).map((image) => image.publicId),
    ...(product.variants || []).map((variant) => variant.image?.publicId),
  ].filter(Boolean);
  const deleteResult = await Product.deleteOne({ _id: product._id });
  if (deleteResult.deletedCount !== 1) {
    throw new AppError('Product deletion was not acknowledged by the database', 500, 'PRODUCT_DELETE_FAILED');
  }
  await Promise.all(imagePublicIds.map(removeImage));
  await removeVideo(product.video?.publicId);
  await audit(req, 'delete', product, 'Product permanently deleted');
  emit('product:deleted', { id: product._id });
  return ApiResponse.success(res, {
    message: 'Product permanently deleted',
    data: { deletedId: product._id },
  });
});

module.exports = {
  listProducts, getProduct, getRelatedProducts, getFeaturedProducts, getNewArrivals, getBestSellers,
  getTrendingProducts, getOnSaleProducts,
  listAllProducts, listBrandsAdmin, getProductAdmin, createProduct, updateProduct, removeProductImage,
  setPrimaryImage, deleteProduct,
};
