const AppError = require('./appError');

const isPdfBuffer = (value) => Buffer.isBuffer(value)
  && value.length >= 5
  && value.subarray(0, 5).toString('ascii') === '%PDF-';

const shippingLabelPdfBuffer = (value) => {
  let buffer;
  if (Buffer.isBuffer(value)) buffer = value;
  else if (Array.isArray(value)) buffer = Buffer.from(value);
  else if (Array.isArray(value?.data)) buffer = Buffer.from(value.data);
  else if (typeof value === 'string') {
    const content = value.replace(/^data:application\/pdf;base64,/i, '').trim();
    buffer = content.startsWith('%PDF-') ? Buffer.from(content, 'binary') : Buffer.from(content, 'base64');
  }
  if (!isPdfBuffer(buffer)) {
    throw new AppError('Blue Dart returned an invalid PDF shipping label', 502, 'INVALID_SHIPPING_LABEL');
  }
  return buffer;
};

module.exports = { isPdfBuffer, shippingLabelPdfBuffer };
