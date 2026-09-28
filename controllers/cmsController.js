const CmsPage = require('../models/cmsPageModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { createSlug } = require('../utils/slugUtils');
const { flattenFiles, uploadBuffer, deleteAssets } = require('../utils/cloudinaryUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');
const {
  isLegalPageType,
  legalPublicationIssues,
  normalizeLegal,
} = require('../utils/cmsLegalUtils');

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const assertLegalPublicationAllowed = (page, role) => {
  if (page.status !== 'published' || !isLegalPageType(page.pageType)) return;
  if (!['superAdmin', 'admin'].includes(role)) {
    throw new AppError('Only an administrator can publish legal content', 403, 'LEGAL_PUBLISH_FORBIDDEN');
  }
  const issues = legalPublicationIssues(page);
  if (issues.length) {
    throw new AppError('Legal page is not ready to publish', 422, 'LEGAL_PAGE_NOT_READY', { issues });
  }
};

const effectivePublishedFilter = (now = new Date()) => ({
  status: 'published',
  publishedAt: { $lte: now },
  $or: [
    { pageType: { $nin: ['policy', 'terms'] } },
    { 'legal.effectiveAt': { $lte: now } },
  ],
});

const assignBlockMedia = async (req, blocks, uploadedAssets) => {
  const files = flattenFiles(req.files);
  const indexes = parseJson(req.body.mediaBlockIndexes, []);
  const usedIndexes = new Set();
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const blockIndex = indexes[fileIndex] !== undefined ? Number(indexes[fileIndex]) : fileIndex;
    if (!Number.isInteger(blockIndex) || !blocks[blockIndex]) throw new AppError('Each uploaded file must reference a valid content block', 422, 'INVALID_BLOCK_INDEX');
    if (usedIndexes.has(blockIndex)) throw new AppError('Only one uploaded file may target each content block', 422, 'DUPLICATE_BLOCK_MEDIA');
    usedIndexes.add(blockIndex);
    const uploaded = await uploadBuffer(files[fileIndex], {
      folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/cms`,
    });
    uploadedAssets.push(uploaded);
    blocks[blockIndex].media = {
      ...(blocks[blockIndex].media || {}),
      url: uploaded.url,
      publicId: uploaded.publicId,
      alt: blocks[blockIndex].media?.alt || blocks[blockIndex].heading || req.body.title,
    };
  }
};

const listPublishedPages = asyncHandler(async (req, res) => {
  const filter = effectivePublishedFilter();
  if (req.query.pageType) filter.pageType = req.query.pageType;
  const pages = await CmsPage.find(filter).select('title slug pageType excerpt seo legal version publishedAt updatedAt')
    .sort({ publishedAt: -1 }).lean();
  return ApiResponse.success(res, { data: pages });
});

const listPublishedLegalPages = asyncHandler(async (_req, res) => {
  const now = new Date();
  const pages = await CmsPage.find({
    status: 'published',
    publishedAt: { $lte: now },
    pageType: { $in: ['policy', 'terms'] },
    'legal.effectiveAt': { $lte: now },
  })
    .select('title slug pageType excerpt legal version publishedAt updatedAt')
    .sort({ 'legal.displayOrder': 1, title: 1 })
    .lean();
  return ApiResponse.success(res, { data: pages });
});

const getPublishedPage = asyncHandler(async (req, res) => {
  const page = await CmsPage.findOne({
    slug: String(req.params.slug).toLowerCase(),
    ...effectivePublishedFilter(),
  }).lean();
  if (!page) throw new AppError('Page not found', 404, 'CMS_PAGE_NOT_FOUND');
  return ApiResponse.success(res, { data: page });
});

const listPagesAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.pageType) baseFilter.pageType = req.query.pageType;
  if (req.query.search) baseFilter.$text = { $search: String(req.query.search).slice(0, 100) };
  const filter = applyStatusFilter({ ...baseFilter }, 'status', req.query.status);
  const [pages, total, summary] = await Promise.all([
    CmsPage.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    CmsPage.countDocuments(filter),
    summarizeStatusFields(CmsPage, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: pages,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getPageAdmin = asyncHandler(async (req, res) => {
  const page = await CmsPage.findById(req.params.pageId).select('+revisions');
  if (!page) throw new AppError('Page not found', 404, 'CMS_PAGE_NOT_FOUND');
  return ApiResponse.success(res, { data: page });
});

const createPage = asyncHandler(async (req, res) => {
  if (!req.body.title) throw new AppError('Page title is required', 422, 'VALIDATION_ERROR');
  const slug = createSlug(req.body.slug || req.body.title);
  if (!slug) throw new AppError('Valid page slug is required', 422, 'INVALID_SLUG');
  if (await CmsPage.exists({ slug })) throw new AppError('Page slug already exists', 409, 'SLUG_EXISTS');
  const blocks = parseJson(req.body.blocks, []);
  if (!Array.isArray(blocks)) throw new AppError('Blocks must be an array', 422, 'INVALID_BLOCKS');
  const uploadedAssets = [];
  try {
    await assignBlockMedia(req, blocks, uploadedAssets);
    const pageInput = {
      title: req.body.title,
      slug,
      pageType: req.body.pageType,
      excerpt: req.body.excerpt,
      blocks,
      seo: parseJson(req.body.seo),
      legal: normalizeLegal(parseJson(req.body.legal, {})),
      status: req.body.status || 'draft',
      publishedAt: req.body.status === 'published' ? new Date() : undefined,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    };
    assertLegalPublicationAllowed(pageInput, req.user.role);
    const page = await CmsPage.create(pageInput);
    await logAudit(req, {
      action: 'create', resourceType: 'CmsPage', resourceId: page._id, resourceLabel: page.title,
      description: 'CMS page created', statusCode: 201,
    });
    return ApiResponse.success(res, { statusCode: 201, message: 'CMS page created', data: page });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const updatePage = asyncHandler(async (req, res) => {
  const page = await CmsPage.findById(req.params.pageId).select('+revisions');
  if (!page) throw new AppError('Page not found', 404, 'CMS_PAGE_NOT_FOUND');
  if (req.body.slug) {
    const slug = createSlug(req.body.slug);
    if (!slug) throw new AppError('Invalid page slug', 422, 'INVALID_SLUG');
    if (await CmsPage.exists({ slug, _id: { $ne: page._id } })) throw new AppError('Page slug already exists', 409, 'SLUG_EXISTS');
    page.slug = slug;
  }

  const oldAssets = page.blocks.filter((block) => block.media?.publicId)
    .map((block) => ({ publicId: block.media.publicId, resourceType: 'image' }));
  const blocks = req.body.blocks !== undefined ? parseJson(req.body.blocks) : page.blocks.map((block) => block.toObject());
  if (!Array.isArray(blocks)) throw new AppError('Blocks must be an array', 422, 'INVALID_BLOCKS');
  const uploadedAssets = [];
  try {
    await assignBlockMedia(req, blocks, uploadedAssets);
    page.revisions.push({
      version: page.version,
      title: page.title,
      pageType: page.pageType,
      excerpt: page.excerpt,
      blocks: page.blocks.map((block) => block.toObject()),
      legal: page.legal?.toObject?.() || page.legal,
      changedBy: req.user.id,
      changeNote: req.body.changeNote,
    });
    if (page.revisions.length > 20) page.revisions = page.revisions.slice(-20);
    for (const field of ['title', 'pageType', 'excerpt', 'status']) {
      if (req.body[field] !== undefined) page[field] = req.body[field];
    }
    if (req.body.seo !== undefined) page.seo = parseJson(req.body.seo);
    if (req.body.legal !== undefined) page.legal = normalizeLegal(parseJson(req.body.legal, {}));
    page.blocks = blocks;
    page.version += 1;
    page.updatedBy = req.user.id;
    if (page.status === 'published' && !page.publishedAt) page.publishedAt = new Date();
    assertLegalPublicationAllowed(page, req.user.role);
    await page.save();

    const retainedIds = new Set(page.blocks.map((block) => block.media?.publicId).filter(Boolean));
    await deleteAssets(oldAssets.filter((asset) => !retainedIds.has(asset.publicId)));
    await logAudit(req, {
      action: 'update', resourceType: 'CmsPage', resourceId: page._id, resourceLabel: page.title,
      description: 'CMS page updated', statusCode: 200,
    });
    return ApiResponse.success(res, { message: 'CMS page updated', data: page });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const archivePage = asyncHandler(async (req, res) => {
  const page = await CmsPage.findById(req.params.pageId);
  if (!page) throw new AppError('Page not found', 404, 'CMS_PAGE_NOT_FOUND');
  page.status = 'archived';
  page.updatedBy = req.user.id;
  await page.save();
  await logAudit(req, {
    action: 'delete', resourceType: 'CmsPage', resourceId: page._id, resourceLabel: page.title,
    description: 'CMS page archived', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'CMS page archived' });
});

module.exports = {
  listPublishedPages,
  listPublishedLegalPages,
  getPublishedPage,
  listPagesAdmin,
  getPageAdmin,
  createPage,
  updatePage,
  archivePage,
};
