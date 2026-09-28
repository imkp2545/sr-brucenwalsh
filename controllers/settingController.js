const crypto = require('crypto');
const Setting = require('../models/settingModel');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const { logAudit } = require('../utils/auditLogUtils');
const {
  businessSettingDefinitions,
  businessSettingSections,
  businessSettingDefinitionByKey,
  normalizeBusinessSetting,
  defaultFor,
} = require('../config/businessSettings');

const PUBLIC_KEYS = businessSettingDefinitions.filter((definition) => definition.isPublic).map((definition) => definition.key);

const RETIRED_BILLING_KEYS = [
  'shipping.free_threshold',
  'shipping.standard_charge',
  'insurance.enabled',
  'insurance.rate_percent',
  'insurance.maximum_charge',
  'tax.prices_include_gst',
];

const encryptionKey = () => {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error('SETTINGS_ENCRYPTION_KEY must contain at least 32 characters');
  return crypto.createHash('sha256').update(secret).digest();
};

const encryptValue = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
};

const normalizeValue = (value, valueType) => {
  if (value === undefined) return undefined;
  if (valueType === 'string') return String(value);
  if (valueType === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new AppError('Setting value must be a number', 422, 'INVALID_SETTING_VALUE');
    return number;
  }
  if (valueType === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (['true', '1'].includes(String(value).toLowerCase())) return true;
    if (['false', '0'].includes(String(value).toLowerCase())) return false;
    throw new AppError('Setting value must be boolean', 422, 'INVALID_SETTING_VALUE');
  }
  if (valueType === 'array') {
    if (!Array.isArray(value)) throw new AppError('Setting value must be an array', 422, 'INVALID_SETTING_VALUE');
    return value;
  }
  if (valueType === 'json') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Setting value must be an object', 422, 'INVALID_SETTING_VALUE');
    return value;
  }
  if (valueType === 'date') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new AppError('Setting value must be a valid date', 422, 'INVALID_SETTING_VALUE');
    return date;
  }
  throw new AppError('Invalid setting value type', 422, 'INVALID_SETTING_TYPE');
};

const maskedSetting = (setting) => {
  const object = setting.toObject ? setting.toObject() : { ...setting };
  if (object.isSensitive) {
    object.value = undefined;
    object.defaultValue = undefined;
    object.isConfigured = Boolean(setting.value);
  }
  return object;
};

const getPublicSettings = asyncHandler(async (_req, res) => {
  const settings = await Setting.find({ key: { $in: PUBLIC_KEYS }, isPublic: true, isSensitive: false }).select('key value updatedAt').lean();
  const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
  const valueFor = (key) => values[key] ?? defaultFor(businessSettingDefinitionByKey.get(key));
  return ApiResponse.success(res, {
    data: {
      app: {
        version: valueFor('app.version'),
        minimumVersion: valueFor('app.minimum_version'),
        forceUpdate: valueFor('app.force_update'),
      },
      maintenance: {
        enabled: valueFor('maintenance.enabled'),
        message: valueFor('maintenance.message'),
      },
      policies: {
        homeVisitMinimumProductPrice: valueFor('appointment.home_visit_min_product_price'),
        homeVisitCancellationHours: valueFor('appointment.cancellation_hours'),
        returnWindowDays: valueFor('return.window_days'),
      },
      support: {
        email: valueFor('store.support_email'),
        phone: valueFor('store.support_phone'),
        address: valueFor('store.address'),
        businessHours: valueFor('store.business_hours'),
      },
    },
  });
});

const getBusinessSettings = asyncHandler(async (_req, res) => {
  const keys = businessSettingDefinitions.map((definition) => definition.key);
  const stored = await Setting.find({ key: { $in: keys } }).select('key value updatedAt updatedBy').lean();
  const storedByKey = new Map(stored.map((setting) => [setting.key, setting]));
  const sectionPayload = businessSettingSections.map((section) => ({
    ...section,
    settings: businessSettingDefinitions
      .filter((definition) => definition.section === section.id)
      .map((definition) => {
        const setting = storedByKey.get(definition.key);
        return {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          valueType: definition.valueType,
          value: setting?.value ?? defaultFor(definition),
          validation: definition.validation || {},
          isConfigured: Boolean(setting),
          updatedAt: setting?.updatedAt || null,
        };
      }),
  }));
  return ApiResponse.success(res, { data: { sections: sectionPayload } });
});

const updateBusinessSettings = asyncHandler(async (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new AppError('Settings values must be provided', 422, 'VALIDATION_ERROR');
  }
  const entries = Object.entries(values);
  if (!entries.length) throw new AppError('Select at least one setting to save', 422, 'VALIDATION_ERROR');

  const normalized = entries.map(([key, input]) => {
    const definition = businessSettingDefinitionByKey.get(key);
    if (!definition) throw new AppError(`Setting ${key} cannot be managed from this page`, 422, 'SETTING_NOT_ALLOWED');
    return { definition, value: normalizeBusinessSetting(definition, input) };
  });

  await Setting.bulkWrite(normalized.map(({ definition, value }) => ({
    updateOne: {
      filter: { key: definition.key },
      update: {
        $set: {
          group: definition.group,
          label: definition.label,
          description: definition.description,
          valueType: definition.valueType,
          value,
          validation: definition.validation || {},
          isPublic: definition.isPublic === true,
          isEditable: true,
          isSensitive: false,
          updatedBy: req.user.id,
        },
      },
      upsert: true,
    },
  })), { ordered: true });

  await logAudit(req, {
    action: 'update', resourceType: 'Setting', resourceLabel: 'Business settings',
    description: 'Business settings updated', statusCode: 200,
    metadata: { keys: normalized.map(({ definition }) => definition.key) },
  });
  return ApiResponse.success(res, { message: 'Settings saved successfully' });
});

const listSettingsAdmin = asyncHandler(async (req, res) => {
  const filter = { key: { $nin: RETIRED_BILLING_KEYS } };
  if (req.query.group) filter.group = req.query.group;
  const settings = await Setting.find(filter).sort({ group: 1, key: 1 });
  return ApiResponse.success(res, { data: settings.map(maskedSetting) });
});

const getSettingAdmin = asyncHandler(async (req, res) => {
  const setting = await Setting.findOne({ key: String(req.params.key).toLowerCase() });
  if (!setting) throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
  return ApiResponse.success(res, { data: maskedSetting(setting) });
});

const upsertSetting = asyncHandler(async (req, res) => {
  const key = String(req.params.key || req.body.key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,149}$/.test(key)) throw new AppError('Invalid setting key', 422, 'INVALID_SETTING_KEY');
  if (businessSettingDefinitionByKey.has(key)) {
    throw new AppError('Use the controlled business settings endpoint for this setting', 409, 'MANAGED_SETTING');
  }
  if (RETIRED_BILLING_KEYS.includes(key)) {
    throw new AppError('This setting is retired by the fixed GST billing policy', 409, 'SETTING_RETIRED');
  }
  let setting = await Setting.findOne({ key });
  if (setting && !setting.isEditable) throw new AppError('This setting cannot be edited', 403, 'SETTING_NOT_EDITABLE');
  if (setting?.isSensitive && req.body.isSensitive === false) throw new AppError('Sensitive settings cannot be converted to public values', 403, 'SENSITIVE_SETTING_PROTECTED');

  const valueType = req.body.valueType || setting?.valueType;
  if (!valueType) throw new AppError('valueType is required', 422, 'VALIDATION_ERROR');
  const isSensitive = setting?.isSensitive || req.body.isSensitive === true;
  let value = normalizeValue(req.body.value, valueType);
  if (setting && valueType !== setting.valueType && value === undefined) {
    throw new AppError('A new value is required when changing valueType', 422, 'SETTING_VALUE_REQUIRED');
  }
  if (!setting && value === undefined) throw new AppError('Setting value is required', 422, 'VALIDATION_ERROR');
  if (value !== undefined && isSensitive) value = encryptValue(value);

  if (!setting) {
    setting = new Setting({
      key,
      group: req.body.group,
      label: req.body.label,
      description: req.body.description,
      valueType,
      value,
      defaultValue: isSensitive ? undefined : req.body.defaultValue,
      validation: req.body.validation,
      isPublic: PUBLIC_KEYS.includes(key) && req.body.isPublic === true && !isSensitive,
      isEditable: req.body.isEditable !== false,
      isSensitive,
      updatedBy: req.user.id,
    });
  } else {
    for (const field of ['group', 'label', 'description', 'validation', 'isEditable']) {
      if (req.body[field] !== undefined) setting[field] = req.body[field];
    }
    if (req.body.defaultValue !== undefined && !isSensitive) setting.defaultValue = req.body.defaultValue;
    setting.valueType = valueType;
    if (value !== undefined) setting.value = value;
    setting.isSensitive = isSensitive;
    if (isSensitive) setting.isPublic = false;
    if (req.body.isPublic !== undefined) setting.isPublic = PUBLIC_KEYS.includes(key) && req.body.isPublic === true && !isSensitive;
    setting.updatedBy = req.user.id;
  }
  const wasNew = setting.isNew;
  await setting.save();
  await logAudit(req, {
    action: wasNew ? 'create' : 'update', resourceType: 'Setting', resourceId: setting._id,
    resourceLabel: setting.key, description: 'Application setting saved', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Setting saved', data: maskedSetting(setting) });
});

const deleteSetting = asyncHandler(async (req, res) => {
  const key = String(req.params.key).toLowerCase();
  if (businessSettingDefinitionByKey.has(key)) {
    throw new AppError('Managed business settings cannot be deleted', 409, 'MANAGED_SETTING');
  }
  const setting = await Setting.findOne({ key });
  if (!setting) throw new AppError('Setting not found', 404, 'SETTING_NOT_FOUND');
  if (!setting.isEditable) throw new AppError('This setting cannot be deleted', 403, 'SETTING_NOT_EDITABLE');
  await setting.deleteOne();
  await logAudit(req, {
    action: 'delete', resourceType: 'Setting', resourceId: setting._id,
    resourceLabel: setting.key, description: 'Application setting deleted', statusCode: 200,
  });
  return ApiResponse.success(res, { message: 'Setting deleted' });
});

module.exports = {
  getPublicSettings,
  getBusinessSettings,
  updateBusinessSettings,
  listSettingsAdmin,
  getSettingAdmin,
  upsertSetting,
  deleteSetting,
};
