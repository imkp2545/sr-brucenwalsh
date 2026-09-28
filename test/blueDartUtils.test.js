const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWaybillPayload,
  buildReverseWaybillPayload,
  buildReversePickupRegistrationPayload,
  buildCancelPickupPayload,
  validateTrackingResponse,
} = require('../utils/blueDartUtils');

const originalEnv = { ...process.env };

test.beforeEach(() => {
  process.env.BLUE_DART_LICENSE_KEY = 'LICENSE';
  process.env.BLUE_DART_LOGIN_ID = 'LOGIN';
  process.env.BLUE_DART_CUSTOMER_CODE = '123456';
  process.env.BLUE_DART_PRODUCT_CODE = 'A';
  process.env.BLUE_DART_SUB_PRODUCT_CODE = 'P';
  process.env.BLUE_DART_PACK_TYPE = 'L';
  process.env.BLUE_DART_PRODUCT_TYPE = '1';
  process.env.BLUE_DART_PICKUP_TIME = '1600';
  process.env.BLUE_DART_REGISTER_PICKUP = 'true';
  process.env.BLUE_DART_REVERSE_PRODUCT_CODE = 'A';
  process.env.BLUE_DART_REVERSE_SUB_PRODUCT_CODE = 'P';
  process.env.BLUE_DART_REVERSE_SUB_PRODUCTS = 'E-Tailing';
  process.env.BLUE_DART_REVERSE_OFFICE_CLOSE_TIME = '18:00';
});

const nextPickup = () => {
  const value = new Date(Date.now() + 48 * 60 * 60 * 1000);
  if (value.getDay() === 0) value.setDate(value.getDate() + 1);
  return value;
};

test.after(() => {
  process.env = originalEnv;
});

const fixture = () => ({
  shipmentNumber: 'SHP-20260717-BF29DBB3FF',
  order: {
    orderNumber: 'BWL-20260717-C0C4B47DA7',
    grandTotal: 26375,
    shippingAddress: {
      recipientName: 'Customer With A Name Longer Than Thirty Characters',
      line1: 'A delivery address line that is longer than thirty characters',
      line2: 'Apartment 12',
      landmark: 'Near Central Plaza',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400004',
      phone: '9876543210',
      email: 'customer@example.com',
    },
  },
  items: [{ sku: 'BW-RNG-DIA-001', quantity: 1 }],
  weight: 0.5,
  pickup: {
    name: 'Bruce & Walsh Luxury Private Limited',
    line1: 'FLOOR-5, 64B, BANSILAL BUILDING',
    line2: 'JAGANNATH SHANKARSHETH MARG, OPERA HOUSE, GIRGAON',
    city: 'MUMBAI',
    state: 'MAHARASHTRA',
    postalCode: '400004',
    phone: '8799401198',
    originArea: 'BOM',
    vendorCode: '',
  },
});

test('builds a schema-constrained Blue Dart waybill payload', () => {
  const payload = buildWaybillPayload(fixture());
  const { Consignee, Returnadds, Services, Shipper } = payload.Request;

  assert.ok(Consignee.ConsigneeName.length <= 30);
  assert.ok(Consignee.ConsigneeAddress1.length <= 30);
  assert.ok(Consignee.ConsigneeAddress2.length <= 30);
  assert.ok(Consignee.ConsigneeAddress3.length <= 30);
  assert.match(Consignee.ConsigneeMobile, /^\d{10,15}$/);
  assert.match(Consignee.ConsigneePincode, /^\d{6}$/);

  assert.ok(Returnadds.ReturnContact.length <= 20);
  assert.ok(Returnadds.ReturnAddress1.length <= 30);
  assert.ok(Returnadds.ReturnAddress2.length <= 30);
  assert.ok(Returnadds.ReturnAddress3.length <= 25);

  assert.match(Services.CreditReferenceNo, /^[A-Z0-9]{1,20}$/);
  assert.match(Services.InvoiceNo, /^[A-Z0-9]{1,10}$/);
  assert.equal(Services.DeclaredValue, 26375);
  assert.equal(typeof Services.DeclaredValue, 'number');
  assert.equal(Services.ActualWeight, 0.5);
  assert.equal(Services.ProductCode, 'A');
  assert.equal(Services.SubProductCode, 'P');
  assert.equal(Services.PackType, 'L');
  assert.equal(Services.ProductType, 1);
  assert.deepEqual(Services.Commodity, { CommodityDetail1: 'BWRNGDIA001' });

  assert.ok(Shipper.CustomerName.length <= 30);
  assert.ok(Shipper.CustomerAddress1.length <= 30);
  assert.ok(Shipper.CustomerAddress2.length <= 30);
  assert.ok(Shipper.CustomerAddress3.length <= 30);
  assert.ok(Shipper.Sender.length <= 20);
  assert.match(Shipper.CustomerCode, /^[A-Z0-9]{1,6}$/);
  assert.match(Shipper.OriginArea, /^[A-Z]{1,3}$/);
});

test('rejects invalid carrier phone and pincode data before calling Blue Dart', () => {
  const input = fixture();
  input.order.shippingAddress.phone = '123';
  assert.throws(() => buildWaybillPayload(input), /10 to 15 digits/);

  input.order.shippingAddress.phone = '9876543210';
  input.order.shippingAddress.postalCode = '4000';
  assert.throws(() => buildWaybillPayload(input), /exactly 6 digits/);
});

test('builds a reverse waybill from the customer to the store', () => {
  const pickupAt = nextPickup();
  const payload = buildReverseWaybillPayload({
    returnNumber: 'RET-20260720-ABC123',
    order: { orderNumber: 'BWL-20260717-C0C4B47DA7', invoiceNumber: 'INV0000123' },
    returnRequest: {
      pickupAddress: {
        recipientName: 'Karan Sharma', phone: '9999999999', line1: 'Customer residence',
        line2: 'Apartment 5', landmark: 'Near Station', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
      },
    },
    items: [{ sku: 'BW-RNG-DIA-001', quantity: 1 }],
    declaredValue: 25000,
    weight: 0.5,
    dimensions: { length: 12, width: 10, height: 8, unit: 'cm' },
    store: {
      name: 'Bruce & Walsh Luxury', phone: '8799401198', email: 'store@example.com',
      line1: '64B Bansilal Building', line2: 'Opera House', city: 'Mumbai', state: 'Maharashtra', postalCode: '400004',
    },
    areaCode: 'BOM',
    pickupAt,
  });

  assert.equal(payload.Request.Services.RegisterPickup, false);
  assert.equal(payload.Request.Services.ProductCode, 'A');
  assert.equal(payload.Request.Services.SubProductCode, 'P');
  assert.equal(payload.Request.Services.PackType, 'L');
  assert.equal(payload.Request.Services.DeclaredValue, 25000);
  assert.equal(payload.Request.Consignee.ConsigneePincode, '400004');
  assert.equal(payload.Request.Shipper.CustomerPincode, '400001');
  assert.equal(payload.Request.Shipper.OriginArea, 'BOM');
  assert.equal(payload.Request.Returnadds.ReturnPincode, '400004');
});

test('builds reverse pickup registration and cancellation payloads', () => {
  const pickupAt = nextPickup();
  const registration = buildReversePickupRegistrationPayload({
    awbNumber: '90001755572',
    returnNumber: 'RET-20260720-ABC123',
    pickupAddress: {
      recipientName: 'Karan Sharma', phone: '9999999999', line1: 'Customer residence',
      line2: 'Apartment 5', landmark: 'Near Station', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
    },
    weight: 0.5,
    pickupAt,
    areaCode: 'BOM',
    remarks: 'Handle jewellery carefully',
  });
  assert.deepEqual(registration.request.AWBNo, ['90001755572']);
  assert.equal(registration.request.IsReversePickup, true);
  assert.equal(registration.request.AreaCode, 'BOM');
  assert.equal(registration.request.CustomerPincode, '400001');
  assert.equal(registration.request.WeightofShipment, 0.5);
  assert.equal(registration.request.ProductCode, 'A');
  assert.equal(registration.request.PackType, 'L');
  assert.deepEqual(registration.request.SubProducts, ['E-Tailing']);

  const cancellation = buildCancelPickupPayload({
    tokenNumber: '123456', registrationDate: pickupAt, remarks: 'Customer requested reschedule',
  });
  assert.equal(cancellation.request.TokenNumber, 123456);
  assert.equal(cancellation.request.Remarks, 'Customer requested reschedule');
  assert.match(cancellation.request.PickupRegistrationDate, /^\/Date\(\d+\)\/$/);
});

test('rejects Blue Dart tracking business errors returned with HTTP success', () => {
  assert.throws(
    () => validateTrackingResponse({ ShipmentData: { Error: 'License Mismatch' } }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, 'CARRIER_TRACKING_FAILED');
      assert.equal(error.message, 'License Mismatch');
      assert.deepEqual(error.details, { carrierMessage: 'License Mismatch' });
      return true;
    },
  );
});

test('accepts a Blue Dart tracking response containing shipment data', () => {
  const response = {
    ShipmentData: {
      Error: '',
      Shipment: [{ WaybillNo: '76727669373', Status: 'Shipment Delivered' }],
    },
  };
  assert.equal(validateTrackingResponse(response), response);
});

test('rejects an empty Blue Dart tracking response', () => {
  assert.throws(
    () => validateTrackingResponse({ ShipmentData: { Error: '' } }),
    (error) => error.statusCode === 502 && error.code === 'CARRIER_TRACKING_EMPTY_RESPONSE',
  );
});
