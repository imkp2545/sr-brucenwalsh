const test = require('node:test');
const assert = require('node:assert/strict');
const { shippingLabelPdfBuffer } = require('../utils/shippingLabelUtils');

const samplePdf = Buffer.from('%PDF-1.7\nlabel');

test('accepts Blue Dart PDF byte arrays', () => {
  assert.deepEqual(shippingLabelPdfBuffer([...samplePdf]), samplePdf);
});

test('accepts Base64 PDF labels', () => {
  assert.deepEqual(shippingLabelPdfBuffer(samplePdf.toString('base64')), samplePdf);
});

test('rejects corrupted label content', () => {
  assert.throws(() => shippingLabelPdfBuffer([1, 2, 3]), /invalid PDF/i);
});
