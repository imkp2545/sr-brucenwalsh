const CmsPage = require('../models/cmsPageModel');
const AppError = require('../utils/appError');

const normalizeSubmitted = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    slug: String(item?.slug || '').trim().toLowerCase(),
    documentVersion: String(item?.documentVersion || '').trim(),
    cmsVersion: Number(item?.cmsVersion),
  }));
};

const captureRequiredLegalAcceptances = async (submittedValue) => {
  const now = new Date();
  const requiredPages = await CmsPage.find({
    status: 'published',
    publishedAt: { $lte: now },
    pageType: { $in: ['policy', 'terms'] },
    'legal.requiresAcceptance': true,
    'legal.effectiveAt': { $lte: now },
  })
    .select('_id title slug version legal.documentVersion legal.effectiveAt')
    .sort({ 'legal.displayOrder': 1, title: 1 })
    .lean();

  if (!requiredPages.length) return [];
  const submitted = normalizeSubmitted(submittedValue);
  const missing = requiredPages.filter((page) => !submitted.some((item) => (
    item.slug === page.slug
    && item.documentVersion === page.legal?.documentVersion
    && item.cmsVersion === page.version
  )));

  if (missing.length) {
    throw new AppError(
      'Please review and accept the current terms before payment.',
      422,
      'LEGAL_ACCEPTANCE_REQUIRED',
      {
        documents: requiredPages.map((page) => ({
          title: page.title,
          slug: page.slug,
          documentVersion: page.legal?.documentVersion,
          cmsVersion: page.version,
        })),
      },
    );
  }

  const acceptedAt = now.toISOString();
  return requiredPages.map((page) => ({
    pageId: String(page._id),
    title: page.title,
    slug: page.slug,
    documentVersion: page.legal.documentVersion,
    cmsVersion: page.version,
    effectiveAt: page.legal.effectiveAt,
    acceptedAt,
  }));
};

module.exports = { captureRequiredLegalAcceptances };
