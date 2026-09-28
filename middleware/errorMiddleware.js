const ApiResponse = require('../utils/apiResponse');

const normalizeError = (error) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return { statusCode: 400, code: 'INVALID_JSON', message: 'Request body contains invalid JSON' };
  }

  if (error.name === 'ValidationError') {
    return {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: Object.values(error.errors).map((item) => ({ field: item.path, message: item.message })),
    };
  }

  if (error.code === 11000) {
    return {
      statusCode: 409,
      code: 'DUPLICATE_RESOURCE',
      message: 'A resource with this value already exists',
      details: Object.keys(error.keyPattern || {}),
    };
  }

  if (error.name === 'CastError') {
    return { statusCode: 400, code: 'INVALID_IDENTIFIER', message: 'Invalid resource identifier' };
  }

  if (error.name === 'VersionError') {
    return {
      statusCode: 409,
      code: 'CONCURRENT_UPDATE',
      message: 'The resource changed during this request. Refresh and try again.',
    };
  }

  if (['MongoNetworkError', 'MongooseServerSelectionError'].includes(error.name)) {
    return {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is temporarily unavailable',
    };
  }

  if (error.name === 'MulterError') {
    return { statusCode: 400, code: 'UPLOAD_ERROR', message: error.message };
  }

  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    return { statusCode: 401, code: 'INVALID_TOKEN', message: 'Invalid or expired authentication token' };
  }

  return {
    statusCode: error.statusCode || 500,
    code: error.code || 'INTERNAL_SERVER_ERROR',
    message: error.isOperational ? error.message : 'Internal server error',
    details: error.details,
  };
};

const errorMiddleware = (error, req, res, next) => {
  const normalized = normalizeError(error);

  if (normalized.statusCode >= 500) {
    console.error(JSON.stringify({
      message: error.message,
      details: normalized.details,
      stack: error.stack,
      method: req.method,
      path: req.originalUrl,
      requestId: req.id,
    }, null, 2));
  }

  if (res.headersSent) return next(error);

  if (process.env.NODE_ENV !== 'production' && normalized.statusCode >= 500) {
    normalized.details = { ...(normalized.details || {}), stack: error.stack };
  }

  return ApiResponse.error(res, normalized);
};

module.exports = errorMiddleware;
