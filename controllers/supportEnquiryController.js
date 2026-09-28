const mongoose = require('mongoose');
const SupportEnquiry = require('../models/supportEnquiryModel');
const Admin = require('../models/adminModel');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateReferenceNumber } = require('../utils/orderNumberUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { notifyRoles, notifyUser, emitToRoles, emitToUser } = require('../utils/notificationUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const MANAGEMENT_ROLES = ['superAdmin', 'admin', 'supportManager'];
const CATEGORIES = ['order', 'delivery', 'product', 'appointment', 'payment', 'returnRefund', 'account', 'other'];
const PRIORITIES = ['normal', 'high', 'urgent'];
const STATUSES = ['new', 'inProgress', 'waitingForCustomer', 'resolved', 'closed'];

const cleanText = (value) => String(value || '').trim();

const safeNotify = async (operation, label) => {
  try { return await operation(); } catch (error) {
    console.error(`${label} notification failed`, error.message);
    return null;
  }
};

const createWithUniqueNumber = async (data) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await SupportEnquiry.create({
        ...data,
        enquiryNumber: generateReferenceNumber('SUP'),
      });
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to generate a unique support enquiry number');
};

const createEnquiry = asyncHandler(async (req, res) => {
  const category = cleanText(req.body.category);
  const subject = cleanText(req.body.subject);
  const message = cleanText(req.body.message);
  const reference = cleanText(req.body.reference);
  const preferredContact = cleanText(req.body.preferredContact) || 'email';

  if (!CATEGORIES.includes(category)) {
    throw new AppError('Select a valid enquiry category', 422, 'INVALID_ENQUIRY_CATEGORY');
  }
  if (subject.length < 3 || subject.length > 160) {
    throw new AppError('Subject must contain between 3 and 160 characters', 422, 'INVALID_ENQUIRY_SUBJECT');
  }
  if (message.length < 10 || message.length > 3000) {
    throw new AppError('Message must contain between 10 and 3000 characters', 422, 'INVALID_ENQUIRY_MESSAGE');
  }
  if (reference.length > 100) {
    throw new AppError('Order or service reference is too long', 422, 'INVALID_ENQUIRY_REFERENCE');
  }
  if (!['email', 'phone'].includes(preferredContact)) {
    throw new AppError('Select email or phone as the preferred contact method', 422, 'INVALID_CONTACT_METHOD');
  }

  const user = await User.findById(req.user.id).select('firstName lastName email phone');
  if (!user) throw new AppError('Customer account not found', 404, 'USER_NOT_FOUND');
  if (preferredContact === 'phone' && !user.phone) {
    throw new AppError('Add a phone number to your profile before selecting phone contact', 422, 'PHONE_REQUIRED');
  }

  const enquiry = await createWithUniqueNumber({
    user: user._id,
    customerSnapshot: {
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      email: user.email,
      phone: user.phone || '',
    },
    category,
    subject,
    message,
    reference: reference || undefined,
    preferredContact,
    statusHistory: [{
      status: 'new',
      note: 'Customer submitted a support enquiry',
      changedByType: 'user',
      changedBy: user._id,
    }],
  });

  await logAudit(req, {
    action: 'create',
    resourceType: 'SupportEnquiry',
    resourceId: enquiry._id,
    resourceLabel: enquiry.enquiryNumber,
    description: 'Customer submitted a support enquiry',
    statusCode: 201,
  });
  emitToRoles(MANAGEMENT_ROLES, 'supportEnquiry:created', enquiry.toObject());
  await safeNotify(() => notifyRoles({
    roles: MANAGEMENT_ROLES,
    type: 'support',
    title: 'New customer enquiry',
    message: `${enquiry.customerSnapshot.name} submitted ${enquiry.enquiryNumber}.`,
    data: { enquiryId: enquiry._id, enquiryNumber: enquiry.enquiryNumber },
    priority: 'high',
  }), 'Support admin');

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Your enquiry has been sent to Client Care',
    data: enquiry,
  });
});

const listMyEnquiries = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
  const filter = { user: req.user.id };
  const [enquiries, total] = await Promise.all([
    SupportEnquiry.find(filter)
      .populate('responses.sentBy', 'firstName lastName role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SupportEnquiry.countDocuments(filter),
  ]);
  return ApiResponse.success(res, {
    data: enquiries,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const replyToEnquiry = asyncHandler(async (req, res) => {
  const message = cleanText(req.body.message);
  if (message.length < 2 || message.length > 3000) {
    throw new AppError('Reply must contain between 2 and 3000 characters', 422, 'INVALID_ENQUIRY_REPLY');
  }
  const enquiry = await SupportEnquiry.findOne({
    _id: req.params.enquiryId,
    user: req.user.id,
  });
  if (!enquiry) throw new AppError('Support enquiry not found', 404, 'SUPPORT_ENQUIRY_NOT_FOUND');
  if (enquiry.status === 'closed') {
    throw new AppError('This enquiry is closed. Please submit a new request if you need further help.', 409, 'ENQUIRY_CLOSED');
  }

  enquiry.customerReplies.push({ message });
  if (enquiry.status !== 'inProgress') {
    enquiry.status = 'inProgress';
    enquiry.resolvedAt = undefined;
    enquiry.statusHistory.push({
      status: 'inProgress',
      note: 'Customer sent additional information',
      changedByType: 'user',
      changedBy: req.user.id,
    });
  }
  await enquiry.save();

  await logAudit(req, {
    action: 'update',
    resourceType: 'SupportEnquiry',
    resourceId: enquiry._id,
    resourceLabel: enquiry.enquiryNumber,
    description: 'Customer replied to a support enquiry',
    statusCode: 200,
  });
  emitToRoles(MANAGEMENT_ROLES, 'supportEnquiry:updated', {
    id: enquiry._id,
    status: enquiry.status,
    enquiryNumber: enquiry.enquiryNumber,
  });
  await safeNotify(() => notifyRoles({
    roles: MANAGEMENT_ROLES,
    type: 'support',
    title: 'Customer replied to Client Care',
    message: `${enquiry.customerSnapshot.name} replied to ${enquiry.enquiryNumber}.`,
    data: { enquiryId: enquiry._id, enquiryNumber: enquiry.enquiryNumber },
    priority: 'high',
  }), 'Support admin reply');

  return ApiResponse.success(res, {
    message: 'Your reply has been sent to Client Care',
    data: enquiry,
  });
});

const listEnquiriesAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};

  if (req.query.category && CATEGORIES.includes(req.query.category)) baseFilter.category = req.query.category;
  if (req.query.priority && PRIORITIES.includes(req.query.priority)) baseFilter.priority = req.query.priority;
  if (req.query.assignedAdmin === 'unassigned') baseFilter.assignedAdmin = null;
  else if (req.query.assignedAdmin && mongoose.isValidObjectId(req.query.assignedAdmin)) {
    baseFilter.assignedAdmin = req.query.assignedAdmin;
  }
  if (req.query.search) {
    const escaped = cleanText(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      const search = new RegExp(escaped, 'i');
      baseFilter.$or = [
        { enquiryNumber: search },
        { subject: search },
        { reference: search },
        { 'customerSnapshot.name': search },
        { 'customerSnapshot.email': search },
        { 'customerSnapshot.phone': search },
      ];
    }
  }

  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const requestedSort = String(req.query.sort || '');
  const sortField = requestedSort.replace(/^-/, '');
  const sort = ['enquiryNumber', 'status', 'priority', 'category', 'createdAt', 'updatedAt'].includes(sortField)
    ? { [sortField]: requestedSort.startsWith('-') ? -1 : 1 }
    : { createdAt: -1 };

  const [enquiries, total, summary] = await Promise.all([
    SupportEnquiry.find(filter)
      .populate('user', 'firstName lastName email phone')
      .populate('assignedAdmin', 'firstName lastName email role')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    SupportEnquiry.countDocuments(filter),
    summarizeStatusFields(SupportEnquiry, baseFilter, ['status', 'priority']),
  ]);
  return ApiResponse.success(res, {
    data: enquiries,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const listSupportAgents = asyncHandler(async (_req, res) => {
  const admins = await Admin.find({
    role: { $in: MANAGEMENT_ROLES },
    status: 'active',
    deletedAt: null,
  }).select('firstName lastName email role').sort({ firstName: 1, lastName: 1 });
  return ApiResponse.success(res, { data: admins });
});

const getEnquiryAdmin = asyncHandler(async (req, res) => {
  const enquiry = await SupportEnquiry.findById(req.params.enquiryId)
    .select('+internalNotes')
    .populate('user', 'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email role')
    .populate('responses.sentBy', 'firstName lastName role');
  if (!enquiry) throw new AppError('Support enquiry not found', 404, 'SUPPORT_ENQUIRY_NOT_FOUND');
  return ApiResponse.success(res, { data: enquiry });
});

const updateEnquiryAdmin = asyncHandler(async (req, res) => {
  const enquiry = await SupportEnquiry.findById(req.params.enquiryId).select('+internalNotes');
  if (!enquiry) throw new AppError('Support enquiry not found', 404, 'SUPPORT_ENQUIRY_NOT_FOUND');

  const nextStatus = req.body.status === undefined ? enquiry.status : cleanText(req.body.status);
  const priority = req.body.priority === undefined ? enquiry.priority : cleanText(req.body.priority);
  const customerMessage = cleanText(req.body.customerMessage);
  const internalNotes = req.body.internalNotes === undefined
    ? enquiry.internalNotes
    : cleanText(req.body.internalNotes);

  if (!STATUSES.includes(nextStatus)) throw new AppError('Select a valid enquiry status', 422, 'INVALID_ENQUIRY_STATUS');
  if (!PRIORITIES.includes(priority)) throw new AppError('Select a valid enquiry priority', 422, 'INVALID_ENQUIRY_PRIORITY');
  if (customerMessage.length > 3000) throw new AppError('Customer response is too long', 422, 'INVALID_CUSTOMER_RESPONSE');
  if (internalNotes && internalNotes.length > 3000) throw new AppError('Internal notes are too long', 422, 'INVALID_INTERNAL_NOTES');

  let assignedAdmin = enquiry.assignedAdmin;
  if (req.body.assignedAdmin !== undefined) {
    assignedAdmin = cleanText(req.body.assignedAdmin) || null;
    if (assignedAdmin) {
      if (!mongoose.isValidObjectId(assignedAdmin)) throw new AppError('Assigned support agent is invalid', 422, 'INVALID_ADMIN');
      const exists = await Admin.exists({
        _id: assignedAdmin,
        role: { $in: MANAGEMENT_ROLES },
        status: 'active',
        deletedAt: null,
      });
      if (!exists) throw new AppError('Assigned support agent is unavailable', 422, 'INVALID_ADMIN');
    }
  }

  const statusChanged = nextStatus !== enquiry.status;
  enquiry.status = nextStatus;
  enquiry.priority = priority;
  enquiry.assignedAdmin = assignedAdmin;
  enquiry.internalNotes = internalNotes;

  if (customerMessage) {
    enquiry.responses.push({ message: customerMessage, sentBy: req.user.id });
    enquiry.firstRespondedAt ||= new Date();
  }
  if (statusChanged) {
    enquiry.statusHistory.push({
      status: nextStatus,
      note: customerMessage || cleanText(req.body.statusNote) || `Enquiry moved to ${nextStatus}`,
      changedByType: 'admin',
      changedBy: req.user.id,
    });
    if (nextStatus === 'resolved') enquiry.resolvedAt = new Date();
    if (nextStatus === 'closed') enquiry.closedAt = new Date();
    if (!['resolved', 'closed'].includes(nextStatus)) enquiry.resolvedAt = undefined;
    if (nextStatus !== 'closed') enquiry.closedAt = undefined;
  }
  await enquiry.save();

  await logAudit(req, {
    action: 'update',
    resourceType: 'SupportEnquiry',
    resourceId: enquiry._id,
    resourceLabel: enquiry.enquiryNumber,
    description: 'Admin updated a customer support enquiry',
    statusCode: 200,
  });
  emitToUser(enquiry.user, 'supportEnquiry:updated', {
    id: enquiry._id,
    status: enquiry.status,
    enquiryNumber: enquiry.enquiryNumber,
  });
  emitToRoles(MANAGEMENT_ROLES, 'supportEnquiry:updated', {
    id: enquiry._id,
    status: enquiry.status,
    assignedAdmin: enquiry.assignedAdmin,
  });

  if (customerMessage || statusChanged) {
    await safeNotify(() => notifyUser({
      userId: enquiry.user,
      type: 'support',
      title: customerMessage ? 'Client Care replied' : 'Enquiry status updated',
      message: customerMessage.slice(0, 1800) || `${enquiry.enquiryNumber} is now ${nextStatus}.`,
      data: { enquiryId: enquiry._id, enquiryNumber: enquiry.enquiryNumber, status: nextStatus },
      action: { type: 'screen', value: '/content/support', label: 'View enquiry' },
      priority: nextStatus === 'waitingForCustomer' ? 'high' : 'normal',
      createdBy: req.user.id,
    }), 'Support customer');
  }

  const updated = await SupportEnquiry.findById(enquiry._id)
    .select('+internalNotes')
    .populate('user', 'firstName lastName email phone')
    .populate('assignedAdmin', 'firstName lastName email role')
    .populate('responses.sentBy', 'firstName lastName role');
  return ApiResponse.success(res, { message: 'Support enquiry updated', data: updated });
});

module.exports = {
  createEnquiry,
  listMyEnquiries,
  replyToEnquiry,
  listEnquiriesAdmin,
  listSupportAgents,
  getEnquiryAdmin,
  updateEnquiryAdmin,
};
