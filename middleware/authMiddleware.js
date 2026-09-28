const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Admin = require('../models/adminModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

const extractToken = (req) => {
  const authorization = req.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  return null;
};

const authMiddleware = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    throw new AppError(
      'Login or signup is required to perform this action',
      401,
      'LOGIN_REQUIRED',
    );
  }

  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required');

  const payload = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: process.env.JWT_ISSUER || 'bruce-walsh-luxury',
    audience: process.env.JWT_AUDIENCE || 'bruce-walsh-luxury-api',
  });

  if (payload.type !== 'access') {
    throw new AppError('Invalid authentication token', 401, 'INVALID_TOKEN');
  }

  const isCustomer = payload.role === 'customer';
  const account = isCustomer
    ? await User.findOne({ _id: payload.sub, status: 'active', deletedAt: null })
    : await Admin.findOne({ _id: payload.sub, status: 'active', deletedAt: null });

  if (!account) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_NOT_ACTIVE');
  }
  if (isCustomer && !account.isEmailVerified) {
    throw new AppError('Email verification is required', 403, 'EMAIL_NOT_VERIFIED');
  }
  if (account.changedPasswordAfter(payload.iat)) {
    throw new AppError('Password changed after this token was issued', 401, 'TOKEN_REVOKED');
  }

  req.user = {
    id: String(account._id),
    role: account.role,
    isEmailVerified: isCustomer ? account.isEmailVerified : true,
    tokenId: payload.jti,
  };
  req.account = account;
  req.authToken = token;
  next();
});

module.exports = authMiddleware;
