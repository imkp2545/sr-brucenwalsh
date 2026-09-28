const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Buyback = require('../models/buybackModel');

const validBuyback = () => ({
  buybackNumber: 'BBK-20260720-1234567890',
  user: new mongoose.Types.ObjectId(),
  order: new mongoose.Types.ObjectId(),
  product: new mongoose.Types.ObjectId(),
  orderItemId: new mongoose.Types.ObjectId(),
  itemSnapshot: {
    sku: 'BW-RNG-001', name: 'Diamond Ring', quantity: 1, purchasedQuantity: 1,
    unitPrice: 100000, taxableAmount: 100000, invoiceLineTotal: 103000, buybackBaseAmount: 103000,
  },
  policy: {
    ratePercent: 65, windowMonths: 12, version: '2026-01', estimatedAmount: 66950,
    purchaseDate: new Date('2026-07-20T00:00:00.000Z'),
    eligibilityDeadline: new Date('2027-07-20T00:00:00.000Z'), invoiceNumber: 'INV000001',
  },
  igiCertificateNumber: 'IGI-123456',
  declarations: {
    jewellerySameCondition: true, originalIgiCertificateAvailable: true,
    originalInvoiceAvailable: true, policyAccepted: true, acceptedAt: new Date(),
  },
  appointment: {
    preferredSlots: [{ start: new Date('2026-08-01T10:00:00.000Z'), end: new Date('2026-08-01T11:00:00.000Z') }],
  },
  statusHistory: [{ status: 'requested', changedByType: 'user' }],
});

test('buyback model stores the policy snapshot and shop workflow', async () => {
  const buyback = new Buyback(validBuyback());
  await buyback.validate();
  assert.equal(buyback.status, 'requested');
  assert.equal(buyback.policy.ratePercent, 65);
  assert.equal(buyback.appointment.preferredSlots.length, 1);
});

test('buyback model rejects an invalid scheduled shop visit', async () => {
  const data = validBuyback();
  data.appointment.scheduledStart = new Date('2026-08-01T11:00:00.000Z');
  data.appointment.scheduledEnd = new Date('2026-08-01T10:00:00.000Z');
  await assert.rejects(new Buyback(data).validate(), /end must be after/i);
});
