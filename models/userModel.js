const mongoose = require("mongoose");
const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
};

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, enum: ["home", "work", "other"], default: "home" },
    recipientName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 150 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    postalCode: { type: String, required: true, trim: true, maxlength: 12 },
    country: {
      type: String,
      required: true,
      trim: true,
      default: "India",
      maxlength: 100,
    },
    addressType: {
      type: String,
      enum: ["residential", "commercial"],
      default: "residential",
    },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, select: false },
    tokenId: { type: String, required: true },
    userAgent: { type: String, maxlength: 500 },
    ipAddress: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { _id: false, timestamps: true },
);

const fcmDeviceSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
    },
    deviceId: { type: String, trim: true, maxlength: 160 },
    appVersion: { type: String, trim: true, maxlength: 40 },
    locale: { type: String, trim: true, maxlength: 32 },
    timezone: { type: String, trim: true, maxlength: 80 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false, timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "", trim: true, maxlength: 60 },
    lastName: { type: String, default: "", trim: true, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: { type: String, trim: true, maxlength: 20 },
    password: { type: String, select: false, minlength: 8 },
    gender: {
      type: String,
      enum: ["male", "female", "nonBinary", "preferNotToSay"],
    },
    dateOfBirth: { type: Date },
    avatar: { url: { type: String }, publicId: { type: String } },
    role: {
      type: String,
      enum: ["customer"],
      default: "customer",
      immutable: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "deleted"],
      default: "active",
      index: true,
    },
    isEmailVerified: { type: Boolean, default: false, index: true },
    emailVerifiedAt: { type: Date },
    profileCompleted: { type: Boolean, default: false, index: true },
    emailVerificationOtpHash: { type: String, select: false },
    emailVerificationOtpExpiresAt: { type: Date, select: false },
    passwordResetOtpHash: { type: String, select: false },
    passwordResetOtpExpiresAt: { type: Date, select: false },
    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
    passwordResetOtpSentAt: { type: Date, select: false },
    passwordChangedAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, min: 0, select: false },
    lockUntil: { type: Date, select: false },
    authProvider: {
      type: String,
      enum: ["local", "emailOtp", "google", "apple"],
      default: "local",
    },
    providerId: { type: String, select: false },
    addresses: { type: [addressSchema], default: [] },
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
    fcmTokens: [{ type: String, select: false }],
    fcmDevices: { type: [fcmDeviceSchema], default: [], select: false },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
    },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, select: false },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ firstName: "text", lastName: "text", email: "text" });
userSchema.index({ createdAt: -1, status: 1 });

userSchema.pre("save", async function hashModifiedPassword() {
  if (!this.isModified("password") || !this.password) return;
  this.password = await hashPassword(this.password);
  this.passwordChangedAt = new Date();
});

userSchema.methods.comparePassword = async function compareCandidatePassword(
  candidatePassword,
) {
  const [algorithm, salt, storedHash] = String(this.password || "").split("$");
  if (algorithm !== "scrypt" || !salt || !storedHash) return false;
  const derivedKey = await scryptAsync(candidatePassword, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");
  return (
    storedBuffer.length === derivedKey.length &&
    crypto.timingSafeEqual(storedBuffer, derivedKey)
  );
};

userSchema.methods.changedPasswordAfter = function changedAfter(jwtIssuedAt) {
  return this.passwordChangedAt
    ? Math.floor(this.passwordChangedAt.getTime() / 1000) > jwtIssuedAt
    : false;
};

userSchema.virtual("fullName").get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model("User", userSchema);
