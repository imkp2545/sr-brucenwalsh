const crypto = require('crypto');

const generateSecureToken = (byteLength = 32) => crypto.randomBytes(byteLength).toString('hex');

const hashToken = (token) => {
  if (!token || typeof token !== 'string') throw new TypeError('A token string is required');
  return crypto.createHash('sha256').update(token).digest('hex');
};

const safeCompare = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const generateOtp = (digits = 6) => {
  if (!Number.isInteger(digits) || digits < 4 || digits > 10) {
    throw new RangeError('OTP digits must be an integer between 4 and 10');
  }
  const minimum = 10 ** (digits - 1);
  return String(crypto.randomInt(minimum, 10 ** digits));
};

module.exports = { generateSecureToken, hashToken, safeCompare, generateOtp };
