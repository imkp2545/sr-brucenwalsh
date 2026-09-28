const MENU_SECTIONS = [
  { key: 'recipient', title: 'Shop by Recipient', iconKey: 'gift' },
  { key: 'gender', title: 'Shop by Gender', iconKey: 'people' },
  { key: 'productType', title: 'Product Type', iconKey: 'diamond' },
  { key: 'collections', title: 'Collections', iconKey: 'crown' },
  { key: 'more', title: 'More', iconKey: 'more' },
];

const imageValue = (asset) => (asset?.url ? asset : undefined);

const categoryFilter = (category) => {
  const filterType = category.menuFilterType || 'category';
  const filterValue = String(category.menuFilterValue || '').trim().toLowerCase();

  if (filterType === 'gender' && filterValue) return { gender: filterValue };
  if (filterType === 'tag' && filterValue) return { tags: filterValue };

  const identifier = category.slug || String(category._id || '');
  return identifier ? { category: identifier } : {};
};

const categoryItem = (category) => ({
  id: String(category._id || category.slug),
  label: category.menuLabel || category.name,
  target: 'products',
  image: imageValue(category.image),
  icon: imageValue(category.icon),
  filter: categoryFilter(category),
});

const collectionItem = (collection) => ({
  id: String(collection._id || collection.slug),
  label: collection.name,
  target: 'collection',
  identifier: collection.slug || String(collection._id),
  image: imageValue(collection.mobileImage) || imageValue(collection.heroImage),
});

const buildCategoryMenuSections = (categories = [], collections = []) => {
  const itemsBySection = new Map(MENU_SECTIONS.map((section) => [section.key, []]));

  categories.forEach((category) => {
    const section = category.menuSection || 'productType';
    if (itemsBySection.has(section)) itemsBySection.get(section).push(categoryItem(category));
  });
  collections.forEach((collection) => itemsBySection.get('collections').push(collectionItem(collection)));

  return MENU_SECTIONS.map((section) => ({
    ...section,
    items: itemsBySection.get(section.key),
  })).filter((section) => section.items.length > 0);
};

module.exports = { buildCategoryMenuSections };
