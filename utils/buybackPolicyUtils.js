const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const addCalendarMonths = (value, months) => {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) throw new TypeError('A valid policy start date is required');
  const result = new Date(source);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + Number(months));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
};

const policyTerms = () => {
  const configuredRate = Number(process.env.BUYBACK_RATE_PERCENT ?? 65);
  const configuredWindow = Number(process.env.BUYBACK_WINDOW_MONTHS ?? 12);
  return {
    ratePercent: Number.isFinite(configuredRate) && configuredRate > 0 && configuredRate <= 100
      ? configuredRate
      : 65,
    windowMonths: Number.isInteger(configuredWindow) && configuredWindow > 0 && configuredWindow <= 120
      ? configuredWindow
      : 12,
    policyVersion: String(process.env.BUYBACK_POLICY_VERSION || '2026-01').trim().slice(0, 40),
  };
};

const calculateBuybackAmount = (invoiceAmount, quantity, purchasedQuantity, ratePercent) => {
  const amount = Number(invoiceAmount);
  const requestedQuantity = Number(quantity);
  const totalQuantity = Number(purchasedQuantity);
  const rate = Number(ratePercent);
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError('Valid invoice amount is required');
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) throw new TypeError('Valid buyback quantity is required');
  if (!Number.isInteger(totalQuantity) || totalQuantity < requestedQuantity) throw new TypeError('Invalid purchased quantity');
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new TypeError('Valid buyback rate is required');
  const baseAmount = roundCurrency((amount / totalQuantity) * requestedQuantity);
  return { baseAmount, amount: roundCurrency(baseAmount * rate / 100) };
};

module.exports = { addCalendarMonths, calculateBuybackAmount, policyTerms, roundCurrency };
