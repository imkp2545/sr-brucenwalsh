const multer = require('multer');
const AppError = require('../utils/appError');

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
]);

const fileFilter = (_req, file, callback) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return callback(new AppError('Unsupported file type', 415, 'UNSUPPORTED_FILE_TYPE'));
  }
  return callback(null, true);
};

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 10) * 1024 * 1024,
    files: 10,
    fields: 30,
  },
  fileFilter,
});

module.exports = uploadMiddleware;
