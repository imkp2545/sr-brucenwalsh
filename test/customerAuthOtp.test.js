const assert = require('node:assert/strict');
const test = require('node:test');
const User = require('../models/userModel');
const { hashToken } = require('../utils/cryptoUtils');
const {
  CUSTOMER_AUTH_OTP_TTL_MS,
  CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS,
  createCustomerAuthOtp,
  isValidCustomerEmail,
  isValidCustomerOtp,
  normalizeCustomerEmail,
  secondsUntil,
} = require('../utils/customerAuthOtp');

test('customer authentication OTPs are persisted only as hashes', () => {
  const now = Date.UTC(2026, 7, 12, 12, 0, 0);
  const challenge = createCustomerAuthOtp(now);

  assert.match(challenge.otp, /^\d{6}$/);
  assert.equal(challenge.otpHash, hashToken(challenge.otp));
  assert.notEqual(challenge.otpHash, challenge.otp);
  assert.equal(challenge.expiresAt.getTime(), now + CUSTOMER_AUTH_OTP_TTL_MS);
  assert.equal(
    challenge.resendAvailableAt.getTime(),
    now + CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS,
  );
});

test('customer email normalization prevents casing-based duplicate accounts', () => {
  assert.equal(normalizeCustomerEmail('  Test@Example.COM '), 'test@example.com');
  assert.equal(isValidCustomerEmail('Test@Example.COM'), true);
  assert.equal(isValidCustomerEmail('not-an-email'), false);
});

test('customer OTP validation accepts exactly six digits', () => {
  assert.equal(isValidCustomerOtp('123456'), true);
  assert.equal(isValidCustomerOtp('12345'), false);
  assert.equal(isValidCustomerOtp('1234567'), false);
  assert.equal(isValidCustomerOtp('12A456'), false);
});

test('OTP cooldown reports the remaining whole seconds', () => {
  const now = Date.UTC(2026, 7, 12, 12, 0, 0);
  assert.equal(secondsUntil(new Date(now + 29_100), now), 30);
  assert.equal(secondsUntil(new Date(now - 1), now), 0);
});

test('customer model supports passwordless accounts without weakening legacy passwords', async () => {
  const passwordlessUser = new User({
    email: 'new.customer@example.com',
    authProvider: 'emailOtp',
    isEmailVerified: true,
  });
  await passwordlessUser.validate();
  assert.equal(passwordlessUser.email, 'new.customer@example.com');
  assert.equal(passwordlessUser.password, undefined);
  assert.equal(passwordlessUser.profileCompleted, false);

  const legacyUser = new User({
    firstName: 'Existing',
    lastName: 'Customer',
    email: 'Existing.Customer@Example.com',
    password: 'Legacy#Password1',
  });
  await legacyUser.validate();
  assert.equal(legacyUser.email, 'existing.customer@example.com');
  assert.equal(legacyUser.password, 'Legacy#Password1');
});
