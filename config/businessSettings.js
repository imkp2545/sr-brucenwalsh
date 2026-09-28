const AppError = require('../utils/appError');

const asBoolean = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['true', '1'].includes(String(value).toLowerCase())) return true;
  if (['false', '0'].includes(String(value).toLowerCase())) return false;
  return fallback;
};

const definitions = [
  {
    key: 'app.version', section: 'customerApp', group: 'app', label: 'Current app version',
    description: 'Version currently available to customers.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.APP_VERSION || '1.0.0', validation: { required: true, pattern: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, maximumLength: 40 },
  },
  {
    key: 'app.minimum_version', section: 'customerApp', group: 'app', label: 'Minimum supported version',
    description: 'Older customer app versions can be asked to update.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.APP_MINIMUM_VERSION || '1.0.0', validation: { required: true, pattern: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, maximumLength: 40 },
  },
  {
    key: 'app.force_update', section: 'customerApp', group: 'app', label: 'Require app update',
    description: 'Tells the customer application to require an update before continuing.', valueType: 'boolean', isPublic: true,
    defaultValue: () => asBoolean(process.env.APP_FORCE_UPDATE, false),
  },
  {
    key: 'maintenance.enabled', section: 'availability', group: 'maintenance', label: 'Maintenance mode',
    description: 'Temporarily shows the maintenance message in the customer application.', valueType: 'boolean', isPublic: true,
    defaultValue: () => asBoolean(process.env.MAINTENANCE_MODE, false),
  },
  {
    key: 'maintenance.message', section: 'availability', group: 'maintenance', label: 'Maintenance message',
    description: 'Message customers see while maintenance mode is enabled.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.MAINTENANCE_MESSAGE || 'Scheduled maintenance is in progress.', validation: { required: true, maximumLength: 300 },
  },
  {
    key: 'appointment.home_visit_min_product_price', section: 'appointments', group: 'appointment', label: 'Minimum product value',
    description: 'Minimum product price eligible for a home appointment.', valueType: 'number', isPublic: true,
    defaultValue: () => Number(process.env.HOME_VISIT_MIN_PRODUCT_PRICE) || 100000, validation: { minimum: 0, maximum: 100000000 },
  },
  {
    key: 'appointment.cancellation_hours', section: 'appointments', group: 'appointment', label: 'Cancellation notice',
    description: 'Hours before a confirmed appointment when online cancellation closes.', valueType: 'number', isPublic: true,
    defaultValue: () => Number(process.env.HOME_VISIT_CANCELLATION_HOURS) || 12, validation: { minimum: 1, maximum: 168, integer: true },
  },
  {
    key: 'return.window_days', section: 'returns', group: 'return', label: 'Return window',
    description: 'Days after delivery during which an eligible return can be requested.', valueType: 'number', isPublic: true,
    defaultValue: () => Number(process.env.RETURN_WINDOW_DAYS) || 7, validation: { minimum: 1, maximum: 365, integer: true },
  },
  {
    key: 'store.support_email', section: 'support', group: 'store', label: 'Support email',
    description: 'Customer-facing email for order and service assistance.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.INVOICE_EMAIL || process.env.SMTP_FROM_EMAIL || '', validation: { maximumLength: 180, pattern: /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  },
  {
    key: 'store.support_phone', section: 'support', group: 'store', label: 'Support phone',
    description: 'Customer-facing phone number, including country code when required.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.INVOICE_PHONE || '', validation: { maximumLength: 30, pattern: /^$|^[+()\d\s-]{7,30}$/ },
  },
  {
    key: 'store.address', section: 'support', group: 'store', label: 'Store address',
    description: 'Address shown to customers for appointments and in-store assistance.', valueType: 'string', isPublic: true,
    defaultValue: () => [process.env.INVOICE_ADDRESS_LINE1, process.env.INVOICE_ADDRESS_LINE2].filter(Boolean).join(', '), validation: { maximumLength: 300 },
  },
  {
    key: 'store.business_hours', section: 'support', group: 'store', label: 'Business hours',
    description: 'Customer-facing opening hours.', valueType: 'string', isPublic: true,
    defaultValue: () => process.env.STORE_BUSINESS_HOURS || 'Monday to Saturday, 10:00 AM to 7:00 PM', validation: { maximumLength: 180 },
  },
];

const sections = [
  { id: 'customerApp', title: 'Customer app', description: 'Version compatibility and update controls.' },
  { id: 'availability', title: 'Service availability', description: 'Customer-facing maintenance controls.' },
  { id: 'appointments', title: 'Appointments', description: 'Eligibility and cancellation rules for home consultations.' },
  { id: 'returns', title: 'Returns', description: 'Customer return eligibility window.' },
  { id: 'support', title: 'Customer support', description: 'Contact information displayed in customer experiences.' },
];

const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));

const normalizeBusinessSetting = (definition, input) => {
  const validation = definition.validation || {};
  let value = input;

  if (definition.valueType === 'boolean') {
    if (typeof input === 'boolean') value = input;
    else if (['true', '1'].includes(String(input).toLowerCase())) value = true;
    else if (['false', '0'].includes(String(input).toLowerCase())) value = false;
    else throw new AppError(`${definition.label} must be enabled or disabled`, 422, 'INVALID_SETTING_VALUE');
  } else if (definition.valueType === 'number') {
    value = Number(input);
    if (!Number.isFinite(value)) throw new AppError(`${definition.label} must be a number`, 422, 'INVALID_SETTING_VALUE');
    if (validation.integer && !Number.isInteger(value)) throw new AppError(`${definition.label} must be a whole number`, 422, 'INVALID_SETTING_VALUE');
    if (validation.minimum !== undefined && value < validation.minimum) throw new AppError(`${definition.label} cannot be below ${validation.minimum}`, 422, 'INVALID_SETTING_VALUE');
    if (validation.maximum !== undefined && value > validation.maximum) throw new AppError(`${definition.label} cannot exceed ${validation.maximum}`, 422, 'INVALID_SETTING_VALUE');
  } else {
    value = String(input ?? '').trim();
    if (validation.required && !value) throw new AppError(`${definition.label} is required`, 422, 'INVALID_SETTING_VALUE');
    if (validation.maximumLength && value.length > validation.maximumLength) throw new AppError(`${definition.label} is too long`, 422, 'INVALID_SETTING_VALUE');
    if (validation.pattern && !validation.pattern.test(value)) throw new AppError(`${definition.label} has an invalid format`, 422, 'INVALID_SETTING_VALUE');
  }

  return value;
};

const defaultFor = (definition) => definition.defaultValue();

module.exports = {
  businessSettingDefinitions: definitions,
  businessSettingSections: sections,
  businessSettingDefinitionByKey: definitionByKey,
  normalizeBusinessSetting,
  defaultFor,
};
