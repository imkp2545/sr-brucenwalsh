const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLegalPageType,
  legalPublicationIssues,
  normalizeLegal,
} = require('../utils/cmsLegalUtils');

test('identifies policy and terms pages as legal content', () => {
  assert.equal(isLegalPageType('policy'), true);
  assert.equal(isLegalPageType('terms'), true);
  assert.equal(isLegalPageType('static'), false);
});

test('normalizes legal metadata without trusting arbitrary categories', () => {
  assert.deepEqual(normalizeLegal({
    documentVersion: ' 2.1 ',
    category: 'unknown',
    displayOrder: -4,
    requiresAcceptance: 'true',
  }), {
    documentVersion: '2.1',
    effectiveAt: undefined,
    category: 'general',
    displayOrder: 0,
    requiresAcceptance: true,
  });
});

test('blocks incomplete legal drafts from publication', () => {
  const issues = legalPublicationIssues({
    title: 'Privacy policy',
    pageType: 'policy',
    legal: {},
    blocks: [{ isVisible: true, content: 'Contact [support email].' }],
  });
  assert.ok(issues.some((issue) => issue.includes('version')));
  assert.ok(issues.some((issue) => issue.includes('effective date')));
  assert.ok(issues.some((issue) => issue.includes('placeholders')));
});

test('accepts complete legal publication metadata', () => {
  const issues = legalPublicationIssues({
    title: 'Terms and conditions',
    pageType: 'terms',
    legal: { documentVersion: '1.0', effectiveAt: '2026-08-13', category: 'terms' },
    blocks: [{ isVisible: true, content: 'These terms apply to customer purchases.' }],
  });
  assert.deepEqual(issues, []);
});
