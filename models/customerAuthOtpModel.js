const mongoose = require('mongoose');

const customerAuthOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    otpHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    requestedAt: { type: Date, required: true },
    resendAvailableAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    consumedAt: { type: Date, default: null, select: false },
    requestCount: { type: Number, default: 1, min: 1 },
    requestWindowStartedAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

customerAuthOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CustomerAuthOtp', customerAuthOtpSchema);
