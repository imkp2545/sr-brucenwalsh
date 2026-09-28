const test = require('node:test');
const assert = require('node:assert/strict');
const { amountInWords, generateInvoicePdf } = require('../utils/invoiceUtils');

const sampleOrder = () => ({
  orderNumber: 'BWL-20260718-TEST0001',
  invoiceNumber: 'INV-BWL-20260718-TEST0001',
  createdAt: new Date('2026-07-18T09:30:00.000Z'),
  paymentMethod: 'hdfcUpi',
  paymentStatus: 'paid',
  items: [
    {
      sku: 'BW-RNG-DIA-001',
      name: 'Celestial Diamond Solitaire Ring',
      attributes: [
        { name: 'Metal', value: '18K White Gold' },
        { name: 'Size', value: '14' },
      ],
      hsnCode: '71131930',
      quantity: 1,
      unitPrice: 25000,
      discount: 0,
      taxableAmount: 25000,
      cgstRate: 1.5,
      cgstAmount: 375,
      sgstRate: 1.5,
      sgstAmount: 375,
      taxAmount: 750,
      lineTotal: 25750,
    },
  ],
  billingAddress: {
    recipientName: 'Karan Sharma',
    phone: '9876543210',
    email: 'karan@example.com',
    line1: '12 Marine Drive',
    line2: 'Near Churchgate',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400020',
    country: 'India',
  },
  shippingAddress: {
    recipientName: 'Karan Sharma',
    phone: '9876543210',
    email: 'karan@example.com',
    line1: '12 Marine Drive',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400020',
    country: 'India',
  },
  subtotal: 25000,
  discount: 0,
  shippingCharge: 0,
  insuranceCharge: 0,
  cgst: 375,
  sgst: 375,
  tax: 750,
  roundOff: 0,
  grandTotal: 25750,
  metadata: new Map([['taxMode', 'exclusive']]),
});

const sampleInterStateOrder = () => {
  const order = sampleOrder();
  order.shippingAddress = {
    ...order.shippingAddress,
    city: 'Ahmedabad',
    state: 'Gujarat',
    postalCode: '380015',
  };
  order.billingAddress = { ...order.shippingAddress };
  order.items = order.items.map((item) => ({
    ...item,
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
    igstRate: 3,
    igstAmount: 750,
  }));
  order.cgst = 0;
  order.sgst = 0;
  order.igst = 750;
  order.taxMode = 'interState';
  order.placeOfSupplyState = 'Gujarat';
  order.supplierState = 'Maharashtra';
  order.metadata = new Map([
    ['billingVersion', 'state-based-gst-v2'],
    ['taxMode', 'interState'],
  ]);
  return order;
};

test('amountInWords formats Indian currency amounts', () => {
  assert.equal(
    amountInWords(25750),
    'INR Twenty Five Thousand Seven Hundred Fifty Rupees Only',
  );
  assert.equal(
    amountInWords(12345678.25),
    'INR One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Twenty Five Paise Only',
  );
});

test('generateInvoicePdf creates a branded PDF from order data', async () => {
  const buffer = await generateInvoicePdf(sampleOrder());

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 5000);
});

test('generateInvoicePdf renders the inter-state IGST layout', async () => {
  const buffer = await generateInvoicePdf(sampleInterStateOrder());

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 5000);
});
