require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/dbConfig');
const Admin = require('../models/adminModel');
const CmsPage = require('../models/cmsPageModel');
const {
  DOCUMENT_VERSION,
  sections,
} = require('./generateCustomerPoliciesPdf');

const pageConfiguration = {
  terms: { slug: 'terms-and-conditions', pageType: 'terms', order: 10, requiresAcceptance: true },
  privacy: { slug: 'privacy-policy', pageType: 'policy', order: 20 },
  shipping: { slug: 'shipping-policy', pageType: 'policy', order: 30 },
  returns: { slug: 'return-policy', pageType: 'policy', order: 40 },
  refunds: { slug: 'refund-policy', pageType: 'policy', order: 50 },
  buyback: { slug: 'buyback-policy', pageType: 'policy', order: 60 },
};

const blockContent = (block) => [
  ...(block.paragraphs || []),
  ...(block.bullets || []).map((item) => `- ${item}`),
  block.text,
].filter(Boolean).join('\n\n');

const toCmsBlocks = (section) => section.blocks.map((block, index) => ({
  type: block.type === 'callout' || block.type === 'formula' ? 'quote' : 'richText',
  heading: block.title || '',
  content: blockContent(block),
  displayOrder: index,
  isVisible: true,
}));

const findContentOwner = async () => {
  const requestedEmail = String(process.env.LEGAL_CONTENT_ADMIN_EMAIL || '').trim().toLowerCase();
  if (requestedEmail) {
    const requested = await Admin.findOne({ email: requestedEmail, status: 'active' });
    if (requested) return requested;
    throw new Error(`No active admin found for LEGAL_CONTENT_ADMIN_EMAIL=${requestedEmail}`);
  }
  const admin = await Admin.findOne({
    role: { $in: ['superAdmin', 'admin'] },
    status: 'active',
    deletedAt: null,
  }).sort({ role: 1, createdAt: 1 });
  if (!admin) throw new Error('Create an active superAdmin or admin before seeding legal drafts');
  return admin;
};

const seedLegalPolicyDrafts = async () => {
  await connectDatabase();
  const owner = await findContentOwner();
  const configuredSections = sections.filter((section) => pageConfiguration[section.key]);
  const slugs = configuredSections.map((section) => pageConfiguration[section.key].slug);
  const existingSlugs = new Set((await CmsPage.find({ slug: { $in: slugs } }).select('slug').lean())
    .map((page) => page.slug));

  const drafts = configuredSections
    .filter((section) => !existingSlugs.has(pageConfiguration[section.key].slug))
    .map((section) => {
      const config = pageConfiguration[section.key];
      return {
        title: section.title,
        slug: config.slug,
        pageType: config.pageType,
        excerpt: section.subtitle,
        blocks: toCmsBlocks(section),
        seo: {
          title: section.title,
          description: section.subtitle,
          noIndex: true,
        },
        legal: {
          documentVersion: DOCUMENT_VERSION,
          effectiveAt: new Date('2026-07-28T00:00:00+05:30'),
          category: section.key,
          displayOrder: config.order,
          requiresAcceptance: Boolean(config.requiresAcceptance),
        },
        status: 'draft',
        createdBy: owner._id,
        updatedBy: owner._id,
      };
    });

  if (drafts.length) await CmsPage.insertMany(drafts);
  console.info(`Legal policy seeding complete: ${drafts.length} created, ${existingSlugs.size} already present.`);
};

seedLegalPolicyDrafts()
  .catch((error) => {
    console.error(`Legal policy seeding failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
