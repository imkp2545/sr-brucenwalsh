const { generateOtp, hashToken } = require('./cryptoUtils');

const numberFromEnvironment = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CUSTOMER_AUTH_OTP_TTL_MS =
  numberFromEnvironment('CUSTOMER_AUTH_OTP_TTL_SECONDS', 300) * 1000;
const CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS =
  numberFromEnvironment('CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_SECONDS', 30) * 1000;
const CUSTOMER_AUTH_OTP_MAX_ATTEMPTS = numberFromEnvironment(
  'CUSTOMER_AUTH_OTP_MAX_ATTEMPTS',
  5,
);
const CUSTOMER_AUTH_OTP_REQUEST_WINDOW_MS =
  numberFromEnvironment('CUSTOMER_AUTH_OTP_REQUEST_WINDOW_SECONDS', 3600) * 1000;
const CUSTOMER_AUTH_OTP_MAX_REQUESTS_PER_WINDOW = numberFromEnvironment(
  'CUSTOMER_AUTH_OTP_MAX_REQUESTS_PER_WINDOW',
  5,
);

const normalizeCustomerEmail = (value) => String(value || '').trim().toLowerCase();
const isValidCustomerEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeCustomerEmail(value));
const isValidCustomerOtp = (value) => /^\d{6}$/.test(String(value || '').trim());

const createCustomerAuthOtp = (now = Date.now()) => {
  const requestedAt = new Date(now);
  const otp = generateOtp(6);
  return {
    otp,
    otpHash: hashToken(otp),
    requestedAt,
    expiresAt: new Date(now + CUSTOMER_AUTH_OTP_TTL_MS),
    resendAvailableAt: new Date(now + CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS),
  };
};

const secondsUntil = (date, now = Date.now()) =>
  Math.max(0, Math.ceil((new Date(date).getTime() - now) / 1000));

module.exports = {
  CUSTOMER_AUTH_OTP_TTL_MS,
  CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS,
  CUSTOMER_AUTH_OTP_MAX_ATTEMPTS,
  CUSTOMER_AUTH_OTP_REQUEST_WINDOW_MS,
  CUSTOMER_AUTH_OTP_MAX_REQUESTS_PER_WINDOW,
  normalizeCustomerEmail,
  isValidCustomerEmail,
  isValidCustomerOtp,
  createCustomerAuthOtp,
  secondsUntil,
};
