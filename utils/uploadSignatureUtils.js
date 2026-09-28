const AppError = require('./appError');

const startsWith = (buffer, signature) => signature.every((byte, index) => buffer[index] === byte);

const detectedMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(buffer.subarray(8, 12).toString('ascii'))) return 'image/avif';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
};

const validateUploadSignature = (file, allowedTypes) => {
  const detected = detectedMimeType(file?.buffer);
  if (!detected || detected !== file.mimetype || !allowedTypes.includes(detected)) {
    throw new AppError('Uploaded file content does not match an allowed file type', 415, 'INVALID_FILE_CONTENT');
  }
  return detected;
};

module.exports = { detectedMimeType, validateUploadSignature };
