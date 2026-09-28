const crypto = require('crypto');
const AppError = require('./appError');

let tokenCache = { token: null, expiresAt: 0 };

const requiredValue = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Blue Dart integration`);
  return value;
};

const apiBase = () => requiredValue('BLUE_DART_API_URL').replace(/\/$/, '');
const endpoint = (envName, fallback) => process.env[envName] || `${apiBase()}${fallback}`;

const carrierErrorMessages = (body) => {
  const entries = Array.isArray(body?.['error-response']) ? body['error-response'] : [];
  const messageKeys = new Set([
    'msg', 'message', 'Message', 'errorMessage', 'ErrorMessage',
    'description', 'Description', 'reason', 'Reason', 'StatusInformation',
  ]);
  const messages = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    Object.entries(value).forEach(([key, entry]) => {
      if (messageKeys.has(key) && typeof entry === 'string' && entry.trim()) messages.push(entry.trim());
      else if (typeof entry === 'object') visit(entry);
    });
  };
  visit(entries);
  return [...new Set(messages)];
};

const requestJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch (_error) {
      throw new AppError('Blue Dart returned an invalid response', 502, 'CARRIER_INVALID_RESPONSE');
    }
    if (!response.ok) {
      const responseErrors = carrierErrorMessages(body);
      const carrierMessage = body.message || body.error || responseErrors.join('; ') || body.title;
      throw new AppError(
        carrierMessage || 'Blue Dart request failed',
        502,
        'CARRIER_REQUEST_FAILED',
        {
          carrierStatus: response.status,
          carrierMessage: carrierMessage || undefined,
          carrierResponse: process.env.NODE_ENV !== 'production' ? body : undefined,
        },
      );
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new AppError('Blue Dart request timed out', 504, 'CARRIER_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const getAccessToken = async () => {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
  const response = await requestJson(endpoint('BLUE_DART_AUTH_URL', '/token/v1/login'), {
    method: 'GET',
    headers: {
      ClientID: requiredValue('BLUE_DART_CLIENT_ID'),
      clientSecret: requiredValue('BLUE_DART_CLIENT_SECRET'),
      accept: 'application/json',
    },
  });
  const token = response.JWTToken || response.token || response.access_token;
  if (!token) throw new AppError('Blue Dart authentication token is missing', 502, 'CARRIER_AUTH_FAILED');
  const expiresIn = Number(response.expires_in) || 3600;
  tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
};

const carrierHeaders = async () => ({
  JWTToken: await getAccessToken(),
  'content-type': 'application/json',
  accept: 'application/json',
});

const profile = () => ({
  Api_type: 'S',
  LicenceKey: requiredValue('BLUE_DART_LICENSE_KEY'),
  LoginID: requiredValue('BLUE_DART_LOGIN_ID'),
});

const blueDartDate = (date = new Date()) => `/Date(${date.getTime()})/`;
const carrierCreditReference = (shipmentNumber) => {
  const compact = String(shipmentNumber).replace(/[^A-Za-z0-9]/g, '').replace(/^SHP/i, '');
  return `S${compact}`.slice(0, 20);
};
const carrierInvoiceNumber = (value) => {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) throw new AppError('Order invoice number is required for Blue Dart', 422, 'INVALID_INVOICE_NUMBER');
  return compact.slice(-10);
};
const carrierText = (value, maxLength, field, required = false) => {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (required && !normalized) {
    throw new AppError(`${field} is required for Blue Dart`, 422, 'INVALID_CARRIER_PAYLOAD');
  }
  return normalized.slice(0, maxLength);
};
const carrierAlphaNumeric = (value, maxLength, field, required = false) => {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, maxLength);
  if (required && !normalized) {
    throw new AppError(`${field} is required for Blue Dart`, 422, 'INVALID_CARRIER_PAYLOAD');
  }
  return normalized;
};
const carrierPhone = (value, field) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new AppError(`${field} must contain 10 to 15 digits`, 422, 'INVALID_CARRIER_PAYLOAD');
  }
  return digits;
};
const carrierPincode = (value, field) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 6) {
    throw new AppError(`${field} must contain exactly 6 digits`, 422, 'INVALID_CARRIER_PAYLOAD');
  }
  return digits;
};
const carrierEmail = (value, maxLength) => {
  const email = carrierText(value, maxLength, 'Email');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const carrierDimensions = (dimensions) => {
  if (!dimensions) return [];
  const values = {
    Length: Number(dimensions.length),
    Breadth: Number(dimensions.width),
    Height: Number(dimensions.height),
    Count: 1,
  };
  if ([values.Length, values.Breadth, values.Height].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new AppError('All Blue Dart package dimensions must be greater than zero', 422, 'INVALID_CARRIER_DIMENSIONS');
  }
  return [values];
};
const nextPickupDate = (pickupTime) => {
  if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(pickupTime)) {
    throw new AppError('BLUE_DART_PICKUP_TIME must use HHmm format', 500, 'CARRIER_CONFIG_INVALID');
  }
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(Number(pickupTime.slice(0, 2)), Number(pickupTime.slice(2)), 0, 0);
  if (candidate.getTime() <= now.getTime() + (30 * 60 * 1000)) candidate.setDate(candidate.getDate() + 1);
  while (candidate.getDay() === 0) candidate.setDate(candidate.getDate() + 1);
  return candidate;
};
const booleanEnv = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
};

const buildWaybillPayload = ({ shipmentNumber, order, items, weight, dimensions, pickup }) => {
  const address = order.shippingAddress || {};
  const declaredValue = Number(order.grandTotal);
  const actualWeight = Number(weight);
  if (!Number.isFinite(declaredValue) || declaredValue <= 0) {
    throw new AppError('Order declared value must be greater than zero', 422, 'INVALID_DECLARED_VALUE');
  }
  if (!Number.isFinite(actualWeight) || actualWeight <= 0) {
    throw new AppError('Shipment weight must be greater than zero', 422, 'INVALID_WEIGHT');
  }

  const productCode = carrierAlphaNumeric(process.env.BLUE_DART_PRODUCT_CODE || 'A', 1, 'Product code', true);
  const subProductCode = carrierAlphaNumeric(process.env.BLUE_DART_SUB_PRODUCT_CODE || 'P', 1, 'Sub-product code');
  if (subProductCode && !['C', 'P', 'D', 'A', 'B'].includes(subProductCode)) {
    throw new AppError('Blue Dart sub-product code is invalid', 500, 'CARRIER_CONFIG_INVALID');
  }
  const pickupTime = process.env.BLUE_DART_PICKUP_TIME || '1600';
  const productType = Number(process.env.BLUE_DART_PRODUCT_TYPE ?? 1);
  if (!Number.isInteger(productType) || ![0, 1].includes(productType)) {
    throw new AppError('BLUE_DART_PRODUCT_TYPE must be 0 or 1', 500, 'CARRIER_CONFIG_INVALID');
  }

  const commodityValues = (items || [])
    .map((item) => carrierAlphaNumeric(item.sku || item.name, 30, 'Commodity'))
    .filter(Boolean)
    .slice(0, 3);
  if (!commodityValues.length) commodityValues.push('JEWELLERY');
  const commodity = Object.fromEntries(commodityValues.map((value, index) => [`CommodityDetail${index + 1}`, value]));

  const consigneeLine2 = [address.line2, address.landmark].filter(Boolean).join(', ');
  const consigneeEmail = carrierEmail(address.email, 50);
  const vendorCode = carrierAlphaNumeric(pickup.vendorCode, 9, 'Vendor code');
  const packType = carrierAlphaNumeric(process.env.BLUE_DART_PACK_TYPE || 'L', 1, 'Pack type', true);
  const services = {
    AWBNo: '',
    ActualWeight: actualWeight,
    CollectableAmount: 0,
    Commodity: commodity,
    CreditReferenceNo: carrierCreditReference(shipmentNumber),
    DeclaredValue: declaredValue,
    Dimensions: carrierDimensions(dimensions),
    InvoiceNo: carrierInvoiceNumber(order.invoiceNumber || order.orderNumber),
    PDFOutputNotRequired: false,
    PickupDate: blueDartDate(nextPickupDate(pickupTime)),
    PickupTime: pickupTime,
    PieceCount: 1,
    ProductCode: productCode,
    ProductType: productType,
    RegisterPickup: booleanEnv('BLUE_DART_REGISTER_PICKUP', true),
    SubProductCode: subProductCode,
  };
  if (packType) services.PackType = packType;

  return {
    Request: {
      Consignee: {
        ConsigneeAddress1: carrierText(address.line1, 30, 'Consignee address', true),
        ConsigneeAddress2: carrierText(consigneeLine2, 30, 'Consignee address line 2'),
        ConsigneeAddress3: carrierText([address.city, address.state].filter(Boolean).join(', '), 30, 'Consignee address line 3'),
        ConsigneeAddressType: 'R',
        ...(consigneeEmail ? { ConsigneeEmailID: consigneeEmail } : {}),
        ConsigneeMobile: carrierPhone(address.phone, 'Consignee mobile'),
        ConsigneeName: carrierText(address.recipientName, 30, 'Consignee name', true),
        ConsigneePincode: carrierPincode(address.postalCode, 'Consignee pincode'),
      },
      Returnadds: {
        ReturnAddress1: carrierText(pickup.line1, 30, 'Return address', true),
        ReturnAddress2: carrierText(pickup.line2, 30, 'Return address line 2'),
        ReturnAddress3: carrierText([pickup.city, pickup.state].filter(Boolean).join(', '), 25, 'Return address line 3'),
        ReturnContact: carrierText(pickup.name, 20, 'Return contact', true),
        ReturnMobile: carrierPhone(pickup.phone, 'Return mobile'),
        ReturnPincode: carrierPincode(pickup.postalCode, 'Return pincode'),
      },
      Services: services,
      Shipper: {
        CustomerAddress1: carrierText(pickup.line1, 30, 'Customer address', true),
        CustomerAddress2: carrierText(pickup.line2, 30, 'Customer address line 2'),
        CustomerAddress3: carrierText([pickup.city, pickup.state].filter(Boolean).join(', '), 30, 'Customer address line 3'),
        CustomerCode: carrierAlphaNumeric(requiredValue('BLUE_DART_CUSTOMER_CODE'), 6, 'Customer code', true),
        CustomerMobile: carrierPhone(pickup.phone, 'Customer mobile'),
        CustomerName: carrierText(pickup.name, 30, 'Customer name', true),
        CustomerPincode: carrierPincode(pickup.postalCode, 'Customer pincode'),
        IsToPayCustomer: false,
        OriginArea: carrierText(pickup.originArea, 3, 'Origin area', true).toUpperCase().replace(/[^A-Z]/g, ''),
        Sender: carrierText(pickup.name, 20, 'Sender', true),
        ...(vendorCode ? { VendorCode: vendorCode } : {}),
      },
    },
    Profile: profile(),
  };
};

const pickupDateParts = (value) => {
  const pickupAt = new Date(value);
  if (Number.isNaN(pickupAt.getTime())) {
    throw new AppError('A valid reverse pickup date is required', 422, 'INVALID_PICKUP_DATE');
  }
  if (pickupAt.getTime() < Date.now() + 60 * 60 * 1000) {
    throw new AppError('Reverse pickup must be scheduled at least one hour in advance', 422, 'INVALID_PICKUP_DATE');
  }
  if (pickupAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
    throw new AppError('Reverse pickup cannot be scheduled more than 30 days in advance', 422, 'INVALID_PICKUP_DATE');
  }
  if (pickupAt.getDay() === 0) {
    throw new AppError('Blue Dart reverse pickup cannot be scheduled on Sunday', 422, 'INVALID_PICKUP_DATE');
  }
  const hours = String(pickupAt.getHours()).padStart(2, '0');
  const minutes = String(pickupAt.getMinutes()).padStart(2, '0');
  return { pickupAt, waybillTime: `${hours}${minutes}`, registrationTime: `${hours}:${minutes}` };
};

const buildReverseWaybillPayload = ({
  returnNumber, order, returnRequest, items, declaredValue, weight, dimensions, store, areaCode, pickupAt,
}) => {
  const customer = returnRequest.pickupAddress || {};
  const schedule = pickupDateParts(pickupAt);
  const syntheticOrder = {
    shippingAddress: {
      recipientName: store.name,
      phone: store.phone,
      email: store.email,
      line1: store.line1,
      line2: store.line2,
      city: store.city,
      state: store.state,
      postalCode: store.postalCode,
    },
    grandTotal: declaredValue,
    invoiceNumber: order.invoiceNumber || order.orderNumber,
  };
  const customerPickup = {
    name: customer.recipientName,
    phone: customer.phone,
    line1: customer.line1,
    line2: [customer.line2, customer.landmark].filter(Boolean).join(', '),
    city: customer.city,
    state: customer.state,
    postalCode: customer.postalCode,
    originArea: areaCode,
    vendorCode: process.env.BLUE_DART_VENDOR_CODE,
  };
  const payload = buildWaybillPayload({
    shipmentNumber: returnNumber,
    order: syntheticOrder,
    items,
    weight,
    dimensions,
    pickup: customerPickup,
  });
  payload.Request.Services.RegisterPickup = false;
  payload.Request.Services.PickupDate = blueDartDate(schedule.pickupAt);
  payload.Request.Services.PickupTime = schedule.waybillTime;
  payload.Request.Services.ProductCode = carrierAlphaNumeric(
    process.env.BLUE_DART_REVERSE_PRODUCT_CODE || process.env.BLUE_DART_PRODUCT_CODE || 'A',
    1,
    'Reverse product code',
    true,
  );
  payload.Request.Services.SubProductCode = carrierAlphaNumeric(
    process.env.BLUE_DART_REVERSE_SUB_PRODUCT_CODE || process.env.BLUE_DART_SUB_PRODUCT_CODE || 'P',
    1,
    'Reverse sub-product code',
  );
  payload.Request.Returnadds = {
    ReturnAddress1: carrierText(store.line1, 30, 'Store return address', true),
    ReturnAddress2: carrierText(store.line2, 30, 'Store return address line 2'),
    ReturnAddress3: carrierText([store.city, store.state].filter(Boolean).join(', '), 25, 'Store return address line 3'),
    ReturnContact: carrierText(store.name, 20, 'Store return contact', true),
    ReturnMobile: carrierPhone(store.phone, 'Store return mobile'),
    ReturnPincode: carrierPincode(store.postalCode, 'Store return pincode'),
  };
  return payload;
};

const buildReversePickupRegistrationPayload = ({
  awbNumber, returnNumber, pickupAddress, weight, pickupAt, areaCode, remarks,
}) => {
  const schedule = pickupDateParts(pickupAt);
  const actualWeight = Number(weight);
  if (!Number.isFinite(actualWeight) || actualWeight <= 0) {
    throw new AppError('Reverse pickup weight must be greater than zero', 422, 'INVALID_WEIGHT');
  }
  const closeTime = String(process.env.BLUE_DART_REVERSE_OFFICE_CLOSE_TIME || '18:00');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(closeTime)) {
    throw new AppError('BLUE_DART_REVERSE_OFFICE_CLOSE_TIME must use HH:mm format', 500, 'CARRIER_CONFIG_INVALID');
  }
  const subProducts = String(process.env.BLUE_DART_REVERSE_SUB_PRODUCTS || 'E-Tailing')
    .split(',').map((value) => carrierText(value, 30, 'Reverse sub-product')).filter(Boolean);
  return {
    request: {
      AWBNo: [carrierAlphaNumeric(awbNumber, 20, 'Reverse AWB', true)],
      AreaCode: carrierAlphaNumeric(areaCode, 10, 'Reverse pickup area', true),
      CISDDN: false,
      ContactPersonName: carrierText(pickupAddress.recipientName, 30, 'Pickup contact', true),
      CustomerAddress1: carrierText(pickupAddress.line1, 30, 'Pickup address', true),
      CustomerAddress2: carrierText(pickupAddress.line2, 30, 'Pickup address line 2'),
      CustomerAddress3: carrierText([pickupAddress.landmark, pickupAddress.city, pickupAddress.state].filter(Boolean).join(', '), 30, 'Pickup address line 3'),
      CustomerCode: carrierAlphaNumeric(requiredValue('BLUE_DART_CUSTOMER_CODE'), 6, 'Customer code', true),
      CustomerName: carrierText(pickupAddress.recipientName, 30, 'Customer name', true),
      CustomerPincode: carrierPincode(pickupAddress.postalCode, 'Pickup pincode'),
      CustomerTelephoneNumber: carrierPhone(pickupAddress.phone, 'Pickup telephone'),
      DoxNDox: '1',
      EmailID: '',
      IsForcePickup: false,
      IsReversePickup: true,
      MobileTelNo: carrierPhone(pickupAddress.phone, 'Pickup mobile'),
      NumberofPieces: 1,
      OfficeCloseTime: closeTime,
      PackType: carrierAlphaNumeric(process.env.BLUE_DART_PACK_TYPE || 'L', 1, 'Pack type', true),
      ProductCode: carrierAlphaNumeric(
        process.env.BLUE_DART_REVERSE_PRODUCT_CODE || process.env.BLUE_DART_PRODUCT_CODE || 'A',
        1,
        'Reverse product code',
        true,
      ),
      ReferenceNo: carrierCreditReference(returnNumber),
      Remarks: carrierText(remarks || `Reverse pickup ${returnNumber}`, 100, 'Pickup remarks'),
      RouteCode: '',
      ShipmentPickupDate: blueDartDate(schedule.pickupAt),
      ShipmentPickupTime: schedule.registrationTime,
      SubProducts: subProducts,
      VolumeWeight: actualWeight,
      WeightofShipment: actualWeight,
      isToPayShipper: false,
    },
    profile: profile(),
  };
};

const buildCancelPickupPayload = ({ tokenNumber, registrationDate, remarks }) => ({
  request: {
    PickupRegistrationDate: blueDartDate(new Date(registrationDate)),
    Remarks: carrierText(remarks, 100, 'Cancellation remarks'),
    TokenNumber: Number(tokenNumber),
  },
  profile: profile(),
});

const checkServiceability = async ({ destinationPostalCode, productCode }) => {
  const requestPayload = {
    pinCode: String(destinationPostalCode),
    pProductCode: productCode || process.env.BLUE_DART_PRODUCT_CODE || 'A',
    pSubProductCode: process.env.BLUE_DART_SUB_PRODUCT_CODE || 'P',
    profile: profile(),
  };
  let response;
  try {
    response = await requestJson(endpoint(
      'BLUE_DART_SERVICEABILITY_URL',
      '/finder/v1/GetServicesforPincodeAndProduct',
    ), {
      method: 'POST',
      headers: await carrierHeaders(),
      body: JSON.stringify(requestPayload),
    });
  } catch (error) {
    const unavailable = error.code === 'CARRIER_TIMEOUT'
      || (error.code === 'CARRIER_REQUEST_FAILED' && error.details?.carrierStatus === 404);
    const allowFallback = process.env.NODE_ENV !== 'production'
      || process.env.BLUE_DART_ALLOW_SERVICEABILITY_FALLBACK === 'true';
    if (!unavailable || !allowFallback) throw error;
    return {
      serviceable: null,
      estimatedDays: null,
      expectedDeliveryDate: null,
      checkUnavailable: true,
      message: 'Delivery availability will be confirmed before dispatch',
    };
  }
  const result = response.GetServicesforPincodeAndProductResult
    || response.GetServicesforPincodeResult
    || response.result
    || response;
  const serviceabilityValue = result.IsServiceable
    ?? result.serviceable
    ?? result.ApexInbound
    ?? result.ApexInboundService;
  const serviceable = serviceabilityValue === undefined || serviceabilityValue === null
    ? null
    : serviceabilityValue === true
      || ['true', 'yes', '1'].includes(String(serviceabilityValue).toLowerCase());
  return {
    serviceable,
    areaCode: result.AreaCode || result.areaCode || result.OriginArea || result.originArea || null,
    estimatedDays: Number(result.ExpectedDeliveryDays || result.estimatedDays) || null,
    expectedDeliveryDate: result.ExpectedDeliveryDate || result.expectedDeliveryDate || null,
    raw: response,
  };
};

const createWaybillFromPayload = async (payload) => {
  const response = await requestJson(endpoint('BLUE_DART_WAYBILL_URL', '/waybill/v1/GenerateWayBill'), {
    method: 'POST', headers: await carrierHeaders(), body: JSON.stringify(payload),
  });
  const result = response.GenerateWayBillResult || response.result || response;
  const awbNumber = result.AWBNo || result.awbNumber || result.waybillNumber;
  if (!awbNumber) throw new AppError('Blue Dart did not issue an AWB number', 502, 'AWB_NOT_CREATED', result.IsError ? result.Status : undefined);
  return {
    awbNumber: String(awbNumber),
    labelBase64: result.AWBPrintContent || result.labelBase64,
    labelUrl: result.labelUrl,
    raw: response,
  };
};

const createWaybill = async ({ shipmentNumber, order, items, weight, dimensions, pickup }) => (
  createWaybillFromPayload(buildWaybillPayload({ shipmentNumber, order, items, weight, dimensions, pickup }))
);

const createReverseWaybill = async (input) => createWaybillFromPayload(buildReverseWaybillPayload(input));

const registerReversePickup = async (input) => {
  const payload = buildReversePickupRegistrationPayload(input);
  const response = await requestJson(endpoint('BLUE_DART_PICKUP_REGISTRATION_URL', '/pickup/v1/RegisterPickup'), {
    method: 'POST', headers: await carrierHeaders(), body: JSON.stringify(payload),
  });
  const rawResult = response.RegisterPickupResult || response.PickupRegistrationResult || response.result || response;
  const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const tokenNumber = result?.TokenNumber ?? result?.tokenNumber ?? result?.PickupTokenNumber;
  const status = result?.Status ?? result?.status ?? result?.StatusInformation;
  if (result?.IsError === true || tokenNumber === undefined || tokenNumber === null || tokenNumber === '') {
    const messages = carrierErrorMessages(response);
    throw new AppError(
      messages.join('; ') || String(status || 'Blue Dart did not register the reverse pickup'),
      502,
      'REVERSE_PICKUP_NOT_REGISTERED',
      { carrierResponse: process.env.NODE_ENV !== 'production' ? response : undefined },
    );
  }
  return { tokenNumber: String(tokenNumber), status: String(status || 'Registered'), raw: response };
};

const cancelRegisteredPickup = async ({ tokenNumber, registrationDate, remarks }) => {
  if (!/^\d+$/.test(String(tokenNumber || ''))) {
    throw new AppError('A valid Blue Dart pickup token is required', 422, 'INVALID_PICKUP_TOKEN');
  }
  const date = new Date(registrationDate);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('A valid pickup registration date is required', 422, 'INVALID_PICKUP_DATE');
  }
  const payload = buildCancelPickupPayload({ tokenNumber, registrationDate: date, remarks });
  const response = await requestJson(endpoint('BLUE_DART_CANCEL_PICKUP_URL', '/cancel-pickup/v1/CancelPickup'), {
    method: 'POST', headers: await carrierHeaders(), body: JSON.stringify(payload),
  });
  const rawResult = response.CancelPickupResult || response.result || response;
  const result = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  if (result?.IsError === true) {
    const messages = carrierErrorMessages(response);
    throw new AppError(messages.join('; ') || 'Blue Dart pickup cancellation failed', 502, 'PICKUP_CANCELLATION_FAILED');
  }
  return { raw: response };
};

const updateWaybill = async ({ shipment, order, weight, dimensions, pickup, payload }) => {
  const generated = buildWaybillPayload({
    shipmentNumber: shipment.shipmentNumber,
    order,
    items: shipment.items,
    weight: weight ?? shipment.weight,
    dimensions,
    pickup,
  });
  generated.Request.Services.AWBNo = shipment.awbNumber;
  generated.Request.Services.RegisterPickup = false;
  const requestPayload = payload || { Request: [generated.Request], Profile: generated.Profile };
  const response = await requestJson(endpoint('BLUE_DART_UPDATE_WAYBILL_URL', '/waybill/v1/UpdateEwayBill'), {
    method: 'POST', headers: await carrierHeaders(), body: JSON.stringify(requestPayload),
  });
  return { raw: response };
};

const cancelWaybill = async ({ awbNumber, payload }) => {
  const requestPayload = payload || {
    Request: { AWBNo: awbNumber },
    Profile: profile(),
  };
  const response = await requestJson(endpoint('BLUE_DART_CANCEL_WAYBILL_URL', '/waybill/v1/CancelWaybill'), {
    method: 'POST', headers: await carrierHeaders(), body: JSON.stringify(requestPayload),
  });
  return { raw: response };
};

const trackingErrorMessage = (response) => {
  const value = response?.ShipmentData?.Error
    ?? response?.ShipmentData?.error
    ?? response?.Error
    ?? response?.error;
  if (value === undefined || value === null) return null;

  const message = typeof value === 'string'
    ? value.trim()
    : String(value.Message || value.message || value.Description || value.description || '').trim();
  if (!message || /^(no error|none|success|ok)$/i.test(message)) return null;
  return message;
};

const validateTrackingResponse = (response) => {
  const carrierMessage = trackingErrorMessage(response);
  if (carrierMessage) {
    throw new AppError(carrierMessage, 502, 'CARRIER_TRACKING_FAILED', { carrierMessage });
  }

  if (!response?.ShipmentData?.Shipment && !response?.shipment && !response?.events) {
    throw new AppError(
      'Blue Dart returned no tracking data for this AWB',
      502,
      'CARRIER_TRACKING_EMPTY_RESPONSE',
    );
  }
  return response;
};

const trackShipment = async (awbNumber) => {
  const query = new URLSearchParams({
    handler: 'tnt',
    action: 'custawbquery',
    loginid: requiredValue('BLUE_DART_LOGIN_ID'),
    lickey: requiredValue('BLUE_DART_LICENSE_KEY'),
    awb: 'awb',
    numbers: awbNumber,
    format: 'json',
    verno: '1',
    scan: '1',
  });
  const response = await requestJson(`${endpoint('BLUE_DART_TRACKING_URL', '/tracking/v1/shipment')}?${query}`, {
    method: 'GET', headers: await carrierHeaders(),
  });
  return validateTrackingResponse(response);
};

const verifyWebhookSignature = (payload, signature, rawBody) => {
  const secret = requiredValue('BLUE_DART_WEBHOOK_SECRET');
  const signedContent = rawBody?.length ? rawBody : Buffer.from(JSON.stringify(payload));
  const expected = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(signature || '').toLowerCase());
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

module.exports = {
  checkServiceability, createWaybill, updateWaybill, cancelWaybill,
  createReverseWaybill, registerReversePickup, cancelRegisteredPickup,
  trackShipment, verifyWebhookSignature, buildWaybillPayload,
  buildReverseWaybillPayload, buildReversePickupRegistrationPayload, buildCancelPickupPayload,
  validateTrackingResponse,
};
