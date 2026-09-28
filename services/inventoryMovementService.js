const InventoryMovement = require('../models/inventoryMovementModel');

const idString = (value) => (value ? String(value) : null);

const variantFrom = (product, variantId) => {
  if (!variantId) return null;
  return (product.variants || []).find((variant) => idString(variant._id) === idString(variantId)) || null;
};

const stockSnapshot = (product, variantId) => {
  const variant = variantFrom(product, variantId);
  return {
    product: product._id,
    variantId: variant?._id || null,
    sku: variant?.sku || product.sku,
    productName: product.name,
    variantName: variant?.name || variant?.attributes?.map((item) => `${item.name}: ${item.value}`).join(', ') || undefined,
    stock: Number(variant?.stock ?? product.stock ?? 0),
    reservedStock: Number(variant?.reservedStock ?? product.reservedStock ?? 0),
  };
};

const recordInventoryMovement = async ({
  product,
  variantId = null,
  type,
  source,
  quantityBefore,
  quantityAfter,
  reservedBefore,
  reservedAfter,
  reason,
  note,
  actor,
  reference,
  session,
}) => {
  const snapshot = stockSnapshot(product, variantId);
  const movement = {
    product: snapshot.product,
    variantId: snapshot.variantId,
    sku: snapshot.sku,
    productName: snapshot.productName,
    variantName: snapshot.variantName,
    type,
    source,
    quantityBefore,
    quantityAfter,
    reservedBefore: reservedBefore ?? snapshot.reservedStock,
    reservedAfter: reservedAfter ?? snapshot.reservedStock,
    delta: Number(quantityAfter) - Number(quantityBefore),
    reason,
    note,
    actor: actor || null,
    referenceModel: reference?.model,
    referenceId: reference?.id,
    referenceLabel: reference?.label,
  };
  const [created] = await InventoryMovement.create([movement], { session });
  return created;
};

module.exports = { recordInventoryMovement, stockSnapshot };
