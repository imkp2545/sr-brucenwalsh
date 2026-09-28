const AppError = require('../utils/appError');

const roleMiddleware = (...allowedRoles) => {
  const roles = [...new Set(allowedRoles.flat().filter(Boolean))];
  if (!roles.length) throw new Error('At least one allowed role is required');

  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(
        'Login or signup is required to perform this action',
        401,
        'LOGIN_REQUIRED',
      ));
    }
    if (!req.user.role || !roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403, 'FORBIDDEN'));
    }
    return next();
  };
};

module.exports = roleMiddleware;
