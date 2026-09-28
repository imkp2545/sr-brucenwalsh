const { generateOtp, hashToken } = require("./cryptoUtils");

const PASSWORD_RESET_OTP_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_OTP_PATTERN = /^\d{6}$/;

const createPasswordResetOtp = (now = Date.now()) => {
  const otp = generateOtp(6);
  return {
    otp,
    otpHash: hashToken(otp),
    expiresAt: new Date(now + PASSWORD_RESET_OTP_TTL_MS),
    sentAt: new Date(now),
  };
};

const canSendPasswordResetOtp = (lastSentAt, now = Date.now()) =>
  !lastSentAt ||
  now - new Date(lastSentAt).getTime() >= PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS;

const isValidPasswordResetOtp = (otp) =>
  PASSWORD_RESET_OTP_PATTERN.test(String(otp || "").trim());

module.exports = {
  PASSWORD_RESET_OTP_TTL_MS,
  PASSWORD_RESET_OTP_RESEND_COOLDOWN_MS,
  PASSWORD_RESET_OTP_MAX_ATTEMPTS,
  createPasswordResetOtp,
  canSendPasswordResetOtp,
  isValidPasswordResetOtp,
};
