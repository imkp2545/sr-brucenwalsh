const presentProductForCustomer = (product) => {
  if (!product) return product;
  const presented = typeof product.toObject === 'function' ? product.toObject() : { ...product };
  if (presented.purchaseMode !== 'appointmentOnly') return presented;

  delete presented.price;
  delete presented.compareAtPrice;
  delete presented.costPrice;
  presented.variants = (presented.variants || []).map((variant) => {
    const safeVariant = { ...variant };
    delete safeVariant.price;
    delete safeVariant.compareAtPrice;
    delete safeVariant.costPrice;
    return safeVariant;
  });
  return presented;
};

const presentProductsForCustomer = (products = []) => products.map(presentProductForCustomer);

module.exports = { presentProductForCustomer, presentProductsForCustomer };
