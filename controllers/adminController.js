const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Admin = require('../models/adminModel');
const User = require('../models/userModel');
const Order = require('../models/orderModel');
const Appointment = require('../models/appointmentModel');
const ReturnRequest = require('../models/returnModel');
const Buyback = require('../models/buybackModel');
const Wishlist = require('../models/wishlistModel');
const AuditLog = require('../models/auditLogModel');
const Setting = require('../models/settingModel');
const customerAnalyticsService = require('../services/customerAnalyticsService');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateAccessToken } = require('../utils/generateToken');
const { generateOtp, hashToken } = require('../utils/cryptoUtils');
const {
  PASSWORD_RESET_OTP_MAX_ATTEMPTS,
  createPasswordResetOtp,
  canSendPasswordResetOtp,
  isValidPasswordResetOtp,
} = require('../utils/passwordResetOtp');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;
const ADMIN_VERIFICATION_OTP_TTL = 10 * 60 * 1000;
const ADMIN_ROLES = ['superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'];

let mailTransport;

const getMailTransport = () => {
  if (mailTransport) return mailTransport;
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`);

  mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
  return mailTransport;
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);

const sendAdminEmail = async ({ to, subject, text, html }) => {
  try {
    return await getMailTransport().sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'Bruce & Walsh Luxury'}" <${process.env.SMTP_FROM_EMAIL}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `\n============================================================\n` +
        `⚠️  [DEV ADMIN EMAIL] SMTP send failed: ${error.message}\n` +
        `📬 To: ${to}\n` +
        `📝 Subject: ${subject}\n` +
        `💬 Message:\n${text}\n` +
        `============================================================\n`
      );
      return { messageId: 'dev-mock-admin-id', devFallback: true };
    }
    throw error;
  }
};

const sendAdminVerificationEmail = async (admin, otp) =>
  sendAdminEmail({
    to: admin.email,
    subject: 'Verify your Bruce & Walsh Luxury admin account',
    text: `Hello ${admin.firstName}, your admin approval OTP is ${otp}. Share this code with your Super Admin to activate your account. This code expires in 10 minutes.`,
    html: `<p>Hello ${escapeHtml(admin.firstName)},</p><p>Your Bruce & Walsh Luxury admin account has been created with the role <strong>${escapeHtml(admin.role)}</strong>.</p><p>Your approval OTP is <strong>${escapeHtml(otp)}</strong>.</p><p>Share this code with your Super Admin to activate your account. This code expires in 10 minutes. After Super Admin approval, you can sign in to the admin panel.</p>`,
  });

const sendAdminPasswordResetEmail = async (admin, otp) => {
  const safeOtp = escapeHtml(otp);
  return sendAdminEmail({
    to: admin.email,
    subject: 'Your Bruce & Walsh Luxury admin password reset code',
    text: `Hello ${admin.firstName}, your administration password reset OTP is ${otp}. This code expires in 10 minutes. Never share this code.`,
    html: `<p>Hello ${escapeHtml(admin.firstName)},</p><p>Use this one-time code to reset your Bruce & Walsh Luxury administration password:</p><p style="font-size:24px;letter-spacing:4px"><strong>${safeOtp}</strong></p><p>This code expires in 10 minutes and can be used only once. Never share it with anyone. If you did not request a password reset, no action is required.</p>`,
  });
};

const secureEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const validateAdminCredentials = ({ email, password }) => {
  if (!EMAIL_PATTERN.test(String(email || '').trim())) throw new AppError('A valid email is required', 422, 'INVALID_EMAIL');
  if (!PASSWORD_PATTERN.test(password || '')) {
    throw new AppError('Admin password must be 12-128 characters with uppercase, lowercase, number, and special character', 422, 'WEAK_PASSWORD');
  }
};

const writeAudit = async (req, values) => {
  try {
    await AuditLog.create({
      actorType: values.actorType || 'admin',
      actor: values.actor || req.user?.id || null,
      actorModel: values.actor || req.user?.id ? 'Admin' : null,
      actorEmail: values.actorEmail,
      action: values.action,
      resourceType: values.resourceType || 'Admin',
      resourceId: values.resourceId || null,
      changes: values.changes || [],
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

const setupSuperAdmin = asyncHandler(async (req, res) => {
  const configuredSecret = process.env.SUPER_ADMIN_SETUP_SECRET;
  const suppliedSecret = req.get('x-setup-secret') || req.body.setupSecret;
  if (!configuredSecret || configuredSecret.length < 32) throw new Error('SUPER_ADMIN_SETUP_SECRET must contain at least 32 characters');
  if (!secureEqual(suppliedSecret, configuredSecret)) {
    await writeAudit(req, {
      actorType: 'system', action: 'create', description: 'Rejected Super Admin setup attempt',
      outcome: 'denied', statusCode: 403,
    });
    throw new AppError('Invalid setup credentials', 403, 'INVALID_SETUP_SECRET');
  }
  if (await Admin.exists({ role: 'superAdmin', deletedAt: null })) {
    throw new AppError('Super Admin has already been configured', 409, 'SUPER_ADMIN_EXISTS');
  }

  const { firstName, lastName, email, phone, password } = req.body;
  if (!firstName || !lastName) throw new AppError('First name and last name are required', 422, 'VALIDATION_ERROR');
  validateAdminCredentials({ email, password });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (await Admin.exists({ email: normalizedEmail })) throw new AppError('Email is already in use', 409, 'EMAIL_ALREADY_REGISTERED');

  let setupLock;
  try {
    setupLock = await Setting.create({
      key: 'system.super_admin_initialized', group: 'security', label: 'Super Admin initialized',
      valueType: 'boolean', value: true, isPublic: false, isEditable: false, isSensitive: true,
    });
  } catch (error) {
    if (error.code === 11000) throw new AppError('Super Admin has already been configured', 409, 'SUPER_ADMIN_EXISTS');
    throw error;
  }

  let admin;
  try {
    admin = await Admin.create({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: normalizedEmail,
      phone,
      password,
      role: 'superAdmin',
      permissions: ['*'],
      isEmailVerified: true,
      status: 'active',
    });
  } catch (error) {
    await Setting.deleteOne({ _id: setupLock._id });
    throw error;
  }
  await writeAudit(req, {
    actor: admin._id, actorEmail: admin.email, action: 'create', resourceId: admin._id,
    description: 'Initial Super Admin configured', statusCode: 201,
  });
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Super Admin configured successfully',
    data: { id: admin._id, email: admin.email, role: admin.role },
  });
});

const verifyAdminEmail = asyncHandler(async (req, res) => {
  throw new AppError('Admin approval must be completed by the Super Admin', 403, 'SUPER_ADMIN_APPROVAL_REQUIRED');
});

const resendAdminVerification = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(email)) {
    const admin = await Admin.findOne({ email, isEmailVerified: false, status: 'active', deletedAt: null })
      .select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');
    if (admin) {
      const otp = generateOtp();
      admin.emailVerificationOtpHash = hashToken(otp);
      admin.emailVerificationOtpExpiresAt = new Date(Date.now() + ADMIN_VERIFICATION_OTP_TTL);
      await admin.save({ validateBeforeSave: false });
      await sendAdminVerificationEmail(admin, otp);
    }
  }
  return ApiResponse.success(res, {
    message: 'If an unverified admin account exists, a new verification OTP has been sent.',
  });
});

const forgotAdminPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (EMAIL_PATTERN.test(email)) {
    const admin = await Admin.findOne({ email, status: 'active', isEmailVerified: true, deletedAt: null })
      .select(
        '+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts +passwordResetOtpSentAt',
      );
    if (admin && canSendPasswordResetOtp(admin.passwordResetOtpSentAt)) {
      const challenge = createPasswordResetOtp();
      admin.passwordResetOtpHash = challenge.otpHash;
      admin.passwordResetOtpExpiresAt = challenge.expiresAt;
      admin.passwordResetOtpAttempts = 0;
      admin.passwordResetOtpSentAt = challenge.sentAt;
      await admin.save({ validateBeforeSave: false });
      try {
        await sendAdminPasswordResetEmail(admin, challenge.otp);
      } catch (error) {
        console.error('Admin password reset OTP email failed', error.message);
      }
      await writeAudit(req, {
        actor: admin._id, actorEmail: admin.email, action: 'update', resourceId: admin._id,
        description: 'Admin password reset requested', statusCode: 200,
      });
    }
  }
  return ApiResponse.success(res, {
    message: 'If an eligible admin account exists, a 6-digit password reset code has been sent.',
    data: { expiresInSeconds: 600, resendAfterSeconds: 60 },
  });
});

const resetAdminPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();
  const { password } = req.body;
  if (!EMAIL_PATTERN.test(email) || !isValidPasswordResetOtp(otp)) {
    throw new AppError('A valid email and 6-digit OTP are required', 422, 'INVALID_RESET_OTP');
  }
  if (!PASSWORD_PATTERN.test(password || '')) {
    throw new AppError('Admin password must be 12-128 characters with uppercase, lowercase, number, and special character', 422, 'WEAK_PASSWORD');
  }

  const now = new Date();
  const admin = await Admin.findOneAndUpdate(
    {
      email,
      passwordResetOtpHash: hashToken(otp),
      passwordResetOtpExpiresAt: { $gt: now },
      passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
      status: 'active',
      isEmailVerified: true,
      deletedAt: null,
    },
    {
      $unset: {
        passwordResetOtpHash: 1,
        passwordResetOtpExpiresAt: 1,
        passwordResetOtpAttempts: 1,
        passwordResetOtpSentAt: 1,
      },
    },
    { new: true },
  ).select('+password +failedLoginAttempts +lockUntil');

  if (!admin) {
    await Admin.updateOne(
      {
        email,
        passwordResetOtpExpiresAt: { $gt: now },
        passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
        status: 'active',
        isEmailVerified: true,
        deletedAt: null,
      },
      { $inc: { passwordResetOtpAttempts: 1 } },
    );
    throw new AppError(
      'The email or OTP is invalid, expired, or has reached its attempt limit',
      400,
      'INVALID_RESET_OTP',
    );
  }

  admin.password = password;
  admin.failedLoginAttempts = 0;
  admin.lockUntil = undefined;
  await admin.save();
  await writeAudit(req, {
    actor: admin._id, actorEmail: admin.email, action: 'update', resourceId: admin._id,
    description: 'Admin password reset completed', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Password reset successfully. You can now sign in.' });
});

const adminLogin = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;
  if (!email || !password) throw new AppError('Email and password are required', 422, 'VALIDATION_ERROR');

  const admin = await Admin.findOne({ email, deletedAt: null }).select('+password +failedLoginAttempts +lockUntil');
  if (!admin || !(await admin.comparePassword(password))) {
    if (admin) {
      admin.failedLoginAttempts += 1;
      if (admin.failedLoginAttempts >= 5) admin.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      await admin.save({ validateBeforeSave: false });
    }
    await writeAudit(req, {
      actorEmail: email, action: 'loginFailed', description: 'Admin login failed', outcome: 'failure', statusCode: 401,
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }
  if (admin.lockUntil && admin.lockUntil > new Date()) throw new AppError('Account is temporarily locked', 423, 'ACCOUNT_LOCKED');
  if (admin.status !== 'active') throw new AppError('Admin account is not active', 403, 'ACCOUNT_INACTIVE');
  if (!admin.isEmailVerified) throw new AppError('Verify your admin email before signing in', 403, 'EMAIL_NOT_VERIFIED');

  admin.failedLoginAttempts = 0;
  admin.lockUntil = undefined;
  admin.lastLoginAt = new Date();
  admin.lastLoginIp = req.ip;
  await admin.save({ validateBeforeSave: false });
  const accessToken = generateAccessToken(admin);
  await writeAudit(req, {
    actor: admin._id, actorEmail: admin.email, action: 'login', resourceId: admin._id,
    description: 'Admin signed in', statusCode: 200,
  });

  return ApiResponse.success(res, {
    message: 'Admin signed in successfully',
    data: {
      admin: { id: admin._id, firstName: admin.firstName, lastName: admin.lastName, email: admin.email, role: admin.role, permissions: admin.permissions },
      accessToken,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    },
  });
});

const createAdmin = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, role = 'admin', permissions = [] } = req.body;
  if (!firstName || !lastName || !ADMIN_ROLES.includes(role) || role === 'superAdmin') {
    throw new AppError('Valid name and non-Super-Admin role are required', 422, 'VALIDATION_ERROR');
  }
  validateAdminCredentials({ email, password });
  const normalizedEmail = String(email).trim().toLowerCase();
  if (await Admin.exists({ email: normalizedEmail })) throw new AppError('Email is already in use', 409, 'EMAIL_ALREADY_REGISTERED');

  const otp = generateOtp();
  const admin = await Admin.create({
    firstName: String(firstName).trim(), lastName: String(lastName).trim(), email: normalizedEmail,
    phone, password, role, permissions: [...new Set(permissions)], isEmailVerified: false,
    emailVerificationOtpHash: hashToken(otp),
    emailVerificationOtpExpiresAt: new Date(Date.now() + ADMIN_VERIFICATION_OTP_TTL),
    createdBy: req.user.id,
  });
  try {
    await sendAdminVerificationEmail(admin, otp);
  } catch (error) {
    await Admin.deleteOne({ _id: admin._id });
    throw error;
  }
  await writeAudit(req, {
    action: 'create', resourceId: admin._id, description: `Created pending admin account with role ${role}`, statusCode: 201,
  });
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Admin created pending Super Admin OTP approval. Verification OTP has been sent to the assigned admin email.',
    data: {
      id: admin._id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
      status: admin.status,
      isEmailVerified: admin.isEmailVerified,
    },
  });
});

const verifyCreatedAdmin = asyncHandler(async (req, res) => {
  const otp = String(req.body.otp || '').trim();
  if (!/^\d{4,10}$/.test(otp)) throw new AppError('A valid verification OTP is required', 422, 'OTP_REQUIRED');

  const admin = await Admin.findOne({
    _id: req.params.adminId,
    role: { $ne: 'superAdmin' },
    deletedAt: null,
  }).select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');

  if (!admin) throw new AppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
  if (admin.status !== 'active') throw new AppError('Admin account is not active', 403, 'ACCOUNT_INACTIVE');
  if (admin.isEmailVerified) {
    return ApiResponse.success(res, { message: 'Admin is already verified and can sign in.', data: admin });
  }
  if (
    admin.emailVerificationOtpHash !== hashToken(otp)
    || !admin.emailVerificationOtpExpiresAt
    || admin.emailVerificationOtpExpiresAt <= new Date()
  ) {
    throw new AppError('Verification OTP is invalid or expired', 400, 'INVALID_VERIFICATION_OTP');
  }

  admin.isEmailVerified = true;
  admin.emailVerifiedAt = new Date();
  admin.emailVerificationOtpHash = undefined;
  admin.emailVerificationOtpExpiresAt = undefined;
  await admin.save({ validateBeforeSave: false });

  await writeAudit(req, {
    action: 'verify',
    resourceId: admin._id,
    description: `Super Admin approved admin account ${admin.email}`,
    statusCode: 200,
  });

  return ApiResponse.success(res, { message: 'Admin verified successfully. The admin can now sign in.', data: admin });
});

const resendCreatedAdminVerification = asyncHandler(async (req, res) => {
  const admin = await Admin.findOne({
    _id: req.params.adminId,
    role: { $ne: 'superAdmin' },
    isEmailVerified: false,
    status: 'active',
    deletedAt: null,
  }).select('+emailVerificationOtpHash +emailVerificationOtpExpiresAt');

  if (!admin) throw new AppError('Unverified active admin not found', 404, 'ADMIN_NOT_FOUND');

  const otp = generateOtp();
  admin.emailVerificationOtpHash = hashToken(otp);
  admin.emailVerificationOtpExpiresAt = new Date(Date.now() + ADMIN_VERIFICATION_OTP_TTL);
  await admin.save({ validateBeforeSave: false });
  await sendAdminVerificationEmail(admin, otp);

  await writeAudit(req, {
    action: 'verify',
    resourceId: admin._id,
    description: `Resent Super Admin approval OTP for ${admin.email}`,
    statusCode: 200,
  });

  return ApiResponse.success(res, { message: 'Verification OTP has been resent to the assigned admin email.' });
});

const listAdmins = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { deletedAt: null };
  if (req.query.role && ADMIN_ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['firstName', 'lastName', 'email'].map((field) => ({ [field]: new RegExp(escaped, 'i') }));
  }
  const [admins, total] = await Promise.all([
    Admin.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Admin.countDocuments(filter),
  ]);
  return ApiResponse.success(res, { data: admins, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getAdminProfile = asyncHandler(async (req, res) => {
  const admin = await Admin.findOne({ _id: req.user.id, deletedAt: null });
  if (!admin) throw new AppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
  return ApiResponse.success(res, { data: admin });
});

const updateAdminProfile = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'phone'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const admin = await Admin.findOneAndUpdate(
    { _id: req.user.id, deletedAt: null }, { $set: updates }, { new: true, runValidators: true },
  );
  if (!admin) throw new AppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
  return ApiResponse.success(res, { message: 'Admin profile updated', data: admin });
});

const changeAdminPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!PASSWORD_PATTERN.test(newPassword || '')) throw new AppError('New password does not meet admin password requirements', 422, 'WEAK_PASSWORD');
  const admin = await Admin.findById(req.user.id).select('+password');
  if (!admin || !(await admin.comparePassword(currentPassword))) throw new AppError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
  admin.password = newPassword;
  await admin.save();
  await writeAudit(req, { action: 'update', resourceId: admin._id, description: 'Admin changed own password', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Password changed successfully' });
});

const updateAdmin = asyncHandler(async (req, res) => {
  const admin = await Admin.findOne({ _id: req.params.adminId, deletedAt: null });
  if (!admin) throw new AppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
  if (admin.role === 'superAdmin') throw new AppError('Super Admin account cannot be modified here', 403, 'SUPER_ADMIN_PROTECTED');

  const changes = [];
  for (const field of ['firstName', 'lastName', 'phone', 'status', 'role', 'permissions']) {
    if (req.body[field] !== undefined) {
      if (field === 'role' && (!ADMIN_ROLES.includes(req.body.role) || req.body.role === 'superAdmin')) {
        throw new AppError('Invalid admin role', 422, 'INVALID_ROLE');
      }
      changes.push({ field, oldValue: admin[field], newValue: req.body[field] });
      admin[field] = field === 'permissions' ? [...new Set(req.body[field])] : req.body[field];
    }
  }
  await admin.save();
  await writeAudit(req, {
    action: req.body.permissions ? 'permissionChange' : 'update', resourceId: admin._id,
    changes, description: 'Admin account updated', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Admin updated', data: admin });
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const admin = await Admin.findOne({ _id: req.params.adminId, deletedAt: null });
  if (!admin) throw new AppError('Admin not found', 404, 'ADMIN_NOT_FOUND');
  if (admin.role === 'superAdmin' || String(admin._id) === req.user.id) {
    throw new AppError('This admin account cannot be deleted', 403, 'ADMIN_PROTECTED');
  }
  admin.status = 'inactive';
  admin.deletedAt = new Date();
  await admin.save();
  await writeAudit(req, { action: 'delete', resourceId: admin._id, description: 'Admin account deactivated', statusCode: 200 });
  return ApiResponse.success(res, { message: 'Admin deactivated' });
});

const listCustomers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { status: { $ne: 'deleted' } };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.verified === 'true' || req.query.verified === 'false') filter.isEmailVerified = req.query.verified === 'true';
  if (req.query.search) filter.$text = { $search: String(req.query.search).slice(0, 100) };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  return ApiResponse.success(res, { data: users, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getCustomer360 = asyncHandler(async (req, res) => {
  const customer = await User.findOne({ _id: req.params.userId, status: { $ne: 'deleted' } })
    .select('+fcmTokens +fcmDevices')
    .lean();
  if (!customer) throw new AppError('Customer not found', 404, 'USER_NOT_FOUND');

  const [
    orderMetrics,
    recentOrders,
    appointments,
    returns,
    buybacks,
    wishlist,
    behaviour,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { user: customer._id } },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          lifetimeSpend: { $sum: { $cond: [{ $in: ['$paymentStatus', ['paid', 'partiallyRefunded']] }, '$grandTotal', 0] } },
          averageOrderValue: { $avg: '$grandTotal' },
          lastOrderAt: { $max: '$createdAt' },
          deliveredOrders: { $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] } },
        },
      },
    ]),
    Order.find({ user: customer._id })
      .select('orderNumber grandTotal paymentStatus orderStatus fulfillmentStatus createdAt deliveredAt items')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Appointment.find({ user: customer._id })
      .populate('assignedAdmin', 'firstName lastName role')
      .populate('productIds', 'name price images')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    ReturnRequest.find({ user: customer._id })
      .select('returnNumber status totalApprovedAmount requestedAt completedAt items')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Buyback.find({ user: customer._id })
      .select('buybackNumber status itemSnapshot policy offer createdAt completedAt')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Wishlist.findOne({ user: customer._id })
      .populate('items.product', 'name slug sku price images status')
      .lean(),
    customerAnalyticsService.customerInsight(customer._id, 90),
  ]);

  const metrics = orderMetrics[0] || {
    orderCount: 0,
    lifetimeSpend: 0,
    averageOrderValue: 0,
    deliveredOrders: 0,
  };
  const pushDeviceCount = new Set([
    ...(customer.fcmTokens || []),
    ...(customer.fcmDevices || []).map((device) => device.token),
  ].filter(Boolean)).size;
  const vipTier = metrics.lifetimeSpend >= 1000000
    ? 'platinum'
    : metrics.lifetimeSpend >= 500000
      ? 'gold'
      : metrics.lifetimeSpend >= 150000
        ? 'atelier'
        : 'standard';

  return ApiResponse.success(res, {
    data: {
      customer: {
        ...customer,
        fcmTokens: undefined,
        fcmDevices: undefined,
        pushDeviceCount,
      },
      metrics: {
        ...metrics,
        vipTier,
        wishlistCount: wishlist?.items?.length || 0,
        appointmentCount: appointments.length,
        returnCount: returns.length,
        buybackCount: buybacks.length,
      },
      recentOrders,
      appointments,
      returns,
      buybacks,
      wishlistItems: wishlist?.items || [],
      behaviour,
    },
  });
});

const updateCustomerStatus = asyncHandler(async (req, res) => {
  const allowedStatuses = ['active', 'inactive', 'blocked'];
  if (!allowedStatuses.includes(req.body.status)) throw new AppError('Invalid customer status', 422, 'INVALID_STATUS');
  const user = await User.findOneAndUpdate(
    { _id: req.params.userId, status: { $ne: 'deleted' } },
    { $set: { status: req.body.status } },
    { new: true, runValidators: true },
  );
  if (!user) throw new AppError('Customer not found', 404, 'USER_NOT_FOUND');
  await writeAudit(req, {
    action: 'statusChange', resourceType: 'User', resourceId: user._id,
    description: `Customer status changed to ${req.body.status}`, statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Customer status updated', data: user });
});

module.exports = {
  setupSuperAdmin,
  verifyAdminEmail,
  resendAdminVerification,
  forgotAdminPassword,
  resetAdminPassword,
  adminLogin,
  createAdmin,
  verifyCreatedAdmin,
  resendCreatedAdminVerification,
  listAdmins,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
  updateAdmin,
  deleteAdmin,
  listCustomers,
  getCustomer360,
  updateCustomerStatus,
};
