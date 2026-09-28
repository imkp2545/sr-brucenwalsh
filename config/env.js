const numberFromEnvironment = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: numberFromEnvironment('PORT', 5000),
  mongoUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  clientUrls: (process.env.CLIENT_URL || '').split(',').map((value) => value.trim()).filter(Boolean),
};

const validateEnv = () => {
  const missing = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']
    .filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
};

module.exports = { env, validateEnv };
