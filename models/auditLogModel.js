const mongoose = require('mongoose');

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ['admin', 'user', 'system', 'webhook'], required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, refPath: 'actorModel', default: null, index: true },
    actorModel: { type: String, enum: ['Admin', 'User'], default: null },
    actorEmail: { type: String, lowercase: true, trim: true },
    action: {
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'restore', 'login', 'logout', 'loginFailed', 'verify', 'approve', 'reject', 'cancel', 'refund', 'export', 'statusChange', 'permissionChange'],
      required: true,
      index: true,
    },
    resourceType: { type: String, required: true, trim: true, index: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    resourceLabel: { type: String, maxlength: 250 },
    changes: { type: [changeSchema], default: [] },
    description: { type: String, required: true, maxlength: 2000 },
    outcome: { type: String, enum: ['success', 'failure', 'denied'], default: 'success', index: true },
    ipAddress: { type: String },
    userAgent: { type: String, maxlength: 1000 },
    requestId: { type: String, index: true },
    route: { type: String, maxlength: 500 },
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'SYSTEM'] },
    statusCode: { type: Number, min: 100, max: 599 },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, versionKey: false },
);

auditLogSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 });
auditLogSchema.index({ actor: 1, occurredAt: -1 });
auditLogSchema.index({ action: 1, outcome: 1, occurredAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
