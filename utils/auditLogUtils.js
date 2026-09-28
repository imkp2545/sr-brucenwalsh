const AuditLog = require('../models/auditLogModel');

const resolveActor = (req, actorType) => {
  if (actorType === 'system' || actorType === 'webhook') return { actor: null, actorModel: null };
  return {
    actor: req.user?.id || null,
    actorModel: actorType === 'admin' ? 'Admin' : 'User',
  };
};

const logAudit = async (req, options) => {
  const actorType = options.actorType || (req.user?.role === 'customer' ? 'user' : 'admin');
  const actor = resolveActor(req, actorType);
  try {
    return await AuditLog.create({
      actorType,
      ...actor,
      actorEmail: options.actorEmail,
      action: options.action,
      resourceType: options.resourceType,
      resourceId: options.resourceId || null,
      resourceLabel: options.resourceLabel,
      changes: options.changes || [],
      description: options.description,
      outcome: options.outcome || 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      route: req.originalUrl,
      method: req.method,
      statusCode: options.statusCode,
      metadata: options.metadata || {},
    });
  } catch (error) {
    console.error('Audit log write failed', error.message);
    return null;
  }
};

module.exports = { logAudit };
