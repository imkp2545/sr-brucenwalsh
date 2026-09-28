const test = require('node:test');
const assert = require('node:assert/strict');
const { addCalendarMonths, calculateBuybackAmount, policyTerms } = require('../utils/buybackPolicyUtils');

test('buyback amount is fixed at 65 percent of the selected invoice quantity', () => {
  const calculation = calculateBuybackAmount(103000, 1, 2, 65);
  assert.deepEqual(calculation, { baseAmount: 51500, amount: 33475 });
});

test('buyback window uses calendar months and clamps month-end dates', () => {
  const deadline = addCalendarMonths(new Date('2025-02-28T10:30:00.000Z'), 12);
  assert.equal(deadline.toISOString(), '2026-02-28T10:30:00.000Z');

  const clamped = addCalendarMonths(new Date('2025-01-31T10:30:00.000Z'), 1);
  assert.equal(clamped.toISOString(), '2025-02-28T10:30:00.000Z');
});

test('invalid policy environment values fall back to contractual defaults', () => {
  const previousRate = process.env.BUYBACK_RATE_PERCENT;
  const previousWindow = process.env.BUYBACK_WINDOW_MONTHS;
  process.env.BUYBACK_RATE_PERCENT = '0';
  process.env.BUYBACK_WINDOW_MONTHS = 'invalid';
  assert.equal(policyTerms().ratePercent, 65);
  assert.equal(policyTerms().windowMonths, 12);
  if (previousRate === undefined) delete process.env.BUYBACK_RATE_PERCENT;
  else process.env.BUYBACK_RATE_PERCENT = previousRate;
  if (previousWindow === undefined) delete process.env.BUYBACK_WINDOW_MONTHS;
  else process.env.BUYBACK_WINDOW_MONTHS = previousWindow;
});
