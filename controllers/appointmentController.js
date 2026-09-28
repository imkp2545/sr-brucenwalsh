const mongoose = require('mongoose');
const Appointment = require('../models/appointmentModel');
const Product = require('../models/productModel');
const Admin = require('../models/adminModel');
const User = require('../models/userModel');
const Setting = require('../models/settingModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { generateAppointmentNumber } = require('../utils/orderNumberUtils');
const { notifyUser, notifyRoles, emitToUser, emitToRoles } = require('../utils/notificationUtils');
const { logAudit } = require('../utils/auditLogUtils');
const { applyStatusFilter, summarizeStatusFields } = require('../utils/statusSummaryUtils');

const ACTIVE_STATUSES = ['confirmed', 'rescheduled', 'enRoute'];
const CUSTOMER_CANCELLABLE_STATUSES = ['requested', 'underReview', 'confirmed', 'rescheduled'];
const HOME_VISIT_MINIMUM_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSITIONS = {
  requested: ['underReview', 'rejected', 'cancelled'],
  underReview: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['rescheduled', 'enRoute', 'cancelled'],
  rescheduled: ['confirmed', 'enRoute', 'cancelled'],
  enRoute: ['completed', 'cancelled', 'noShow'],
  completed: [],
  rejected: [],
  cancelled: [],
  noShow: [],
};

const safeNotify = async (options) => {
  try { return await notifyUser(options); } catch (error) {
    console.error('Appointment notification failed', error.message);
    return null;
  }
};

const validateSchedule = (startValue, endValue) => {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new AppError('Valid appointment dates are required', 422, 'INVALID_SCHEDULE');
  if (start <= new Date(Date.now() + 30 * 60 * 1000)) throw new AppError('Appointment must be booked at least 30 minutes in advance', 422, 'INVALID_SCHEDULE');
  if (end <= start || end - start > 4 * 60 * 60 * 1000) throw new AppError('Appointment duration must be between 1 minute and 4 hours', 422, 'INVALID_SCHEDULE');
  return { start, end };
};

const validatePreferredSlots = (slots) => {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 3) {
    throw new AppError('Provide between one and three preferred home-visit slots', 422, 'INVALID_PREFERRED_SLOTS');
  }
  return slots.map((slot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError('Every preferred slot must contain valid start and end dates', 422, 'INVALID_PREFERRED_SLOTS');
    }
    if (start < new Date(Date.now() + HOME_VISIT_MINIMUM_NOTICE_MS)) {
      throw new AppError('Preferred home visits must be requested at least 7 days in advance', 422, 'INVALID_PREFERRED_SLOTS');
    }
    const duration = end - start;
    if (duration < 60 * 60 * 1000 || duration > 4 * 60 * 60 * 1000) {
      throw new AppError('Each preferred slot must be between one and four hours', 422, 'INVALID_PREFERRED_SLOTS');
    }
    return { start, end };
  });
};

const getMinimumHomeVisitPrice = async () => {
  const setting = await Setting.findOne({ key: 'appointment.home_visit_min_product_price' }).lean();
  const value = Number(setting?.value ?? process.env.HOME_VISIT_MIN_PRODUCT_PRICE ?? 100000);
  return Number.isFinite(value) && value >= 0 ? value : 100000;
};

const getCancellationNoticeHours = async () => {
  const setting = await Setting.findOne({ key: 'appointment.cancellation_hours' }).lean();
  const value = Number(setting?.value ?? process.env.HOME_VISIT_CANCELLATION_HOURS ?? 12);
  return Number.isFinite(value) && value >= 1 ? value : 12;
};

const assertNoConflict = async ({ userId, assignedAdmin, start, end, excludeId }) => {
  const base = {
    _id: { $ne: excludeId || new mongoose.Types.ObjectId() },
    status: { $in: ACTIVE_STATUSES },
    scheduledStart: { $lt: end },
    scheduledEnd: { $gt: start },
  };
  const conflicts = [Appointment.exists({ ...base, user: userId })];
  if (assignedAdmin) conflicts.push(Appointment.exists({ ...base, assignedAdmin }));
  const [userConflict, adminConflict] = await Promise.all(conflicts);
  if (userConflict) throw new AppError('You already have an appointment during this time', 409, 'APPOINTMENT_CONFLICT');
  if (adminConflict) throw new AppError('Assigned consultant is unavailable during this time', 409, 'CONSULTANT_UNAVAILABLE');
};

const createWithUniqueNumber = async (data) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await Appointment.create({ ...data, appointmentNumber: generateAppointmentNumber() }); } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to generate a unique appointment number');
};

const bookAppointment = asyncHandler(async (req, res) => {
  const {
    notes,
    productIds = [],
    preferredSlots,
    addressId,
    budget,
    occasion,
    visitRequirements,
    timezone,
  } = req.body;
  if (!Array.isArray(productIds) || !productIds.length) {
    throw new AppError('Select at least one high-end jewellery product for the home visit', 422, 'PRODUCT_REQUIRED');
  }
  const normalizedSlots = validatePreferredSlots(preferredSlots);
  const uniqueProductIds = [...new Set(productIds.map(String))];
  if (uniqueProductIds.some((id) => !mongoose.isValidObjectId(id))) throw new AppError('Invalid product ID', 422, 'INVALID_PRODUCT');

  const [user, products, minimumPrice] = await Promise.all([
    User.findById(req.user.id),
    Product.find({ _id: { $in: uniqueProductIds }, status: 'active', deletedAt: null })
      .select('name price purchaseMode variants.price status'),
    getMinimumHomeVisitPrice(),
  ]);
  if (!user) throw new AppError('Customer not found', 404, 'USER_NOT_FOUND');
  if (products.length !== uniqueProductIds.length) {
    throw new AppError('One or more selected products are unavailable', 422, 'INVALID_PRODUCT');
  }
  const qualifiesForHomeVisit = products.some((product) => {
    if (product.purchaseMode === 'appointmentOnly') return true;
    const prices = [product.price, ...product.variants.map((variant) => variant.price)].filter(Number.isFinite);
    return Math.max(...prices) >= minimumPrice;
  });
  if (!qualifiesForHomeVisit) {
    throw new AppError(
      `Home visits are available for selected jewellery priced at INR ${minimumPrice} or above`,
      422,
      'HOME_VISIT_NOT_ELIGIBLE',
    );
  }

  const address = addressId
    ? user.addresses.id(addressId)
    : (user.addresses.find((item) => item.isDefault) || user.addresses[0]);
  if (!address) {
    throw new AppError('Add or select a delivery address for the home visit', 422, 'HOME_VISIT_ADDRESS_REQUIRED');
  }
  if (budget) {
    const minimum = Number(budget.minimum || 0);
    const maximum = Number(budget.maximum || 0);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) {
      throw new AppError('Budget range is invalid', 422, 'INVALID_BUDGET');
    }
  }

  const appointment = await createWithUniqueNumber({
    user: req.user.id,
    type: 'homeVisit',
    subject: 'High-End Jewellery Home Visit',
    notes,
    productIds: uniqueProductIds,
    customerSnapshot: {
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      phone: user.phone || address.phone,
    },
    visitAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    },
    preferredSlots: normalizedSlots,
    budget,
    occasion,
    visitRequirements,
    timezone,
    statusHistory: [{
      status: 'requested',
      note: 'Customer requested a high-end jewellery home visit',
      changedByType: 'user',
      changedBy: req.user.id,
    }],
  });
  await logAudit(req, {
    action: 'create', resourceType: 'Appointment', resourceId: appointment._id,
    resourceLabel: appointment.appointmentNumber, description: 'Customer requested a high-end jewellery home visit', statusCode: 201,
  });
  emitToRoles(['superAdmin', 'admin', 'supportManager'], 'appointment:created', appointment.toObject());
  try {
    await notifyRoles({
      roles: ['superAdmin', 'admin', 'supportManager'],
      type: 'appointment',
      title: 'New home-visit request',
      message: `${appointment.customerSnapshot.name} requested home visit ${appointment.appointmentNumber}.`,
      data: { appointmentId: appointment._id, appointmentNumber: appointment.appointmentNumber },
      priority: 'high',
    });
  } catch (error) { console.error('Home-visit admin notification failed', error.message); }
  await safeNotify({
    userId: req.user.id, type: 'appointment', title: 'Home-visit request received',
    message: `Your home-visit request ${appointment.appointmentNumber} is awaiting review.`,
    data: { appointmentId: appointment._id, status: appointment.status },
    action: { type: 'appointment', value: String(appointment._id), label: 'View appointment' },
  });
  return ApiResponse.success(res, { statusCode: 201, message: 'Home-visit request submitted', data: appointment });
});

const listMyAppointments = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const filter = { user: req.user.id };
  if (req.query.status) filter.status = req.query.status;
  const [appointments, total] = await Promise.all([
    Appointment.find(filter).populate('productIds', 'name slug images purchaseMode').populate('assignedAdmin', 'firstName lastName phone')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Appointment.countDocuments(filter),
  ]);
  return ApiResponse.success(res, { data: appointments, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

const getAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findOne({ _id: req.params.appointmentId, user: req.user.id })
    .populate('productIds', 'name slug images purchaseMode').populate('assignedAdmin', 'firstName lastName phone');
  if (!appointment) throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
  return ApiResponse.success(res, { data: appointment });
});

const cancelAppointment = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findOne({ _id: req.params.appointmentId, user: req.user.id });
  if (!appointment) throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(appointment.status)) {
    throw new AppError('This home visit can no longer be cancelled online', 409, 'INVALID_STATUS_TRANSITION');
  }
  const cancellationHours = await getCancellationNoticeHours();
  if (appointment.scheduledStart && appointment.scheduledStart.getTime() - Date.now() < cancellationHours * 60 * 60 * 1000) {
    throw new AppError(
      `Confirmed home visits must be cancelled at least ${cancellationHours} hours in advance`,
      409,
      'CANCELLATION_WINDOW_CLOSED',
    );
  }
  appointment.status = 'cancelled';
  appointment.cancellation = {
    cancelledByType: 'user', cancelledBy: req.user.id, cancelledByModel: 'User',
    reason: req.body.reason || 'Cancelled by customer', cancelledAt: new Date(),
  };
  appointment.statusHistory.push({
    status: 'cancelled',
    note: appointment.cancellation.reason,
    changedByType: 'user',
    changedBy: req.user.id,
  });
  await appointment.save();
  await logAudit(req, { action: 'cancel', resourceType: 'Appointment', resourceId: appointment._id, description: 'Customer cancelled appointment', statusCode: 200 });
  emitToRoles(['superAdmin', 'admin', 'supportManager'], 'appointment:updated', { id: appointment._id, status: appointment.status });
  return ApiResponse.success(res, { message: 'Home visit cancelled', data: appointment });
});

const listAppointmentsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.assignedAdmin && mongoose.isValidObjectId(req.query.assignedAdmin)) {
    baseFilter.assignedAdmin = req.query.assignedAdmin;
  }
  if (req.query.search) {
    const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      const search = new RegExp(escaped, 'i');
      baseFilter.$or = [
        { appointmentNumber: search },
        { 'customerSnapshot.name': search },
        { 'customerSnapshot.email': search },
        { 'customerSnapshot.phone': search },
      ];
    }
  }
  if (req.query.from || req.query.to) {
    baseFilter.scheduledStart = {};
    if (req.query.from) baseFilter.scheduledStart.$gte = new Date(req.query.from);
    if (req.query.to) baseFilter.scheduledStart.$lte = new Date(req.query.to);
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, 'status', req.query.status);
  const requestedSort = String(req.query.sort || '');
  const sortField = requestedSort.replace(/^-/, '');
  const sort = ['appointmentNumber', 'status', 'scheduledStart', 'createdAt'].includes(sortField)
    ? { [sortField]: requestedSort.startsWith('-') ? -1 : 1 }
    : { createdAt: -1 };
  const [appointments, total, summary] = await Promise.all([
    Appointment.find(filter).populate('user', 'firstName lastName email phone')
      .populate('productIds', 'name slug sku price purchaseMode images')
      .populate('assignedAdmin', 'firstName lastName role phone').sort(sort)
      .skip((page - 1) * limit).limit(limit),
    Appointment.countDocuments(filter),
    summarizeStatusFields(Appointment, baseFilter),
  ]);
  return ApiResponse.success(res, {
    data: appointments,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const listAppointmentConsultants = asyncHandler(async (_req, res) => {
  const consultants = await Admin.find({
    role: { $in: ['superAdmin', 'admin', 'supportManager'] },
    status: 'active',
    deletedAt: null,
  })
    .select('firstName lastName email phone role')
    .sort({ firstName: 1, lastName: 1 });

  return ApiResponse.success(res, { data: consultants });
});

const getAppointmentAdmin = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.appointmentId)
    .select('+internalNotes')
    .populate('user', 'firstName lastName email phone addresses')
    .populate('productIds', 'name slug sku price purchaseMode images variants')
    .populate('assignedAdmin', 'firstName lastName email phone role')
    .populate('reviewedBy', 'firstName lastName role');
  if (!appointment) throw new AppError('Home-visit request not found', 404, 'APPOINTMENT_NOT_FOUND');
  return ApiResponse.success(res, { data: appointment });
});

const updateAppointmentAdmin = asyncHandler(async (req, res) => {
  const appointment = await Appointment.findById(req.params.appointmentId);
  if (!appointment) throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
  const nextStatus = req.body.status;
  if (nextStatus && !TRANSITIONS[appointment.status]?.includes(nextStatus)) {
    throw new AppError(`Cannot change home visit from ${appointment.status} to ${nextStatus}`, 409, 'INVALID_STATUS_TRANSITION');
  }

  const assignedAdmin = req.body.assignedAdmin !== undefined ? req.body.assignedAdmin : appointment.assignedAdmin;
  if (assignedAdmin) {
    const adminExists = await Admin.exists({
      _id: assignedAdmin,
      role: { $in: ['superAdmin', 'admin', 'supportManager'] },
      status: 'active',
      deletedAt: null,
    });
    if (!adminExists) throw new AppError('Assigned consultant is unavailable', 422, 'INVALID_ADMIN');
  }
  let start = appointment.scheduledStart;
  let end = appointment.scheduledEnd;
  if (req.body.scheduledStart || req.body.scheduledEnd) {
    ({ start, end } = validateSchedule(req.body.scheduledStart || start, req.body.scheduledEnd || end));
  }
  if (start && end && (assignedAdmin || req.body.scheduledStart || req.body.scheduledEnd)) {
    await assertNoConflict({ userId: appointment.user, assignedAdmin, start, end, excludeId: appointment._id });
  }

  if (['confirmed', 'rescheduled'].includes(nextStatus)) {
    if (!assignedAdmin || !start || !end) {
      throw new AppError(
        'Confirming a home visit requires an assigned consultant and scheduled start/end time',
        422,
        'HOME_VISIT_SCHEDULE_REQUIRED',
      );
    }
  }
  if (nextStatus === 'rescheduled' && !req.body.scheduledStart && !req.body.scheduledEnd) {
    throw new AppError('A new schedule is required when rescheduling a home visit', 422, 'NEW_SCHEDULE_REQUIRED');
  }
  if (nextStatus === 'rejected' && !req.body.reason) {
    throw new AppError('A rejection reason is required', 422, 'REJECTION_REASON_REQUIRED');
  }
  if (nextStatus === 'completed' && !req.body.outcome?.visitSummary) {
    throw new AppError('A visit summary is required to complete a home visit', 422, 'VISIT_OUTCOME_REQUIRED');
  }

  if (nextStatus) appointment.status = nextStatus;
  appointment.assignedAdmin = assignedAdmin || null;
  appointment.scheduledStart = start;
  appointment.scheduledEnd = end;
  for (const key of ['internalNotes', 'visitRequirements']) {
    if (req.body[key] !== undefined) appointment[key] = req.body[key];
  }
  if (req.body.outcome !== undefined) appointment.outcome = req.body.outcome;
  if (nextStatus === 'underReview') {
    appointment.reviewedBy = req.user.id;
    appointment.reviewedAt = new Date();
  }
  if (nextStatus === 'confirmed') appointment.confirmedAt = new Date();
  if (nextStatus === 'enRoute') appointment.enRouteAt = new Date();
  if (nextStatus === 'completed') appointment.completedAt = new Date();
  if (nextStatus === 'rejected') {
    appointment.rejection = {
      reason: req.body.reason,
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
    };
  }
  if (nextStatus === 'cancelled') {
    appointment.cancellation = {
      cancelledByType: 'admin', cancelledBy: req.user.id, cancelledByModel: 'Admin',
      reason: req.body.reason || 'Cancelled by administration', cancelledAt: new Date(),
    };
  }
  if (nextStatus) {
    appointment.statusHistory.push({
      status: nextStatus,
      note: req.body.reason || req.body.note || `Home visit changed to ${nextStatus}`,
      changedByType: 'admin',
      changedBy: req.user.id,
    });
  }
  await appointment.save();
  await logAudit(req, {
    action: 'statusChange', resourceType: 'Appointment', resourceId: appointment._id,
    resourceLabel: appointment.appointmentNumber, description: `Home visit updated to ${appointment.status}`, statusCode: 200,
  });

  const payload = { id: appointment._id, status: appointment.status, scheduledStart: appointment.scheduledStart };
  emitToUser(appointment.user, 'appointment:updated', payload);
  emitToRoles(['superAdmin', 'admin', 'supportManager'], 'appointment:updated', payload);
  await safeNotify({
    userId: appointment.user, type: 'appointment', title: 'Home visit updated',
    message: `Your home visit ${appointment.appointmentNumber} is now ${appointment.status}.`,
    data: { appointmentId: appointment._id, status: appointment.status },
    action: { type: 'appointment', value: String(appointment._id), label: 'View appointment' },
    priority: ['confirmed', 'cancelled', 'rejected', 'rescheduled', 'enRoute'].includes(appointment.status) ? 'high' : 'normal',
    createdBy: req.user.id,
  });
  return ApiResponse.success(res, { message: 'Home visit updated', data: appointment });
});

module.exports = {
  bookAppointment, listMyAppointments, getAppointment, cancelAppointment,
  listAppointmentsAdmin, listAppointmentConsultants, getAppointmentAdmin, updateAppointmentAdmin,
};
