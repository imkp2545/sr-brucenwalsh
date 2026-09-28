const activeBannerFilter = ({ placement, platform, audience, targetPath } = {}, now = new Date()) => {
  const collectionTargetPlacements = new Set(['collectionHero', 'collectionInline']);
  const placements = String(placement || '').split(',').map((value) => value.trim()).filter(Boolean);
  const filter = {
    status: 'active',
    startsAt: { $lte: now },
    $and: [
      { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }] },
    ],
  };

  if (placements.length) filter.placement = placements.length === 1 ? placements[0] : { $in: placements };
  if (platform) {
    filter.$and.push({
      $or: [
        { platforms: platform },
        { platforms: { $size: 0 } },
        { platforms: { $exists: false } },
      ],
    });
  }
  if (audience) filter.audience = { $in: ['all', audience] };
  if (targetPath) {
    const requiresExactTarget = placements.some((value) => collectionTargetPlacements.has(value));
    filter.$and.push(requiresExactTarget
      ? { targetPath }
      : {
        $or: [
          { targetPath },
          { targetPath: '' },
          { targetPath: null },
          { targetPath: { $exists: false } },
        ],
      });
  }

  return filter;
};

module.exports = { activeBannerFilter };
