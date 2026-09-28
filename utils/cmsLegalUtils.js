const LEGAL_PAGE_TYPES = new Set(['policy', 'terms']);

const LEGAL_CATEGORIES = [
  'terms',
  'privacy',
  'shipping',
  'returns',
  'refunds',
  'cancellation',
  'buyback',
  'general',
];

const unresolvedPatterns = [
  /\[(?:support email|india\s*\/\s*specify countries|1-year)\]/i,
  /\b(?:TODO|TBD)\b/i,
];

const isLegalPageType = (pageType) => LEGAL_PAGE_TYPES.has(pageType);

const normalizeLegal = (value = {}) => ({
  documentVersion: String(value.documentVersion || '').trim(),
  effectiveAt: value.effectiveAt || undefined,
  category: LEGAL_CATEGORIES.includes(value.category) ? value.category : 'general',
  displayOrder: Number.isFinite(Number(value.displayOrder))
    ? Math.max(0, Number(value.displayOrder))
    : 0,
  requiresAcceptance: value.requiresAcceptance === true || value.requiresAcceptance === 'true',
});

const pageText = (page) => [
  page.title,
  page.excerpt,
  ...(page.blocks || []).flatMap((block) => [
    block.heading,
    block.content,
    ...((block.settings?.get?.('items') || block.settings?.items || [])
      .flatMap((item) => [item.question, item.answer])),
  ]),
]
  .filter(Boolean)
  .join('\n');

const legalPublicationIssues = (page) => {
  if (!isLegalPageType(page.pageType)) return [];
  const issues = [];
  const legal = normalizeLegal(page.legal);
  const effectiveAt = legal.effectiveAt ? new Date(legal.effectiveAt) : null;
  const visibleBlocks = (page.blocks || []).filter((block) => block.isVisible !== false);

  if (!legal.documentVersion) issues.push('Document version is required.');
  if (!effectiveAt || Number.isNaN(effectiveAt.getTime())) {
    issues.push('A valid effective date is required.');
  }
  if (!visibleBlocks.length) issues.push('At least one visible content section is required.');
  if (unresolvedPatterns.some((pattern) => pattern.test(pageText(page)))) {
    issues.push('Resolve all legal draft placeholders before publishing.');
  }
  return issues;
};

module.exports = {
  LEGAL_CATEGORIES,
  isLegalPageType,
  legalPublicationIssues,
  normalizeLegal,
};
