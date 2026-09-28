if (false) {
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  label: { type: String, trim: true, maxlength: 40 },
  fullName: { type: String, trim: true, maxlength: 100 },
  phone: { type: String, trim: true, maxlength: 20 },
  line1: { type: String, required: true, trim: true, maxlength: 200 },
  line2: { type: String, trim: true, maxlength: 200 },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  postalCode: { type: String, required: true, trim: true, maxlength: 12 },
  country: { type: String, default: 'India', trim: true },
  isDefault: { type: Boolean, default: false },
}, { _id: true });

const userSchema = new mongoose.Schema({
  fullName: { type: String, trim: true, maxlength: 100 },
  mobileNumber: { type: String, trim: true, maxlength: 20 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  emailVerified: { type: Boolean, default: false, index: true },
  emailVerificationTokenHash: { type: String, select: false },
  emailVerificationExpiresAt: { type: Date, select: false },
  tokenVersion: { type: Number, default: 0, select: false },
  addresses: [addressSchema],
  deviceTokens: [{ token: String, platform: { type: String, enum: ['ios', 'android', 'web'] }, updatedAt: Date }],
  recentlyViewed: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, viewedAt: Date }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['superAdmin', 'admin'], default: 'admin', index: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  tokenVersion: { type: Number, default: 0, select: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  lastLogin: Date,
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  Admin: mongoose.model('Admin', adminSchema),
  addressSchema,
};
}

module.exports = {
  User: require('./userModel'),
  Admin: require('./adminModel'),
};
