const crypto = require('crypto');

const datePart = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const generateReferenceNumber = (prefix, date = new Date()) => {
  const safePrefix = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!safePrefix) throw new TypeError('Reference prefix is required');
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${safePrefix}-${datePart(date)}-${random}`;
};

// HDFC requires IDs under 21 characters with only alphanumeric characters.
const generateHdfcOrderId = () => {
  const random = BigInt(`0x${crypto.randomBytes(10).toString('hex')}`)
    .toString(36)
    .toUpperCase()
    .padStart(16, '0');
  return `BWP${random}`;
};

const generateOrderNumber = () => generateReferenceNumber('BWL');
const generateAppointmentNumber = () => generateReferenceNumber('APT');

module.exports = {
  generateReferenceNumber,
  generateHdfcOrderId,
  generateOrderNumber,
  generateAppointmentNumber,
};
