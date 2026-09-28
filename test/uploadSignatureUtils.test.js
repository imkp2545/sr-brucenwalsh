const test = require('node:test');
const assert = require('node:assert/strict');
const { detectedMimeType, validateUploadSignature } = require('../utils/uploadSignatureUtils');

test('upload signatures identify supported evidence formats', () => {
  assert.equal(detectedMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])), 'image/jpeg');
  assert.equal(detectedMimeType(Buffer.from('%PDF-1.7 evidence')), 'application/pdf');
});

test('upload validation rejects a spoofed mime type', () => {
  assert.throws(
    () => validateUploadSignature({ mimetype: 'image/jpeg', buffer: Buffer.from('%PDF-1.7 evidence') }, ['image/jpeg']),
    (error) => error.code === 'INVALID_FILE_CONTENT' && error.statusCode === 415,
  );
});
