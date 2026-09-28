const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeHdfcSessionExpiry,
  normalizeHdfcStatusResponse,
  resolveHdfcReturnUrl,
  verifyHdfcPaymentStatus,
} = require("../utils/hdfcPaymentUtils");

test("HDFC order expiry is normalized from the hosted session response", () => {
  const expiry = normalizeHdfcSessionExpiry({
    order_expiry: "2026-08-08T18:00:58Z",
  });

  assert.equal(expiry.toISOString(), "2026-08-08T18:00:58.000Z");
  assert.equal(normalizeHdfcSessionExpiry({ order_expiry: "invalid" }), null);
});

test("HDFC in-progress states remain pending and recoverable", () => {
  for (const status of [
    "NEW",
    "PENDING",
    "STARTED",
    "AUTHORIZING",
    "AUTHORIZED",
    "PENDING_VBV",
    "VBV_SUCCESSFUL",
    "CAPTURE_INITIATED",
  ]) {
    const result = normalizeHdfcStatusResponse({
      status,
      order_id: "PAY-RECOVERABLE-001",
      amount: 125000,
      currency: "INR",
    });

    assert.equal(result.pending, true, status);
    assert.equal(result.verified, false, status);
    assert.equal(result.transactionId, undefined);
  }
});

test("HDFC terminal success and failure states are classified separately", () => {
  const captured = normalizeHdfcStatusResponse({
    status: "CHARGED",
    txn_id: "TXN-PAID-001",
    amount: 125000,
  });
  const declined = normalizeHdfcStatusResponse({
    status: "DECLINED",
    txn_id: "TXN-FAILED-001",
    amount: 125000,
  });

  assert.equal(captured.verified, true);
  assert.equal(captured.pending, false);
  assert.equal(declined.verified, false);
  assert.equal(declined.pending, false);
});

test("HDFC return URL uses the native deep link and preserves the payment reference", () => {
  const previousWeb = process.env.HDFC_RETURN_URL;
  const previousMobile = process.env.HDFC_MOBILE_RETURN_URL;
  process.env.HDFC_RETURN_URL =
    "http://localhost:5001/api/v1/payments/hdfc/return";
  process.env.HDFC_MOBILE_RETURN_URL = "brucenwalsh://payment/result";

  try {
    assert.equal(
      resolveHdfcReturnUrl({
        source: "android",
        paymentReference: "PAY-ANDROID-001",
      }),
      "brucenwalsh://payment/result?payment_reference=PAY-ANDROID-001",
    );
    assert.equal(
      resolveHdfcReturnUrl({ source: "ios", paymentReference: "PAY-IOS-001" }),
      "brucenwalsh://payment/result?payment_reference=PAY-IOS-001",
    );
    assert.equal(
      resolveHdfcReturnUrl({ source: "web", paymentReference: "PAY-WEB-001" }),
      "http://localhost:5001/api/v1/payments/hdfc/return?payment_reference=PAY-WEB-001",
    );
  } finally {
    if (previousWeb === undefined) delete process.env.HDFC_RETURN_URL;
    else process.env.HDFC_RETURN_URL = previousWeb;
    if (previousMobile === undefined) delete process.env.HDFC_MOBILE_RETURN_URL;
    else process.env.HDFC_MOBILE_RETURN_URL = previousMobile;
  }
});


test('unknown gateway statuses are neither success nor confirmed failure', () => {
  for (const status of ['', 'UNRECOGNIZED', 'AUTO_REFUNDED']) {
    const result = normalizeHdfcStatusResponse({ status });
    assert.equal(result.verified, false);
    assert.equal(result.failed, false);
  }
});

test('an order reference cannot substitute for a bank transaction ID or missing currency', () => {
  const result = normalizeHdfcStatusResponse({ status: 'CHARGED', order_id: 'PAY-1', id: 'ORDER-1', amount: 100 });
  assert.equal(result.transactionId, undefined);
  assert.equal(result.currency, '');
});

test('payment verification ignores callback success and uses the authenticated gateway result', async () => {
  const result = await verifyHdfcPaymentStatus({
    paymentReference: 'PAY-1',
    callbackPayload: { status: 'CHARGED', order_id: 'PAY-OTHER', amount: 1 },
    statusFetcher: async (reference) => {
      assert.equal(reference, 'PAY-1');
      return { order_id: 'PAY-1', status: 'PENDING_VBV' };
    },
  });
  assert.equal(result.pending, true);
  assert.equal(result.verified, false);
});

test('payment verification rejects a gateway response for a different order', async () => {
  await assert.rejects(verifyHdfcPaymentStatus({
    paymentReference: 'PAY-1',
    statusFetcher: async () => ({ order_id: 'PAY-OTHER', status: 'CHARGED' }),
  }));
});
