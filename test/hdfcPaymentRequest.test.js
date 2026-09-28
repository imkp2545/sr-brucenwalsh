const test = require("node:test");
const assert = require("node:assert/strict");
const { generateHdfcOrderId } = require("../utils/orderNumberUtils");
const {
  buildHdfcPaymentRequestPayload,
} = require("../utils/hdfcPaymentUtils");

test("HDFC order IDs meet the bank format requirements", () => {
  const first = generateHdfcOrderId();
  const second = generateHdfcOrderId();

  assert.match(first, /^[A-Z0-9]{1,20}$/);
  assert.equal(first.length, 19);
  assert.notEqual(first, second);
});

test("HDFC payment request does not send UDF2", () => {
  const previousReturnUrl = process.env.HDFC_RETURN_URL;
  const previousClientId = process.env.HDFC_PAYMENT_PAGE_CLIENT_ID;
  process.env.HDFC_RETURN_URL = "https://brucenwalsh.com/payment/result";
  process.env.HDFC_PAYMENT_PAGE_CLIENT_ID = "test-client";

  try {
    const payload = buildHdfcPaymentRequestPayload({
      paymentReference: "BWP0123456789ABCDEF",
      amount: 125000,
      currency: "INR",
      user: {
        _id: "customer-unique-id",
        email: "customer@example.com",
        phone: "9999999999",
      },
      source: "web",
    });

    assert.equal(payload.udf1, "BWP0123456789ABCDEF");
    assert.equal(Object.hasOwn(payload, "udf2"), false);
  } finally {
    if (previousReturnUrl === undefined) delete process.env.HDFC_RETURN_URL;
    else process.env.HDFC_RETURN_URL = previousReturnUrl;
    if (previousClientId === undefined) delete process.env.HDFC_PAYMENT_PAGE_CLIENT_ID;
    else process.env.HDFC_PAYMENT_PAGE_CLIENT_ID = previousClientId;
  }
});
