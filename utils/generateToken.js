const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const requiredSecret = (name) => {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(name + ' must contain at least 32 characters');
  return value;
};

const commonOptions = () => ({
  algorithm: 'HS256',
  issuer: process.env.JWT_ISSUER || 'bruce-walsh-luxury',
  audience: process.env.JWT_AUDIENCE || 'bruce-walsh-luxury-api',
});

const generateAccessToken = (user, options = {}) =>
  jwt.sign(
    {
      role: user.role,
      emailVerified: Boolean(user.isEmailVerified),
      type: 'access',
    },
    requiredSecret('JWT_ACCESS_SECRET'),
    {
      ...commonOptions(),
      subject: String(user._id || user.id),
      jwtid: randomUUID(),
      expiresIn: options.expiresIn || process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    },
  );

const generateRefreshToken = (user, tokenId = randomUUID()) =>
  jwt.sign(
    { type: 'refresh' },
    requiredSecret('JWT_REFRESH_SECRET'),
    {
      ...commonOptions(),
      subject: String(user._id || user.id),
      jwtid: tokenId,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
  );

const verifyRefreshToken = (token) => {
  const payload = jwt.verify(token, requiredSecret('JWT_REFRESH_SECRET'), {
    ...commonOptions(),
    algorithms: ['HS256'],
  });
  if (payload.type !== 'refresh') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload;
};

module.exports = { generateAccessToken, generateRefreshToken, verifyRefreshToken };
