const mongoose = require("mongoose");
const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
};

const comparePassword = async (password, encodedPassword) => {
  const [algorithm, salt, storedHash] = String(encodedPassword || "").split(
    "$",
  );
  if (algorithm !== "scrypt" || !salt || !storedHash) return false;
  const derivedKey = await scryptAsync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, "hex");
  return (
    storedBuffer.length === derivedKey.length &&
    crypto.timingSafeEqual(storedBuffer, derivedKey)
  );
};

const adminSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: { type: String, trim: true, maxlength: 20 },
    password: { type: String, required: true, select: false, minlength: 8 },
    role: {
      type: String,
      enum: [
        "superAdmin",
        "admin",
        "catalogManager",
        "orderManager",
        "supportManager",
        "marketingManager",
      ],
      default: "admin",
      index: true,
    },
    permissions: [{ type: String, trim: true }],
    avatar: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },
    isEmailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date },
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
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String, select: false },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false },
);

adminSchema.index({ email: 1, status: 1 });
adminSchema.index({ firstName: "text", lastName: "text", email: "text" });

adminSchema.pre("save", async function hashModifiedPassword() {
  if (!this.isModified("password")) return;
  this.password = await hashPassword(this.password);
  this.passwordChangedAt = new Date();
});

adminSchema.methods.comparePassword = function compareCandidatePassword(
  candidatePassword,
) {
  return comparePassword(candidatePassword, this.password);
};

adminSchema.methods.changedPasswordAfter = function changedAfter(jwtIssuedAt) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > jwtIssuedAt;
};

adminSchema.virtual("fullName").get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model("Admin", adminSchema);
