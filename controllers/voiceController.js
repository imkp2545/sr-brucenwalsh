const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const AppError = require('../utils/appError');
const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const { presentProductForCustomer, presentProductsForCustomer } = require('../utils/productPresentationUtils');
const { interpretVoiceRequest, normalizeVoiceText } = require('../services/voiceIntentService');

const GREETING = 'Welcome to the world of luxury yet affordable jewellery.';
const productProjection = '-costPrice -variants.costPrice';

const productIdentity = (identifier) => {
  if (!identifier) return null;
  return mongoose.isValidObjectId(identifier)
    ? { _id: identifier }
    : { slug: String(identifier).trim().toLowerCase() };
};

const findProduct = async (identifier) => {
  const identity = productIdentity(identifier);
  if (!identity) return null;
  return Product.findOne({ ...identity, status: 'active', deletedAt: null })
    .select(productProjection)
    .populate('category', 'name slug')
    .lean();
};

const productPrice = (product) => {
  if (!product) return null;
  const prices = [product.price, ...(product.variants || []).map((variant) => variant.price)]
    .map(Number)
    .filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
};

const currency = (value) => Number(value).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});

const activeFilterKeys = [
  'q', 'category', 'gender', 'tags', 'purchaseMode', 'material', 'gemstone', 'color',
  'minPrice', 'maxPrice', 'onSale', 'inStock',
];

const hasFilterValue = (value) => value !== null && value !== undefined && value !== '' && value !== false;
const titleCase = (value) => String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());

const catalogAcknowledgement = (filters = {}, previous = {}) => {
  const hadFilters = activeFilterKeys.some((key) => hasFilterValue(previous[key]));
  const hasFilters = activeFilterKeys.some((key) => hasFilterValue(filters[key]));
  if (hadFilters && !hasFilters) return 'Filters cleared.';
  if (
    (hasFilterValue(previous.minPrice) || hasFilterValue(previous.maxPrice))
    && !hasFilterValue(filters.minPrice)
    && !hasFilterValue(filters.maxPrice)
  ) return 'Price filter removed.';
  if (filters.category && filters.category !== previous.category) {
    return `Showing ${filters.category}.`;
  }
  if (hasFilterValue(filters.maxPrice) && filters.maxPrice !== previous.maxPrice) {
    return `Showing products under ${currency(filters.maxPrice)}.`;
  }
  if (filters.material && filters.material !== previous.material) {
    return `${titleCase(filters.material)} filter applied.`;
  }
  if (filters.gemstone && filters.gemstone !== previous.gemstone) {
    return `${titleCase(filters.gemstone)} filter applied.`;
  }
  if (filters.color && filters.color !== previous.color) {
    return `${titleCase(filters.color)} filter applied.`;
  }
  return 'Filters updated.';
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findProducts = async (filters = {}) => {
  const query = { status: 'active', deletedAt: null };
  const searchParts = [filters.q].filter(Boolean).map(escapeRegex);
  if (searchParts.length) {
    const expression = new RegExp(searchParts.join('|'), 'i');
    query.$or = [
      { name: expression }, { shortDescription: expression }, { description: expression },
      { tags: expression }, { material: expression }, { gemstone: expression },
    ];
  }
  if (filters.category) {
    const categoryValue = String(filters.category).trim();
    const category = await Category.findOne({
      deletedAt: null,
      $or: [
        { slug: categoryValue.toLowerCase() },
        { name: new RegExp(`^${escapeRegex(categoryValue)}$`, 'i') },
      ],
    }).select('_id').lean();
    if (!category) return [];
    const categoryMatch = [{ category: category._id }, { subcategories: category._id }];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: categoryMatch }];
      delete query.$or;
    } else query.$or = categoryMatch;
  }
  if (filters.material) query.material = { $in: [new RegExp(escapeRegex(filters.material), 'i')] };
  if (filters.gemstone) query.gemstone = { $in: [new RegExp(escapeRegex(filters.gemstone), 'i')] };
  if (filters.color) query.color = { $in: [new RegExp(escapeRegex(filters.color), 'i')] };
  if (filters.gender) query.gender = filters.gender;
  if (filters.purchaseMode) query.purchaseMode = filters.purchaseMode;
  if (filters.tags) query.tags = { $all: String(filters.tags).split(',').map((tag) => new RegExp(`^${escapeRegex(tag.trim())}$`, 'i')) };
  if (Number.isFinite(filters.maxPrice)) query.price = { $lte: filters.maxPrice };
  if (Number.isFinite(filters.minPrice)) query.price = { ...(query.price || {}), $gte: filters.minPrice };
  if (filters.onSale) {
    query.compareAtPrice = { $exists: true, $gt: 0 };
    query.$expr = { $gt: ['$compareAtPrice', '$price'] };
  }
  if (filters.inStock) {
    query.$and = [{ $or: [
      { stock: { $gt: 0 } },
      { variants: { $elemMatch: { stock: { $gt: 0 }, status: 'active' } } },
    ] }];
  }
  const sortMap = {
    priceLow: { price: 1 }, priceHigh: { price: -1 },
    popular: { salesCount: -1, viewCount: -1 }, rating: { averageRating: -1, reviewCount: -1 },
    trending: { viewCount: -1, salesCount: -1 }, newest: { publishedAt: -1, createdAt: -1 },
  };
  return Product.find(query)
    .select(productProjection)
    .populate('category', 'name slug')
    .sort(sortMap[filters.sort] || sortMap.newest)
    .limit(12)
    .lean();
};

const catalogParams = (filters = {}) => {
  const allowed = [
    'q', 'category', 'gender', 'tags', 'purchaseMode', 'material', 'gemstone', 'color',
    'minPrice', 'maxPrice', 'sort', 'onSale', 'inStock',
  ];
  return Object.fromEntries(allowed
    .filter((key) => filters[key] !== null && filters[key] !== undefined && filters[key] !== false && filters[key] !== '')
    .map((key) => [key, String(filters[key])]));
};

const defaultVariantId = (product) => product?.variants?.find((variant) => variant.status === 'active')?._id;

const getGreeting = asyncHandler(async (_req, res) => ApiResponse.success(res, {
  message: 'Voice greeting loaded successfully',
  data: { brand: 'Bruce & Walsh Luxury', greetingMessage: GREETING, assistantName: 'Walsh Concierge' },
}));

const removedStaticAudio = (_req, _res, next) => next(new AppError(
  'Static voice audio is no longer used. The app synthesizes each response on device.',
  410,
  'STATIC_VOICE_AUDIO_REMOVED',
));

const getVoiceAssistance = asyncHandler(async (req, res) => {
  const query = String(req.body.query || '').trim().slice(0, 500);
  if (!query) throw new AppError('Query is required', 400, 'QUERY_REQUIRED');

  const clientContext = req.body.context && typeof req.body.context === 'object' ? req.body.context : {};
  const interpretation = await interpretVoiceRequest(query, clientContext);
  if (interpretation.intent === 'UNKNOWN') {
    console.warn('[voice-routing-fallback]', {
      rawTranscript: query,
      normalizedTranscript: normalizeVoiceText(query),
      detectedIntent: interpretation.intent,
      extractedFilters: interpretation.filters || {},
      matchedExistingProductAction: false,
    });
  }
  const resolvedFilters = interpretation.intent === 'UNKNOWN'
    ? clientContext.filters || {}
    : interpretation.filters || clientContext.filters || {};
  const context = { ...clientContext, filters: resolvedFilters };
  let products = [];
  let product = null;
  let action = { type: 'NONE' };
  let replyText = interpretation.replyText || 'I did not quite catch that. Try asking for a style, budget, or shopping action.';

  if (interpretation.intent === 'SEARCH_CATALOG') {
    let actionFilters = interpretation.filters;
    products = await findProducts(actionFilters);
    if (!products.length && actionFilters.gemstone && !actionFilters.q) {
      actionFilters = { ...actionFilters, q: actionFilters.gemstone, gemstone: '' };
      products = await findProducts(actionFilters);
      context.filters = actionFilters;
    }
    action = { type: 'SEARCH_CATALOG', params: catalogParams(actionFilters) };
    context.lastProducts = products.map((item) => ({
      id: String(item._id), slug: item.slug, name: item.name, price: productPrice(item),
    }));
    if (!interpretation.replyText) {
      replyText = catalogAcknowledgement(actionFilters, clientContext.filters || {});
    }
  }

  if (['OPEN_PRODUCT', 'PRODUCT_PRICE', 'PRODUCT_DETAILS', 'ADD_TO_CART', 'ADD_TO_WISHLIST', 'SIMILAR_PRODUCTS'].includes(interpretation.intent)) {
    const lastProducts = Array.isArray(clientContext.lastProducts) ? clientContext.lastProducts : [];
    const ordinalIndex = Math.max(0, Number(interpretation.ordinal || 1) - 1);
    const selectedVisibleProduct = lastProducts[ordinalIndex];
    const candidate = interpretation.intent === 'OPEN_PRODUCT'
      ? interpretation.productIdentifier
        || selectedVisibleProduct?.slug
        || selectedVisibleProduct?.id
      : interpretation.productIdentifier
        || clientContext.currentProductIdentifier
        || selectedVisibleProduct?.slug
        || selectedVisibleProduct?.id;
    if (interpretation.intent === 'OPEN_PRODUCT' && !candidate) {
      replyText = lastProducts.length
        ? `Only ${lastProducts.length} products are currently visible.`
        : 'There are no visible products to open.';
    }
    product = await findProduct(candidate);
    if (!candidate) {
      product = null;
    } else if (!product) {
      replyText = 'Please open or choose a product first, then ask me again.';
    } else {
      context.currentProductIdentifier = product.slug || String(product._id);
      if (interpretation.intent === 'OPEN_PRODUCT') {
        action = { type: 'OPEN_PRODUCT', identifier: product.slug || String(product._id) };
        replyText = `Opening ${product.name}.`;
      } else if (interpretation.intent === 'PRODUCT_PRICE') {
        const price = productPrice(product);
        replyText = price === null
          ? `${product.name} is available through a private appointment.`
          : `${product.name} is ${currency(price)}.`;
      } else if (interpretation.intent === 'PRODUCT_DETAILS') {
        const details = [
          product.material?.length ? `material: ${product.material.join(', ')}` : '',
          product.gemstone?.length ? `gemstone: ${product.gemstone.join(', ')}` : '',
          product.variants?.length
            ? `available options: ${product.variants.filter((variant) => variant.status === 'active').map((variant) => variant.name || variant.sku).filter(Boolean).join(', ')}`
            : '',
        ].filter(Boolean);
        const available = Number(product.stock || 0) > 0
          || product.variants?.some((variant) => variant.status === 'active' && Number(variant.stock || 0) > 0);
        replyText = `${product.name}. ${details.join('. ')}${details.length ? '. ' : ''}${available ? 'It is available.' : 'Please contact us to confirm availability.'}`;
      } else if (interpretation.intent === 'ADD_TO_CART') {
        if (product.purchaseMode === 'appointmentOnly') {
          action = { type: 'NAVIGATE', destination: `/appointments/request/new?product=${product._id}` };
          replyText = `${product.name} is available by private appointment. I will open the booking page.`;
        } else {
          action = {
            type: 'ADD_TO_CART', productId: String(product._id),
            variantId: defaultVariantId(product), quantity: interpretation.quantity || 1,
          };
          replyText = `Adding ${product.name} to your bag.`;
        }
      } else if (interpretation.intent === 'ADD_TO_WISHLIST') {
        action = { type: 'ADD_TO_WISHLIST', productId: String(product._id), variantId: defaultVariantId(product) };
        replyText = `Saving ${product.name} to your wishlist.`;
      } else {
        const relatedFilters = {
          q: product.category?.name || '', material: product.material?.[0] || '', sort: 'popular',
        };
        products = (await findProducts(relatedFilters))
          .filter((item) => String(item._id) !== String(product._id));
        action = { type: 'SEARCH_CATALOG', params: catalogParams(relatedFilters) };
        context.lastProducts = products.map((item) => ({
          id: String(item._id), slug: item.slug, name: item.name, price: productPrice(item),
        }));
        replyText = `Here are pieces similar to ${product.name}.`;
      }
    }
  }

  if (interpretation.intent === 'NAVIGATE') action = {
    type: 'NAVIGATE', destination: interpretation.destination,
    requiresAccount: Boolean(interpretation.requiresAccount),
  };
  if (interpretation.intent === 'GO_BACK') action = { type: 'GO_BACK' };
  if (interpretation.intent === 'SCROLL') action = {
    type: 'SCROLL', direction: interpretation.destination === 'up' ? 'up' : 'down',
  };
  if (interpretation.intent === 'REMOVE_FROM_CART') action = {
    type: 'REMOVE_FROM_CART', ordinal: interpretation.ordinal || 1,
  };
  if (interpretation.intent === 'UPDATE_CART_QUANTITY') action = {
    type: 'UPDATE_CART_QUANTITY', ordinal: interpretation.ordinal || 1,
    quantity: interpretation.quantity || 1,
    increment: interpretation.quantity === 0 ? 1 : 0,
  };
  if (interpretation.intent === 'REMOVE_FROM_WISHLIST') action = {
    type: 'REMOVE_FROM_WISHLIST', ordinal: interpretation.ordinal || 1,
  };
  if (interpretation.intent === 'APPLY_COUPON') action = {
    type: 'APPLY_COUPON', code: interpretation.couponCode,
  };
  if (interpretation.intent === 'CART_SUMMARY') action = { type: 'CART_SUMMARY' };
  if (interpretation.intent === 'LOGOUT') action = { type: 'LOGOUT' };
  if (interpretation.intent === 'STOP') action = { type: 'STOP' };
  if (interpretation.intent === 'RESUME_NARRATION') action = { type: 'RESUME_NARRATION' };
  if (interpretation.intent === 'RESTART_NARRATION') action = { type: 'RESTART_NARRATION' };
  if (interpretation.intent === 'CLOSE') action = { type: 'CLOSE' };

  return ApiResponse.success(res, {
    message: 'Voice assistance generated',
    data: {
      replyText,
      action,
      context,
      products: presentProductsForCustomer(products),
      product: product ? presentProductForCustomer(product) : null,
    },
  });
});

module.exports = {
  getGreeting,
  getGreetingAudio: removedStaticAudio,
  getQueryAudio: removedStaticAudio,
  getReplyAudio: removedStaticAudio,
  getVoiceAssistance,
};
