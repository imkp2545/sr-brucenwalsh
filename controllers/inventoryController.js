const mongoose = require('mongoose');
const Product = require('../models/productModel');
const InventoryMovement = require('../models/inventoryMovementModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { emitToRoles } = require('../config/socketConfig');
const { recordInventoryMovement, stockSnapshot } = require('../services/inventoryMovementService');

const adjustmentTypes = ['add', 'remove', 'set', 'correction', 'damaged', 'restock'];
const stockStates = ['healthy', 'low', 'out'];

const availableFor = (stock, reserved) => Math.max(0, Number(stock || 0) - Number(reserved || 0));
const stateFor = (stock, reserved, threshold) => {
  const available = availableFor(stock, reserved);
  if (available <= 0) return 'out';
  if (available <= Number(threshold || 0)) return 'low';
  return 'healthy';
};

const variantLabel = (variant) =>
  variant?.name || variant?.attributes?.map((item) => `${item.name}: ${item.value}`).join(', ') || 'Variant';

const flattenProduct = (product) => {
  const category = product.category ? { _id: product.category._id, name: product.category.name, slug: product.category.slug } : null;
  const baseRow = {
    id: `${product._id}:base`,
    productId: product._id,
    variantId: null,
    variantName: null,
    isVariant: false,
    name: product.name,
    sku: product.sku,
    category,
    image: product.images?.find((image) => image.isPrimary)?.url || product.images?.[0]?.url,
    price: product.price,
    stock: Number(product.stock || 0),
    reservedStock: Number(product.reservedStock || 0),
    availableStock: availableFor(product.stock, product.reservedStock),
    lowStockThreshold: Number(product.lowStockThreshold || 0),
    stockState: stateFor(product.stock, product.reservedStock, product.lowStockThreshold),
    trackInventory: product.trackInventory,
    allowBackorder: product.allowBackorder,
    status: product.status,
    updatedAt: product.updatedAt,
  };
  const variantRows = (product.variants || []).map((variant) => ({
    id: `${product._id}:${variant._id}`,
    productId: product._id,
    variantId: variant._id,
    variantName: variantLabel(variant),
    isVariant: true,
    name: product.name,
    sku: variant.sku,
    category,
    image: variant.image?.url || baseRow.image,
    price: variant.price,
    stock: Number(variant.stock || 0),
    reservedStock: Number(variant.reservedStock || 0),
    availableStock: availableFor(variant.stock, variant.reservedStock),
    lowStockThreshold: Number(variant.lowStockThreshold || 0),
    stockState: stateFor(variant.stock, variant.reservedStock, variant.lowStockThreshold),
    trackInventory: product.trackInventory,
    allowBackorder: product.allowBackorder,
    status: variant.status || product.status,
    productStatus: product.status,
    updatedAt: product.updatedAt,
  }));
  return [baseRow, ...variantRows];
};

const productFilterFrom = (query) => {
  const filter = { deletedAt: null };
  if (query.status) filter.status = query.status;
  if (query.category && mongoose.isValidObjectId(query.category)) filter.category = query.category;
  return filter;
};

const normalized = (value) => String(value || '').toLowerCase().trim();
const rowMatchesSearch = (row, search) => {
  const terms = normalized(search).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalized([
    row.name,
    row.sku,
    row.variantName,
    row.category?.name,
    row.status,
    row.stockState,
  ].filter(Boolean).join(' '));
  return terms.every((term) => haystack.includes(term));
};

const buildSummary = (rows) => {
  const summary = rows.reduce((result, row) => {
    result.totalSkus += 1;
    result.physicalUnits += row.stock;
    result.reservedUnits += row.reservedStock;
    result.availableUnits += row.availableStock;
    result.stockValue += row.availableStock * Number(row.price || 0);
    result.stockStateCounts[row.stockState] += 1;
    if (row.stockState === 'low') result.lowStockSkus += 1;
    if (row.stockState === 'out') result.outOfStockSkus += 1;
    return result;
  }, {
    totalSkus: 0,
    physicalUnits: 0,
    reservedUnits: 0,
    availableUnits: 0,
    lowStockSkus: 0,
    outOfStockSkus: 0,
    stockValue: 0,
    stockStateCounts: { healthy: 0, low: 0, out: 0 },
  });
  return { ...summary, total: summary.totalSkus };
};

const listInventory = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const stockState = stockStates.includes(req.query.stockState) ? req.query.stockState : '';
  const products = await Product.find(productFilterFrom(req.query))
    .populate('category', 'name slug')
    .sort({ updatedAt: -1 })
    .lean();
  const allRows = products
    .flatMap(flattenProduct)
    .filter((row) => rowMatchesSearch(row, req.query.search));
  const rows = allRows.filter((row) => !stockState || row.stockState === stockState);
  const total = rows.length;
  const pagedRows = rows.slice((page - 1) * limit, page * limit);
  return ApiResponse.success(res, {
    data: pagedRows,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary: buildSummary(allRows) },
  });
});

const listMovements = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = {};
  if (req.query.productId) {
    if (!mongoose.isValidObjectId(req.query.productId)) throw new AppError('Invalid product ID', 422, 'INVALID_PRODUCT');
    filter.product = req.query.productId;
  }
  if (req.query.variantId) {
    if (!mongoose.isValidObjectId(req.query.variantId)) throw new AppError('Invalid variant ID', 422, 'INVALID_VARIANT');
    filter.variantId = req.query.variantId;
  } else if (req.query.productId && req.query.baseOnly === 'true') {
    filter.variantId = null;
  }
  if (req.query.type) filter.type = req.query.type;
  if (req.query.source) filter.source = req.query.source;
  if (req.query.search) filter.$text = { $search: String(req.query.search).slice(0, 100) };

  const [movements, total] = await Promise.all([
    InventoryMovement.find(filter)
      .populate('actor', 'firstName lastName role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryMovement.countDocuments(filter),
  ]);
  return ApiResponse.success(res, { data: movements, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const calculateNextStock = ({ type, currentStock, quantity }) => {
  if (type === 'add' || type === 'restock') return currentStock + quantity;
  if (type === 'remove' || type === 'damaged') return currentStock - quantity;
  return quantity;
};

const adjustInventory = asyncHandler(async (req, res) => {
  const { productId, variantId, type, reason, note } = req.body;
  if (!mongoose.isValidObjectId(productId)) throw new AppError('Valid product ID is required', 422, 'INVALID_PRODUCT');
  if (variantId && !mongoose.isValidObjectId(variantId)) throw new AppError('Valid variant ID is required', 422, 'INVALID_VARIANT');
  if (!adjustmentTypes.includes(type)) throw new AppError('Invalid inventory adjustment type', 422, 'INVALID_ADJUSTMENT_TYPE');
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || (type !== 'set' && type !== 'correction' && quantity < 1)) {
    throw new AppError('Enter a valid stock quantity', 422, 'INVALID_QUANTITY');
  }
  if (!String(reason || '').trim()) throw new AppError('Adjustment reason is required', 422, 'REASON_REQUIRED');

  const session = await mongoose.startSession();
  let updatedProduct;
  let movement;
  try {
    await session.withTransaction(async () => {
      const product = await Product.findOne({ _id: productId, deletedAt: null }).session(session);
      if (!product) throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
      const snapshot = stockSnapshot(product, variantId || null);
      if (variantId && !snapshot.variantId) throw new AppError('Product variant not found', 404, 'VARIANT_NOT_FOUND');

      const before = snapshot.stock;
      const reserved = snapshot.reservedStock;
      const after = calculateNextStock({ type, currentStock: before, quantity });
      if (after < 0) throw new AppError('Stock cannot go below zero', 422, 'NEGATIVE_STOCK');
      if (after < reserved) throw new AppError('Physical stock cannot be lower than reserved stock', 409, 'RESERVED_STOCK_CONFLICT');

      if (variantId) {
        await Product.updateOne(
          { _id: product._id },
          { $set: { 'variants.$[variant].stock': after, updatedBy: req.user.id } },
          { session, arrayFilters: [{ 'variant._id': variantId }] },
        );
      } else {
        product.stock = after;
        product.updatedBy = req.user.id;
        await product.save({ session, validateBeforeSave: false });
      }

      updatedProduct = await Product.findById(product._id).session(session);
      movement = await recordInventoryMovement({
        product: updatedProduct,
        variantId: variantId || null,
        type,
        source: 'manual',
        quantityBefore: before,
        quantityAfter: after,
        reservedBefore: reserved,
        reservedAfter: reserved,
        reason: String(reason).trim(),
        note,
        actor: req.user.id,
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  emitToRoles(['superAdmin', 'admin', 'catalogManager', 'orderManager'], 'inventory:updated', {
    productId: updatedProduct._id,
    variantId: movement.variantId,
    sku: movement.sku,
    quantityAfter: movement.quantityAfter,
    delta: movement.delta,
  });
  return ApiResponse.success(res, { message: 'Inventory adjusted', data: movement });
});

module.exports = { listInventory, listMovements, adjustInventory };
