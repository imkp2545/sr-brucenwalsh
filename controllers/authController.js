const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const CustomerAuthOtp = require('../models/customerAuthOtpModel');
const AuditLog = require('../models/auditLogModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/generateToken');
const { generateOtp, hashToken, safeCompare } = require('../utils/cryptoUtils');
const { getEmailTransport, getFromAddress, logSmtpError } = require('../utils/emailTransport');
const {
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
} = require('../utils/customerAuthOtp');
const {
  PASSWORD_RESET_OTP_MAX_ATTEMPTS,
  createPasswordResetOtp,
  canSendPasswordResetOtp,
  isValidPasswordResetOtp,
} = require('../utils/passwordResetOtp');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;
const VERIFICATION_OTP_TTL = 10 * 60 * 1000;

const escapeHtml = (value) =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);

const sendEmail = async ({ to, subject, text, html }) => {
  try {
    return await getEmailTransport().sendMail({
      from: getFromAddress(),
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    // Keep provider diagnostics useful without writing recipients, message bodies,
    // OTPs, or credentials into logs. Never report a failed delivery as success.
    logSmtpError('Authentication email delivery failed', error);
    throw new AppError(
      'Email delivery is temporarily unavailable. Please try again later.',
      503,
      'EMAIL_DELIVERY_FAILED',
    );
  }
};

const sendVerificationEmail = async (user, otp) => {
  const name = escapeHtml(user.firstName);
  const safeOtp = escapeHtml(otp);
  await sendEmail({
    to: user.email,
    subject: 'Verify your Bruce & Walsh Luxury account',
    text: `Hello ${user.firstName}, your Bruce & Walsh Luxury verification OTP is ${otp}. This code expires in 10 minutes.`,
    html: `<p>Hello ${name},</p><p>Welcome to Bruce & Walsh Luxury.</p><p>Your verification OTP is <strong>${safeOtp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  });
};

const sendCustomerAuthenticationEmail = async (email, otp) => {
  const safeOtp = escapeHtml(otp);
  const validityMinutes = Math.ceil(CUSTOMER_AUTH_OTP_TTL_MS / 60_000);
  await sendEmail({
    to: email,
    subject: 'Your Bruce & Walsh Luxury verification code',
    text: `Your Bruce & Walsh Luxury verification code is ${otp}. This code expires in ${validityMinutes} minutes. If you did not request this code, you can ignore this email.`,
    html: `<p>Welcome to Bruce & Walsh Luxury.</p><p>Use this one-time code to continue:</p><p style="font-size:28px;letter-spacing:6px"><strong>${safeOtp}</strong></p><p>This code expires in ${validityMinutes} minutes and can be used only once.</p><p>If you did not request this code, you can ignore this email.</p>`,
  });
};

const sendPasswordResetEmail = async (user, otp) => {
  const safeOtp = escapeHtml(otp);
  await sendEmail({
    to: user.email,
    subject: 'Your Bruce & Walsh Luxury password reset code',
    text: `Hello ${user.firstName}, your password reset OTP is ${otp}. This code expires in 10 minutes. Never share this code.`,
    html: `<p>Hello ${escapeHtml(user.firstName)},</p><p>Use this one-time code to reset your Bruce & Walsh Luxury password:</p><p style="font-size:24px;letter-spacing:4px"><strong>${safeOtp}</strong></p><p>This code expires in 10 minutes and can be used only once. Never share it with anyone. If you did not request a password reset, no action is required.</p>`,
  });
};

const writeAudit = async (req, values) => {
  try {
    await AuditLog.create({
      actorType: values.actorType || 'user',
      actor: values.actor || null,
      actorModel: values.actor ? (values.actorType === 'admin' ? 'Admin' : 'User') : null,
      actorEmail: values.actorEmail,
      action: values.action,
      resourceType: values.resourceType || 'User',
      resourceId: values.resourceId || null,
      description: values.description,
      outcome: values.outcome || 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      route: req.originalUrl,
      method: req.method,
      statusCode: values.statusCode,
    });
  } catch (error) {
    console.error('Audit log write failed', error.message);
  }
};

const validatePassword = (password) => {
  if (!PASSWORD_PATTERN.test(password || '')) {
    throw new AppError(
      'Password must be 8-128 characters and include uppercase, lowercase, number, and special character',
      422,
      'WEAK_PASSWORD',
    );
  }
};

const customerAccessTokenExpiresIn = () => process.env.CUSTOMER_JWT_ACCESS_EXPIRES_IN || '7d';

const issueCustomerSession = async (user, req) => {
  const tokenId = crypto.randomUUID();
  const refreshToken = generateRefreshToken(user, tokenId);
  const refreshPayload = jwt.decode(refreshToken);
  const accessTokenExpiresIn = customerAccessTokenExpiresIn();
  const now = new Date();

  user.refreshTokens = (user.refreshTokens || []).filter(
    (entry) => !entry.revokedAt && entry.expiresAt > now,
  );
  user.refreshTokens.push({
    tokenHash: hashToken(refreshToken),
    tokenId,
    userAgent: req.get('user-agent'),
    ipAddress: req.ip,
    expiresAt: new Date(refreshPayload.exp * 1000),
  });
  if (user.refreshTokens.length > 10) user.refreshTokens = user.refreshTokens.slice(-10);
  await user.save({ validateBeforeSave: false });

  const accessToken = generateAccessToken(user, { expiresIn: accessTokenExpiresIn });
  const accessPayload = jwt.decode(accessToken);
  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenExpiresIn,
    accessTokenExpiresAt: new Date(accessPayload.exp * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(refreshPayload.exp * 1000).toISOString(),
  };
};

const requestOtp = asyncHandler(async (req, res) => {
  const email = normalizeCustomerEmail(req.body.email);
  if (!isValidCustomerEmail(email)) {
    throw new AppError('Enter a valid email address', 422, 'INVALID_EMAIL');
  }

  const now = Date.now();
  const existingChallenge = await CustomerAuthOtp.findOne({ email }).select('+consumedAt');
  if (existingChallenge?.resendAvailableAt > new Date(now)) {
    throw new AppError(
      'Please wait before requesting another code',
      429,
      'OTP_RESEND_COOLDOWN',
      { retryAfterSeconds: secondsUntil(existingChallenge.resendAvailableAt, now) },
    );
  }

  const requestWindowActive = Boolean(
    existingChallenge?.requestWindowStartedAt &&
      now - existingChallenge.requestWindowStartedAt.getTime() <
        CUSTOMER_AUTH_OTP_REQUEST_WINDOW_MS,
  );
  if (
    requestWindowActive &&
    existingChallenge.requestCount >= CUSTOMER_AUTH_OTP_MAX_REQUESTS_PER_WINDOW
  ) {
    const retryAt =
      existingChallenge.requestWindowStartedAt.getTime() + CUSTOMER_AUTH_OTP_REQUEST_WINDOW_MS;
    throw new AppError(
      'Too many codes have been requested for this email. Please try again later.',
      429,
      'OTP_RATE_LIMITED',
      { retryAfterSeconds: secondsUntil(retryAt, now) },
    );
  }

  const otpChallenge = createCustomerAuthOtp(now);
  let savedChallenge;
  try {
    if (existingChallenge) {
      const update = {
        $set: {
          otpHash: otpChallenge.otpHash,
          expiresAt: otpChallenge.expiresAt,
          requestedAt: otpChallenge.requestedAt,
          resendAvailableAt: otpChallenge.resendAvailableAt,
          attempts: 0,
          consumedAt: null,
        },
      };
      if (requestWindowActive) update.$inc = { requestCount: 1 };
      else {
        update.$set.requestCount = 1;
        update.$set.requestWindowStartedAt = otpChallenge.requestedAt;
      }
      savedChallenge = await CustomerAuthOtp.findOneAndUpdate(
        {
          _id: existingChallenge._id,
          resendAvailableAt: { $lte: new Date(now) },
          ...(requestWindowActive
            ? { requestCount: { $lt: CUSTOMER_AUTH_OTP_MAX_REQUESTS_PER_WINDOW } }
            : {}),
        },
        update,
        { new: true },
      );
    } else {
      savedChallenge = await CustomerAuthOtp.create({
        email,
        otpHash: otpChallenge.otpHash,
        expiresAt: otpChallenge.expiresAt,
        requestedAt: otpChallenge.requestedAt,
        resendAvailableAt: otpChallenge.resendAvailableAt,
        requestWindowStartedAt: otpChallenge.requestedAt,
      });
    }
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  if (!savedChallenge) {
    const currentChallenge = await CustomerAuthOtp.findOne({ email });
    throw new AppError(
      'Please wait before requesting another code',
      429,
      'OTP_RESEND_COOLDOWN',
      {
        retryAfterSeconds: currentChallenge
          ? secondsUntil(currentChallenge.resendAvailableAt, now)
          : Math.ceil(CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS / 1000),
      },
    );
  }

  try {
    await sendCustomerAuthenticationEmail(email, otpChallenge.otp);
  } catch (error) {
    await CustomerAuthOtp.deleteOne({
      _id: savedChallenge._id,
      otpHash: otpChallenge.otpHash,
    }).catch(() => undefined);
    throw error;
  }

  return ApiResponse.success(res, {
    message: 'A 6-digit verification code has been sent to your email.',
    data: {
      expiresInSeconds: Math.ceil(CUSTOMER_AUTH_OTP_TTL_MS / 1000),
      resendAfterSeconds: Math.ceil(CUSTOMER_AUTH_OTP_RESEND_COOLDOWN_MS / 1000),
    },
  });
});

const verifyOtp = asyncHandler(async (req, res) => {
  const email = normalizeCustomerEmail(req.body.email);
  const otp = String(req.body.otp || '').trim();
  if (!isValidCustomerEmail(email)) {
    throw new AppError('Enter a valid email address', 422, 'INVALID_EMAIL');
  }
  if (!isValidCustomerOtp(otp)) {
    throw new AppError('Enter the 6-digit code from your email', 422, 'INVALID_OTP');
  }

  const now = new Date();
  const challenge = await CustomerAuthOtp.findOne({ email }).select('+otpHash +consumedAt');
  if (!challenge || challenge.consumedAt) {
    throw new AppError('This verification code is invalid or has already been used', 400, 'INVALID_OTP');
  }
  if (challenge.expiresAt <= now) {
    await CustomerAuthOtp.deleteOne({ _id: challenge._id });
    throw new AppError('This verification code has expired. Request a new code.', 400, 'OTP_EXPIRED');
  }
  if (challenge.attempts >= CUSTOMER_AUTH_OTP_MAX_ATTEMPTS) {
    await CustomerAuthOtp.deleteOne({ _id: challenge._id });
    throw new AppError(
      'Too many incorrect attempts. Request a new code.',
      429,
      'TOO_MANY_OTP_ATTEMPTS',
    );
  }

  const submittedOtpHash = hashToken(otp);
  if (!safeCompare(challenge.otpHash, submittedOtpHash)) {
    const updatedChallenge = await CustomerAuthOtp.findOneAndUpdate(
      {
        _id: challenge._id,
        consumedAt: null,
        expiresAt: { $gt: now },
        attempts: { $lt: CUSTOMER_AUTH_OTP_MAX_ATTEMPTS },
      },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    if (!updatedChallenge || updatedChallenge.attempts >= CUSTOMER_AUTH_OTP_MAX_ATTEMPTS) {
      await CustomerAuthOtp.deleteOne({ _id: challenge._id });
      throw new AppError(
        'Too many incorrect attempts. Request a new code.',
        429,
        'TOO_MANY_OTP_ATTEMPTS',
      );
    }
    throw new AppError('The verification code is incorrect', 400, 'INVALID_OTP', {
      attemptsRemaining: CUSTOMER_AUTH_OTP_MAX_ATTEMPTS - updatedChallenge.attempts,
    });
  }

  const consumedChallenge = await CustomerAuthOtp.findOneAndUpdate(
    {
      _id: challenge._id,
      otpHash: submittedOtpHash,
      consumedAt: null,
      expiresAt: { $gt: now },
      attempts: { $lt: CUSTOMER_AUTH_OTP_MAX_ATTEMPTS },
    },
    { $set: { consumedAt: now }, $unset: { otpHash: 1 } },
    { new: false },
  );
  if (!consumedChallenge) {
    throw new AppError('This verification code is invalid or has already been used', 400, 'INVALID_OTP');
  }

  let user = await User.findOne({ email }).select('+refreshTokens +refreshTokens.tokenHash');
  const isNewUser = !user;
  if (!user) {
    try {
      user = await User.create({
        email,
        firstName: '',
        lastName: '',
        isEmailVerified: true,
        emailVerifiedAt: now,
        profileCompleted: false,
        authProvider: 'emailOtp',
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ email }).select('+refreshTokens +refreshTokens.tokenHash');
    }
  }

  if (!user || user.status !== 'active' || user.deletedAt) {
    throw new AppError('This account is not available', 403, 'ACCOUNT_DISABLED');
  }

  user.isEmailVerified = true;
  user.emailVerifiedAt ||= now;
  if (user.firstName?.trim() && user.lastName?.trim()) user.profileCompleted = true;
  user.lastLoginAt = now;
  user.lastLoginIp = req.ip;
  const tokens = await issueCustomerSession(user, req);

  await writeAudit(req, {
    actor: user._id,
    actorEmail: user.email,
    action: isNewUser ? 'create' : 'login',
    resourceId: user._id,
    description: isNewUser
      ? 'Customer account created after email OTP verification'
      : 'Customer signed in with email OTP',
    statusCode: isNewUser ? 201 : 200,
  });

  return ApiResponse.success(res, {
    statusCode: isNewUser ? 201 : 200,
    message: isNewUser ? 'Account created successfully' : 'Signed in successfully',
    data: {
      isNewUser,
      profileCompleted: Boolean(user.profileCompleted),
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        profileCompleted: Boolean(user.profileCompleted),
      },
      ...tokens,
    },
  });
});

const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password } = req.body;
  if (!firstName || !lastName || !email || !password) {
    throw new AppError('First name, last name, email, and password are required', 422, 'VALIDATION_ERROR');
  }
  if (!EMAIL_PATTERN.test(String(email).trim())) throw new AppError('A valid email is required', 422, 'INVALID_EMAIL');
  validatePassword(password);

  const normalizedEmail = String(email).trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) {
    throw new AppError('An account already exists with this email', 409, 'EMAIL_ALREADY_REGISTERED');
  }

  const otp = generateOtp();
  const user = await User.create({
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    email: normalizedEmail,
    phone: phone ? String(phone).trim() : undefined,
    password,
    emailVerificationOtpHash: hashToken(otp),
    emailVerificationOtpExpiresAt: new Date(Date.now() + VERIFICATION_OTP_TTL),
  });

  await sendVerificationEmail(user, otp);
  await writeAudit(req, {
    actor: user._id,
    actorEmail: user.email,
    action: 'create',
    resourceId: user._id,
    description: 'Customer account registered',
    statusCode: 201,
  });

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Registration successful. Please verify your email with the OTP sent to your inbox before signing in.',
    data: { id: user._id, email: user.email },
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const email = String(req.body.email || req.query.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || req.query.otp || '').trim();
  if (!EMAIL_PATTERN.test(email)) throw new AppError('A valid email is required', 422, 'INVALID_EMAIL');
  if (!/^\d{4,10}$/.test(otp)) throw new AppError('A valid verification OTP is required', 422, 'OTP_REQUIRED');

  const user = await User.findOne({
    email,
    emailVerificationOtpHash: hashToken(otp),
    emailVerificationOtpExpiresAt: { $gt: new Date() },
    status: { $ne: 'deleted' },
  }).select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');

  if (!user) throw new AppError('Verification OTP is invalid or expired', 400, 'INVALID_VERIFICATION_OTP');

  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();
  user.emailVerificationOtpHash = undefined;
  user.emailVerificationOtpExpiresAt = undefined;
  await user.save({ validateBeforeSave: false });
  await writeAudit(req, {
    actor: user._id, actorEmail: user.email, action: 'verify', resourceId: user._id,
    description: 'Customer email verified', statusCode: 200,
  });

  return ApiResponse.success(res, { message: 'Email verified successfully. You can now sign in.' });
});

const resendVerification = asyncHandler(async (req, res) => {
  const normalizedEmail = String(req.body.email || '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(normalizedEmail)) {
    const user = await User.findOne({ email: normalizedEmail, isEmailVerified: false, status: 'active' })
      .select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');
    if (user) {
      const otp = generateOtp();
      user.emailVerificationOtpHash = hashToken(otp);
      user.emailVerificationOtpExpiresAt = new Date(Date.now() + VERIFICATION_OTP_TTL);
      await user.save({ validateBeforeSave: false });
      await sendVerificationEmail(user, otp);
    }
  }
  return ApiResponse.success(res, {
    message: 'If an unverified account exists, a new verification OTP has been sent.',
  });
});

const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;
  if (!email || !password) throw new AppError('Email and password are required', 422, 'VALIDATION_ERROR');

  const user = await User.findOne({ email }).select(
    '+password +failedLoginAttempts +lockUntil +refreshTokens +refreshTokens.tokenHash',
  );

  if (!user || !(await user.comparePassword(password))) {
    if (user) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save({ validateBeforeSave: false });
    }
    await writeAudit(req, {
      actorEmail: email, action: 'loginFailed', description: 'Customer login failed', outcome: 'failure', statusCode: 401,
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new AppError('Account is temporarily locked. Please try again later.', 423, 'ACCOUNT_LOCKED');
  }
  if (user.status !== 'active') throw new AppError('This account is not active', 403, 'ACCOUNT_INACTIVE');
  if (!user.isEmailVerified) throw new AppError('Verify your email before signing in', 403, 'EMAIL_NOT_VERIFIED');

  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  const tokens = await issueCustomerSession(user, req);
  await writeAudit(req, {
    actor: user._id, actorEmail: user.email, action: 'login', resourceId: user._id,
    description: 'Customer signed in', statusCode: 200,
  });

  return ApiResponse.success(res, {
    message: 'Signed in successfully',
    data: {
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role },
      ...tokens,
    },
  });
});

const refreshSession = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) throw new AppError('Refresh token is required', 401, 'REFRESH_TOKEN_REQUIRED');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }


  const user = await User.findById(payload.sub).select('+refreshTokens +refreshTokens.tokenHash');
  if (!user || user.status !== 'active' || !user.isEmailVerified) {
    throw new AppError('Refresh token is no longer valid', 401, 'INVALID_REFRESH_TOKEN');
  }

  const tokenHash = hashToken(refreshToken);
  const storedToken = user.refreshTokens.find(
    (entry) => entry.tokenId === payload.jti && entry.tokenHash === tokenHash && !entry.revokedAt && entry.expiresAt > new Date(),
  );
  if (!storedToken) throw new AppError('Refresh token is no longer valid', 401, 'INVALID_REFRESH_TOKEN');

  storedToken.revokedAt = new Date();
  const tokens = await issueCustomerSession(user, req);
  return ApiResponse.success(res, { message: 'Session refreshed', data: tokens });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = await User.findById(payload.sub).select('+refreshTokens +refreshTokens.tokenHash');
      const storedToken = user?.refreshTokens.find((entry) => entry.tokenId === payload.jti);
      if (storedToken) {
        storedToken.revokedAt = new Date();
        await user.save({ validateBeforeSave: false });
      }
    } catch (_error) {
      // Logout remains idempotent for missing, expired, or malformed tokens.
    }
  }
  return ApiResponse.success(res, { message: 'Signed out successfully' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = EMAIL_PATTERN.test(email)
    ? await User.findOne({ email, status: 'active' }).select(
      '+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts +passwordResetOtpSentAt',
    )
    : null;

  if (user && canSendPasswordResetOtp(user.passwordResetOtpSentAt)) {
    const challenge = createPasswordResetOtp();
    user.passwordResetOtpHash = challenge.otpHash;
    user.passwordResetOtpExpiresAt = challenge.expiresAt;
    user.passwordResetOtpAttempts = 0;
    user.passwordResetOtpSentAt = challenge.sentAt;
    await user.save({ validateBeforeSave: false });
    try {
      await sendPasswordResetEmail(user, challenge.otp);
    } catch (error) {
      console.error('Customer password reset OTP email failed', error.message);
    }
  }
  return ApiResponse.success(res, {
    message: 'If the account exists, a 6-digit password reset code has been sent.',
    data: { expiresInSeconds: 600, resendAfterSeconds: 60 },
  });
});

const resetPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  const { password } = req.body;
  if (!EMAIL_PATTERN.test(email) || !isValidPasswordResetOtp(otp)) {
    throw new AppError('A valid email and 6-digit OTP are required', 422, 'INVALID_RESET_OTP');
  }
  validatePassword(password);

  const now = new Date();
  const challengeFilter = {
    email,
    status: 'active',
    passwordResetOtpHash: hashToken(otp),
    passwordResetOtpExpiresAt: { $gt: now },
    passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
  };
  const user = await User.findOneAndUpdate(
    challengeFilter,
    {
      $unset: {
        passwordResetOtpHash: 1,
        passwordResetOtpExpiresAt: 1,
        passwordResetOtpAttempts: 1,
        passwordResetOtpSentAt: 1,
      },
    },
    { new: true },
  ).select('+password +refreshTokens +failedLoginAttempts +lockUntil');

  if (!user) {
    await User.updateOne(
      {
        email,
        status: 'active',
        passwordResetOtpExpiresAt: { $gt: now },
        passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
      },
      { $inc: { passwordResetOtpAttempts: 1 } },
    );
    throw new AppError(
      'The email or OTP is invalid, expired, or has reached its attempt limit',
      400,
      'INVALID_RESET_OTP',
    );
  }

  user.password = password;
  user.refreshTokens = [];
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();
  await writeAudit(req, {
    actor: user._id, actorEmail: user.email, action: 'update', resourceId: user._id,
    description: 'Customer password reset', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Password reset successfully. Please sign in again.' });
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.user.id, status: { $ne: 'deleted' } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (!user.profileCompleted && user.firstName?.trim() && user.lastName?.trim()) {
    user.profileCompleted = true;
    await user.save({ validateBeforeSave: false });
  }
  return ApiResponse.success(res, { data: user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'phone', 'gender', 'dateOfBirth', 'notificationPreferences'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  for (const field of ['firstName', 'lastName']) {
    if (updates[field] !== undefined) {
      updates[field] = String(updates[field]).trim();
      if (!updates[field]) {
        throw new AppError(`${field === 'firstName' ? 'First' : 'Last'} name is required`, 422, 'VALIDATION_ERROR');
      }
    }
  }
  const user = await User.findOneAndUpdate(
    { _id: req.user.id, status: { $ne: 'deleted' } },
    { $set: updates },
    { new: true, runValidators: true },
  );
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.firstName?.trim() && user.lastName?.trim() && !user.profileCompleted) {
    user.profileCompleted = true;
    await user.save({ validateBeforeSave: false });
  }
  return ApiResponse.success(res, { message: 'Profile updated', data: user });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword) throw new AppError('Current password is required', 422, 'VALIDATION_ERROR');
  validatePassword(newPassword);
  const user = await User.findById(req.user.id).select('+password +refreshTokens');
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
  }
  user.password = newPassword;
  user.refreshTokens = [];
  await user.save();
  return ApiResponse.success(res, { message: 'Password changed. Please sign in again.' });
});

const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  const required = ['recipientName', 'phone', 'line1', 'city', 'state', 'postalCode'];
  if (required.some((key) => !req.body[key])) throw new AppError('Complete address details are required', 422, 'VALIDATION_ERROR');
  if (req.body.isDefault || user.addresses.length === 0) user.addresses.forEach((address) => { address.isDefault = false; });
  user.addresses.push(req.body);
  await user.save();
  return ApiResponse.success(res, { statusCode: 201, message: 'Address added', data: user.addresses.at(-1) });
});

const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  const address = user?.addresses.id(req.params.addressId);
  if (!address) throw new AppError('Address not found', 404, 'ADDRESS_NOT_FOUND');
  const allowed = ['label', 'recipientName', 'phone', 'line1', 'line2', 'landmark', 'city', 'state', 'postalCode', 'country', 'addressType', 'isDefault'];
  if (req.body.isDefault) user.addresses.forEach((item) => { item.isDefault = false; });
  allowed.forEach((key) => { if (req.body[key] !== undefined) address[key] = req.body[key]; });
  await user.save();
  return ApiResponse.success(res, { message: 'Address updated', data: address });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  const address = user?.addresses.id(req.params.addressId);
  if (!address) throw new AppError('Address not found', 404, 'ADDRESS_NOT_FOUND');
  const wasDefault = address.isDefault;
  address.deleteOne();
  if (wasDefault && user.addresses.length) user.addresses[0].isDefault = true;
  await user.save();
  return ApiResponse.success(res, { message: 'Address removed' });
});

module.exports = {
  requestOtp,
  verifyOtp,
  register,
  verifyEmail,
  resendVerification,
  login,
  refreshSession,
  logout,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  addAddress,
  updateAddress,
  deleteAddress,
};
