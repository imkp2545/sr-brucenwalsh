const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyHdfcRefundStatus } = require('../utils/hdfcPaymentUtils');

test('refund verification ignores callback claims and requires a gateway refund record', async () => {
  const result = await verifyHdfcRefundStatus({
    refundReference: 'RFD-SECURE-001',
    orderReference: 'PAY-ORIGINAL-001',
    callbackPayload: { status: 'SUCCESS', amount: 25000 },
    statusFetcher: async () => ({ status: 'CHARGED', amount: 25000, refunds: [] }),
  });

  assert.equal(result.successful, false);
  assert.equal(result.processing, false);
  assert.equal(result.status, 'NOT_FOUND');
});

test('refund verification accepts only an exact refund returned by HDFC/Juspay', async () => {
  const result = await verifyHdfcRefundStatus({
    refundReference: 'RFD-SECURE-002',
    orderReference: 'PAY-ORIGINAL-002',
    statusFetcher: async (orderId, options) => {
      assert.equal(orderId, 'PAY-ORIGINAL-002');
      assert.equal(options['options.add_full_gateway_response'], true);
      return {
        status: 'CHARGED',
        refunds: [
          { unique_request_id: 'RFD-DIFFERENT', status: 'SUCCESS', amount: 999 },
          { unique_request_id: 'RFD-SECURE-002', status: 'SUCCESS', amount: 1250 },
        ],
      };
    },
  });

  assert.equal(result.successful, true);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.amount, 1250);
  assert.equal(result.gatewayRefundId, 'RFD-SECURE-002');
});

test('refund verification cannot fall back to an untrusted callback order reference', async () => {
  await assert.rejects(
    verifyHdfcRefundStatus({
      refundReference: 'RFD-SECURE-003',
      callbackPayload: { order_id: 'ATTACKER-ORDER', status: 'SUCCESS', amount: 1250 },
      statusFetcher: async () => ({ refunds: [] }),
    }),
    (error) => error.code === 'PAYMENT_REFERENCE_REQUIRED' && error.statusCode === 422,
  );
});
