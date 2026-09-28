const Category = require('../models/categoryModel');
const Collection = require('../models/collectionModel');
const Product = require('../models/productModel');
const Coupon = require('../models/couponModel');
const AuditLog = require('../models/auditLogModel');
const { cloudinary } = require('../config/cloudinaryConfig');
const { emitToAll } = require('../config/socketConfig');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { buildCategoryMenuSections } = require('../utils/categoryMenuUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const slugify = (value) => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);

const parseJson = (value) => {
  if (value === undefined || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const requestFiles = (req) => Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();

const uploadBuffer = (file, folder) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder, resource_type: 'image', use_filename: false, unique_filename: true },
    (error, result) => (error ? reject(error) : resolve(result)),
  );
  stream.end(file.buffer);
});

const removeAsset = async (publicId) => {
  if (!publicId) return;
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); } catch (error) {
    console.error('Cloudinary cleanup failed', error.message);
  }
};

const emit = (event, payload) => {
  emitToAll(event, payload);
};

const audit = async (req, action, category, description) => {
  try {
    await AuditLog.create({
      actorType: 'admin', actor: req.user.id, actorModel: 'Admin', action,
      resourceType: 'Category', resourceId: category._id, resourceLabel: category.name,
      description, ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: req.id,
      route: req.originalUrl, method: req.method, statusCode: action === 'create' ? 201 : 200,
    });
  } catch (error) { console.error('Audit log write failed', error.message); }
};

const ensureParent = async (parentId, currentId) => {
  if (!parentId) return null;
  if (currentId && String(parentId) === String(currentId)) throw new AppError('Category cannot be its own parent', 422, 'INVALID_PARENT');
  const parent = await Category.findOne({ _id: parentId, deletedAt: null });
  if (!parent) throw new AppError('Parent category not found', 404, 'PARENT_CATEGORY_NOT_FOUND');

  let ancestor = parent;
  const visited = new Set();
  while (ancestor?.parent) {
    if (currentId && String(ancestor.parent) === String(currentId)) throw new AppError('Category hierarchy cannot contain a cycle', 422, 'CATEGORY_CYCLE');
    if (visited.has(String(ancestor.parent))) throw new AppError('Existing category hierarchy contains a cycle', 409, 'CATEGORY_CYCLE');
    visited.add(String(ancestor.parent));
    ancestor = await Category.findById(ancestor.parent).select('parent');
  }
  return parent._id;
};

const listCategories = asyncHandler(async (req, res) => {
  const filter = { status: 'active', deletedAt: null };
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.parent === 'root') filter.parent = null;
  else if (req.query.parent) filter.parent = req.query.parent;
  const categories = await Category.find(filter).sort({ displayOrder: 1, name: 1 }).lean();
  return ApiResponse.success(res, { data: categories });
});

const getCategory = asyncHandler(async (req, res) => {
  const value = req.params.identifier;
  const filter = /^[a-f\d]{24}$/i.test(value) ? { _id: value } : { slug: value.toLowerCase() };
  const category = await Category.findOne({ ...filter, status: 'active', deletedAt: null }).lean();
  if (!category) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  return ApiResponse.success(res, { data: category });
});

const getCategoryMenu = asyncHandler(async (_req, res) => {
  const [categories, collections] = await Promise.all([
    Category.find({ status: 'active', deletedAt: null, showInMenu: { $ne: false } })
      .select('_id name slug image icon displayOrder menuSection menuLabel menuFilterType menuFilterValue')
      .sort({ menuSection: 1, displayOrder: 1, name: 1 })
      .lean(),
    Collection.find({ status: 'active', deletedAt: null, showOnCollectionsScreen: true })
      .select('_id name slug heroImage mobileImage displayOrder')
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
  ]);

  return ApiResponse.success(res, {
    data: { sections: buildCategoryMenuSections(categories, collections) },
  });
});

const listAllCategories = asyncHandler(async (req, res) => {
  const baseFilter = { deletedAt: null };
  if (req.query.parent === 'root') baseFilter.parent = null;
  else if (req.query.parent) baseFilter.parent = req.query.parent;
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const [categories, summary] = await Promise.all([
    Category.find(filter).populate('parent', 'name slug').sort({ displayOrder: 1, name: 1 }),
    summarizeStatusFields(Category, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: categories,
    meta: { total: categories.length, summary },
  });
});

const createCategory = asyncHandler(async (req, res) => {
  const {
    name, description, parent, seo, displayOrder, status, isFeatured,
    showInMenu, menuSection, menuLabel, menuFilterType, menuFilterValue,
  } = req.body;
  if (!name) throw new AppError('Category name is required', 422, 'VALIDATION_ERROR');
  const slug = slugify(req.body.slug || name);
  if (!slug) throw new AppError('A valid category slug is required', 422, 'INVALID_SLUG');
  if (await Category.exists({ slug })) throw new AppError('Category slug already exists', 409, 'SLUG_EXISTS');
  const parentId = await ensureParent(parent);
  const uploaded = {};

  try {
    for (const file of requestFiles(req)) {
      const result = await uploadBuffer(file, `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/categories`);
      uploaded[file.fieldname] = { url: result.secure_url, publicId: result.public_id, alt: name };
    }
    const category = await Category.create({
      name, slug, description, parent: parentId, seo: parseJson(seo), displayOrder, status, isFeatured,
      showInMenu, menuSection, menuLabel, menuFilterType, menuFilterValue,
      image: uploaded.image, icon: uploaded.icon, createdBy: req.user.id, updatedBy: req.user.id,
    });
    await audit(req, 'create', category, 'Category created');
    emit('category:created', { id: category._id, slug: category.slug, status: category.status });
    return ApiResponse.success(res, { statusCode: 201, message: 'Category created', data: category });
  } catch (error) {
    await Promise.all(Object.values(uploaded).map((asset) => removeAsset(asset.publicId)));
    throw error;
  }
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ _id: req.params.categoryId, deletedAt: null });
  if (!category) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  if (req.body.slug) {
    const slug = slugify(req.body.slug);
    if (!slug) throw new AppError('Invalid category slug', 422, 'INVALID_SLUG');
    if (await Category.exists({ slug, _id: { $ne: category._id } })) throw new AppError('Category slug already exists', 409, 'SLUG_EXISTS');
    category.slug = slug;
  }
  if (req.body.parent !== undefined) category.parent = await ensureParent(req.body.parent, category._id);

  const oldAssets = [];
  const newAssets = [];
  try {
    for (const file of requestFiles(req)) {
      const result = await uploadBuffer(file, `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/categories`);
      const asset = { url: result.secure_url, publicId: result.public_id, alt: req.body.name || category.name };
      newAssets.push(asset);
      if (category[file.fieldname]?.publicId) oldAssets.push(category[file.fieldname].publicId);
      category[file.fieldname] = asset;
    }
    for (const field of [
      'name', 'description', 'seo', 'displayOrder', 'status', 'isFeatured',
      'showInMenu', 'menuSection', 'menuLabel', 'menuFilterType', 'menuFilterValue',
    ]) {
      if (req.body[field] !== undefined) category[field] = field === 'seo' ? parseJson(req.body[field]) : req.body[field];
    }
    category.updatedBy = req.user.id;
    await category.save();
    await Promise.all(oldAssets.map(removeAsset));
    await audit(req, 'update', category, 'Category updated');
    emit('category:updated', { id: category._id, slug: category.slug, status: category.status });
    return ApiResponse.success(res, { message: 'Category updated', data: category });
  } catch (error) {
    await Promise.all(newAssets.map((asset) => removeAsset(asset.publicId)));
    throw error;
  }
});

const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.categoryId);
  if (!category) throw new AppError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  const [hasChildren, hasProducts] = await Promise.all([
    Category.exists({ parent: category._id }),
    Product.exists({ $or: [{ category: category._id }, { subcategories: category._id }] }),
  ]);
  if (hasChildren || hasProducts) throw new AppError('Category is in use and cannot be deleted', 409, 'CATEGORY_IN_USE');

  const assetPublicIds = [category.image?.publicId, category.icon?.publicId].filter(Boolean);
  await Coupon.updateMany({ categoryIds: category._id }, { $pull: { categoryIds: category._id } });
  await Category.deleteOne({ _id: category._id });
  await Promise.all(assetPublicIds.map(removeAsset));
  await audit(req, 'delete', category, 'Category permanently deleted');
  emit('category:deleted', { id: category._id });
  return ApiResponse.success(res, { message: 'Category permanently deleted' });
});

module.exports = { listCategories, getCategory, getCategoryMenu, listAllCategories, createCategory, updateCategory, deleteCategory };
