const assert = require("node:assert/strict");
const test = require("node:test");
const { hashToken } = require("../utils/cryptoUtils");
const {
  PASSWORD_RESET_OTP_TTL_MS,
  PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS,
  createPasswordResetOtp,
  canSendPasswordResetOtp,
  isValidPasswordResetOtp,
} = require("../utils/passwordResetOtp");

test("password reset OTP challenges contain only a hash for persistence", () => {
  const now = Date.UTC(2026, 7, 8, 12, 0, 0);
  const challenge = createPasswordResetOtp(now);

  assert.match(challenge.otp, /^\d{6}$/);
  assert.equal(challenge.otpHash, hashToken(challenge.otp));
  assert.notEqual(challenge.otpHash, challenge.otp);
  assert.equal(challenge.expiresAt.getTime(), now + PASSWORD_RESET_OTP_TTL_MS);
  assert.equal(challenge.sentAt.getTime(), now);
});

test("password reset OTP validation accepts exactly six digits", () => {
  assert.equal(isValidPasswordResetOtp("123456"), true);
  assert.equal(isValidPasswordResetOtp("12345"), false);
  assert.equal(isValidPasswordResetOtp("1234567"), false);
  assert.equal(isValidPasswordResetOtp("12A456"), false);
});

test("password reset OTP resend cooldown is enforced", () => {
  const now = Date.UTC(2026, 7, 8, 12, 0, 0);
  assert.equal(canSendPasswordResetOtp(null, now), true);
  assert.equal(canSendPasswordResetOtp(new Date(now - 30_000), now), false);
  assert.equal(
    canSendPasswordResetOtp(
      new Date(now - PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS),
      now,
    ),
    true,
  );
});
