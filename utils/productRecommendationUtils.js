const identity = (value) => String(value?._id || value || '');

const values = (items = []) => new Set(items.map((item) => String(item).trim().toLowerCase()).filter(Boolean));

const overlapCount = (left = [], right = []) => {
  const rightValues = values(right);
  return [...values(left)].filter((value) => rightValues.has(value)).length;
};

const referenceOverlapCount = (left = [], right = []) => {
  const rightValues = new Set(right.map(identity).filter(Boolean));
  return new Set(left.map(identity).filter((value) => rightValues.has(value))).size;
};

const productAffinityScore = (source, candidate) => {
  let score = 0;
  const sourceCategory = identity(source.category);
  const candidateCategory = identity(candidate.category);
  const sourceSubcategories = source.subcategories || [];
  const candidateSubcategories = candidate.subcategories || [];

  if (source.purchaseMode && source.purchaseMode === candidate.purchaseMode) score += 30;
  if (sourceCategory && sourceCategory === candidateCategory) score += 50;
  if (sourceCategory && candidateSubcategories.some((item) => identity(item) === sourceCategory)) {
    score += 22;
  }
  if (candidateCategory && sourceSubcategories.some((item) => identity(item) === candidateCategory)) {
    score += 22;
  }
  score += Math.min(2, referenceOverlapCount(sourceSubcategories, candidateSubcategories)) * 12;
  score += Math.min(2, referenceOverlapCount(source.collections, candidate.collections)) * 15;
  if (source.productType && source.productType === candidate.productType) score += 12;
  score += Math.min(3, overlapCount(source.material, candidate.material)) * 4;
  score += Math.min(3, overlapCount(source.gemstone, candidate.gemstone)) * 5;
  score += Math.min(3, overlapCount(source.color, candidate.color)) * 2;
  score += Math.min(4, overlapCount(source.tags, candidate.tags)) * 2;
  if (source.gender && source.gender === candidate.gender) score += 2;

  return score;
};

const rankRelatedProducts = (source, candidates = [], limit = 6) => candidates
  .map((candidate, index) => ({ candidate, index, score: productAffinityScore(source, candidate) }))
  .sort((left, right) =>
    right.score - left.score
      || Number(right.candidate.averageRating || 0) - Number(left.candidate.averageRating || 0)
      || Number(right.candidate.salesCount || 0) - Number(left.candidate.salesCount || 0)
      || Number(right.candidate.viewCount || 0) - Number(left.candidate.viewCount || 0)
      || Number(Boolean(right.candidate.isNewArrival)) - Number(Boolean(left.candidate.isNewArrival))
      || left.index - right.index)
  .slice(0, limit)
  .map(({ candidate }) => candidate);

module.exports = { productAffinityScore, rankRelatedProducts };
