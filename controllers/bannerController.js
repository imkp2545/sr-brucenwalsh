const Banner = require('../models/bannerModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { flattenFiles, uploadBuffer, deleteAssets } = require('../utils/cloudinaryUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { activeBannerFilter } = require('../utils/bannerTargetingUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const bannerResponseProjection = '-desktopImage';

const parseJson = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { throw new AppError('Invalid JSON form field', 422, 'INVALID_JSON'); }
};

const parseBoolean = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
};

const targetedPlacements = new Set(['categoryHero', 'collectionHero', 'collectionInline', 'productStrip']);
const collectionPlacementsRequiringTarget = new Set(['collectionHero', 'collectionInline']);
const inlineBannerPlacements = new Set(['collectionInline', 'homeSecondary', 'homeFeature', 'homeStrip']);
const inlinePositions = new Set(['distributed', 'top', 'bottom']);
const inlineGroups = new Set(['setA', 'setB', 'setC', 'setD']);
const normalizeTargetPath = (value, placement) => {
  if (!targetedPlacements.has(placement)) return '';
  const targetPath = String(value || '').trim();
  if (targetPath && !targetPath.startsWith('/')) {
    throw new AppError('Banner target must be an app path', 422, 'INVALID_BANNER_TARGET_PATH');
  }
  if (collectionPlacementsRequiringTarget.has(placement) && !targetPath) {
    throw new AppError(
      'Select a specific collection page for this banner',
      422,
      'BANNER_COLLECTION_TARGET_REQUIRED',
    );
  }
  return targetPath;
};

const normalizeInlinePosition = (value, placement) => {
  if (!inlineBannerPlacements.has(placement)) return 'distributed';
  const inlinePosition = String(value || 'distributed').trim();
  if (!inlinePositions.has(inlinePosition)) {
    throw new AppError('Invalid collection inline banner position', 422, 'INVALID_BANNER_INLINE_POSITION');
  }
  return inlinePosition;
};

const normalizeInlineGroup = (value, placement) => {
  if (!inlineBannerPlacements.has(placement)) return 'setA';
  const inlineGroup = String(value || 'setA').trim();
  if (!inlineGroups.has(inlineGroup)) {
    throw new AppError('Invalid collection inline banner set', 422, 'INVALID_BANNER_INLINE_GROUP');
  }
  return inlineGroup;
};

const parseBannerCta = (value) => {
  const cta = parseJson(value);
  if (cta === undefined) return undefined;
  const linkType = cta?.linkType || 'none';
  const label = String(cta?.label || '').trim();
  const url = String(cta?.url || '').trim();

  if (linkType !== 'none' && !label) {
    throw new AppError('Banner action label is required', 422, 'BANNER_CTA_LABEL_REQUIRED');
  }
  if (linkType !== 'none' && !url) {
    throw new AppError('Banner action destination is required', 422, 'BANNER_CTA_DESTINATION_REQUIRED');
  }
  if (linkType === 'external' && !/^https?:\/\//i.test(url)) {
    throw new AppError('External banner URL must use http or https', 422, 'INVALID_BANNER_CTA_URL');
  }
  if (!['none', 'external'].includes(linkType) && url && !url.startsWith('/')) {
    throw new AppError('Internal banner destination must be an app path', 422, 'INVALID_BANNER_CTA_PATH');
  }

  return {
    ...cta,
    label: linkType === 'none' ? '' : label,
    url: linkType === 'none' ? '' : url,
    linkType,
    openInNewTab: linkType === 'external' && Boolean(cta.openInNewTab),
  };
};

const uploadBannerFiles = async (req, title, uploadedAssets) => {
  const result = {};
  for (const file of flattenFiles(req.files)) {
    const uploaded = await uploadBuffer(file, {
      folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/banners`,
    });
    uploadedAssets.push(uploaded);
    result[file.fieldname] = {
      url: uploaded.url,
      publicId: uploaded.publicId,
      alt: req.body[`${file.fieldname}Alt`] || title,
      width: uploaded.width,
      height: uploaded.height,
    };
  }
  return result;
};

const uniqueAssets = (assets) => Array.from(
  new Map(assets.filter((asset) => asset?.publicId).map((asset) => [asset.publicId, asset])).values(),
);

const reconcileBannerStatuses = async () => {
  const now = new Date();
  await Promise.all([
    Banner.updateMany(
      { status: { $in: ['active', 'scheduled'] }, endsAt: { $lte: now } },
      { $set: { status: 'expired' } },
    ),
    Banner.updateMany(
      {
        status: 'scheduled',
        startsAt: { $lte: now },
        $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }],
      },
      { $set: { status: 'active' } },
    ),
  ]);
};

const listActiveBanners = asyncHandler(async (req, res) => {
  await reconcileBannerStatuses();
  const banners = await Banner.find(activeBannerFilter(req.query))
    .select(bannerResponseProjection)
    .sort({ displayOrder: 1, placement: 1 }).lean();
  if (req.query.targetPath) {
    banners.sort((left, right) => {
      const leftSpecific = left.targetPath === req.query.targetPath ? 0 : 1;
      const rightSpecific = right.targetPath === req.query.targetPath ? 0 : 1;
      return leftSpecific - rightSpecific || left.displayOrder - right.displayOrder;
    });
  }
  return ApiResponse.success(res, { data: banners });
});

const trackImpression = asyncHandler(async (req, res) => {
  const banner = await Banner.findOneAndUpdate(
    { _id: req.params.bannerId, ...activeBannerFilter() }, { $inc: { impressionCount: 1 } }, { new: true },
  );
  if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
  return res.status(204).send();
});

const trackClick = asyncHandler(async (req, res) => {
  const banner = await Banner.findOneAndUpdate(
    { _id: req.params.bannerId, ...activeBannerFilter() }, { $inc: { clickCount: 1 } }, { new: true },
  );
  if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
  return res.status(204).send();
});

const listBannersAdmin = asyncHandler(async (req, res) => {
  await reconcileBannerStatuses();
  const baseFilter = {};
  if (req.query.placement) baseFilter.placement = req.query.placement;
  const filter = applyStatusFilter({ ...baseFilter }, 'status', req.query.status);
  const [banners, summary] = await Promise.all([
    Banner.find(filter).select(bannerResponseProjection).sort({ placement: 1, displayOrder: 1, createdAt: -1 }),
    summarizeStatusFields(Banner, baseFilter),
  ]);
  return ApiResponse.success(res, { data: banners, meta: { total: banners.length, summary } });
});

const getBannerAdmin = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.bannerId).select(bannerResponseProjection);
  if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
  return ApiResponse.success(res, { data: banner });
});

const createBanner = asyncHandler(async (req, res) => {
  if (!req.body.title || !req.body.placement || !req.body.startsAt) {
    throw new AppError('Title, placement, and start date are required', 422, 'VALIDATION_ERROR');
  }
  if (req.body.placement === 'categoryHero') {
    throw new AppError('Category banner placement is no longer available', 422, 'BANNER_PLACEMENT_RETIRED');
  }
  const uploadedAssets = [];
  try {
    const displayStyle = req.body.displayStyle || 'overlay';
    const media = await uploadBannerFiles(req, req.body.title, uploadedAssets);
    if (!media.mobileImage) throw new AppError('A banner image is required', 422, 'BANNER_IMAGE_REQUIRED');
    const banner = await Banner.create({
      title: req.body.title,
      subtitle: req.body.subtitle,
      description: req.body.description,
      placement: req.body.placement,
      mobileImage: media.mobileImage,
      cta: parseBannerCta(req.body.cta),
      audience: req.body.audience,
      platforms: parseJson(req.body.platforms, ['web', 'ios', 'android']),
      targetPath: normalizeTargetPath(req.body.targetPath, req.body.placement),
      displayStyle,
      inlinePosition: normalizeInlinePosition(req.body.inlinePosition, req.body.placement),
      inlineGroup: normalizeInlineGroup(req.body.inlineGroup, req.body.placement),
      showContent: displayStyle === 'imageOnly' ? false : parseBoolean(req.body.showContent, true),
      contentAlignment: req.body.contentAlignment || 'left',
      contentTheme: req.body.contentTheme || 'light',
      displayOrder: req.body.displayOrder,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt || undefined,
      status: req.body.status || 'draft',
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    await logAudit(req, {
      action: 'create', resourceType: 'Banner', resourceId: banner._id, resourceLabel: banner.title,
      description: 'Banner created', statusCode: 201,
    });
    return ApiResponse.success(res, { statusCode: 201, message: 'Banner created', data: banner });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.bannerId).select(bannerResponseProjection);
  if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
  if (banner.placement === 'categoryHero' || req.body.placement === 'categoryHero') {
    throw new AppError('Category banners are retired and can only be deactivated', 422, 'BANNER_PLACEMENT_RETIRED');
  }
  const uploadedAssets = [];
  const oldAssets = [];
  try {
    const media = await uploadBannerFiles(req, req.body.title || banner.title, uploadedAssets);
    if (media.mobileImage) {
      if (banner.mobileImage?.publicId) {
        oldAssets.push({ publicId: banner.mobileImage.publicId, resourceType: 'image' });
      }
      banner.mobileImage = media.mobileImage;
    }
    for (const field of ['title', 'subtitle', 'description', 'placement', 'audience', 'targetPath', 'displayStyle', 'inlinePosition', 'inlineGroup', 'contentAlignment', 'contentTheme', 'displayOrder', 'startsAt', 'endsAt', 'status']) {
      if (req.body[field] !== undefined) banner[field] = req.body[field] || (field === 'endsAt' ? null : req.body[field]);
    }
    if (req.body.showContent !== undefined) banner.showContent = parseBoolean(req.body.showContent, true);
    if (banner.displayStyle === 'imageOnly') banner.showContent = false;
    banner.targetPath = normalizeTargetPath(banner.targetPath, banner.placement);
    banner.inlinePosition = normalizeInlinePosition(banner.inlinePosition, banner.placement);
    banner.inlineGroup = normalizeInlineGroup(banner.inlineGroup, banner.placement);
    if (req.body.mobileImageAlt !== undefined) banner.mobileImage.alt = req.body.mobileImageAlt || banner.title;
    if (req.body.cta !== undefined) banner.cta = parseBannerCta(req.body.cta);
    if (req.body.platforms !== undefined) banner.platforms = parseJson(req.body.platforms);
    banner.updatedBy = req.user.id;
    await banner.save();
    await deleteAssets(uniqueAssets(oldAssets));
    await logAudit(req, {
      action: 'update', resourceType: 'Banner', resourceId: banner._id, resourceLabel: banner.title,
      description: 'Banner updated', statusCode: 200,
    });
    return ApiResponse.success(res, { message: 'Banner updated', data: banner });
  } catch (error) {
    await deleteAssets(uploadedAssets);
    throw error;
  }
});

const deactivateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findById(req.params.bannerId);
  if (!banner) throw new AppError('Banner not found', 404, 'BANNER_NOT_FOUND');
  banner.status = 'inactive';
  banner.updatedBy = req.user.id;
  await banner.save();
  await logAudit(req, {
    action: 'delete', resourceType: 'Banner', resourceId: banner._id, resourceLabel: banner.title,
    description: 'Banner deactivated', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Banner deactivated' });
});

module.exports = {
  listActiveBanners, trackImpression, trackClick, listBannersAdmin,
  getBannerAdmin, createBanner, updateBanner, deactivateBanner,
};
