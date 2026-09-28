const fs = require("fs");
const path = require("path");
const { Juspay, APIError, JuspayError } = require("expresscheckout-nodejs");
const AppError = require("./appError");

const SANDBOX_BASE_URL = "https://smartgateway.hdfcuat.bank.in";
const PRODUCTION_BASE_URL = "https://smartgateway.hdfc.bank.in";

let juspayClient;

const requiredValue = (name) => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for HDFC/Juspay payment processing`);
  return value;
};

const optionalValue = (...names) =>
  names.map((name) => process.env[name]).find(Boolean);

const resolveHdfcReturnUrl = ({ source, paymentReference }) => {
  const isMobile = ["android", "ios"].includes(source);
  const configuredUrl =
    (isMobile && optionalValue("HDFC_MOBILE_RETURN_URL")) ||
    requiredValue("HDFC_RETURN_URL");
  let returnUrl;
  try {
    returnUrl = new URL(configuredUrl);
  } catch {
    throw new Error("The configured HDFC payment return URL is invalid");
  }
  if (!["http:", "https:", "brucenwalsh:"].includes(returnUrl.protocol)) {
    throw new Error(
      "The configured HDFC payment return URL protocol is not allowed",
    );
  }
  returnUrl.searchParams.set("payment_reference", paymentReference);
  return returnUrl.toString();
};

const resolvePath = (value) => path.resolve(process.cwd(), value);

const readKey = (envName) => {
  const filePath = resolvePath(requiredValue(envName));
  return fs.readFileSync(filePath);
};

const getBaseUrl = () =>
  process.env.HDFC_BASE_URL ||
  process.env.JUSPAY_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL);

const getJuspay = () => {
  if (juspayClient) return juspayClient;
  juspayClient = new Juspay({
    merchantId: requiredValue("HDFC_MERCHANT_ID"),
    baseUrl: getBaseUrl(),
    jweAuth: {
      keyId: requiredValue("HDFC_KEY_UUID"),
      publicKey: readKey("HDFC_PUBLIC_KEY_PATH"),
      privateKey: readKey("HDFC_PRIVATE_KEY_PATH"),
    },
  });
  return juspayClient;
};

const toGatewayError = (error, fallbackMessage) => {
  const message =
    error?.message || fallbackMessage || "HDFC/Juspay gateway request failed";
  const details = {
    gatewayError: error?.name,
    statusCode: error?.statusCode || error?.http?.statusCode,
  };
  if (error instanceof APIError) {
    return new AppError(message, 502, "PAYMENT_GATEWAY_ERROR", details);
  }
  if (JuspayError && error instanceof JuspayError) {
    return new AppError(
      message,
      502,
      "PAYMENT_GATEWAY_AUTHENTICATION_ERROR",
      details,
    );
  }
  return error instanceof AppError
    ? error
    : new AppError(message, 502, "PAYMENT_GATEWAY_ERROR", details);
};

const removeHttpMetadata = (payload = {}) => {
  const clone = { ...payload };
  delete clone.http;
  return clone;
};

const numericAmount = (value) => Math.round(Number(value) * 100) / 100;

const normalizeSessionExpiry = (payload = {}) => {
  const value =
    payload.order_expiry ||
    payload.expires_at ||
    payload.expiry ||
    payload.expiresAt;
  if (!value) return null;
  const expiry = new Date(value);
  return Number.isNaN(expiry.getTime()) ? null : expiry;
};

const createHdfcPaymentRequest = async ({
  paymentReference,
  amount,
  currency,
  user,
  source,
}) => {
  const requestPayload = buildHdfcPaymentRequestPayload({
    paymentReference,
    amount,
    currency,
    user,
    source,
  });

  const webhookUrl = optionalValue("HDFC_CALLBACK_URL", "HDFC_WEBHOOK_URL");
  if (webhookUrl) requestPayload["metadata.webhook_url"] = webhookUrl;

  try {
    const sessionResponse = removeHttpMetadata(
      await getJuspay().orderSession.create(requestPayload),
    );
    return {
      requestPayload,
      expiresAt: normalizeSessionExpiry(sessionResponse),
      gatewayResponse: {
        ...sessionResponse,
        redirect_url:
          sessionResponse.payment_links?.web ||
          sessionResponse.sdk_payload?.payment_links?.web,
        payment_url:
          sessionResponse.payment_links?.web || sessionResponse.payment_url,
        session_id: sessionResponse.id || sessionResponse.session_id,
        order_id: sessionResponse.order_id || paymentReference,
      },
    };
  } catch (error) {
    throw toGatewayError(error, "HDFC/Juspay payment session creation failed");
  }
};

const buildHdfcPaymentRequestPayload = ({
  paymentReference,
  amount,
  currency,
  user,
  source,
}) =>
  ({
    order_id: paymentReference,
    amount: numericAmount(amount),
    currency,
    payment_page_client_id: requiredValue("HDFC_PAYMENT_PAGE_CLIENT_ID"),
    customer_id: String(user._id),
    customer_email: user.email,
    customer_phone: user.phone || "",
    action: "paymentPage",
    return_url: resolveHdfcReturnUrl({ source, paymentReference }),
    description: `Bruce & Walsh order payment ${paymentReference}`,
    udf1: paymentReference,
  });

const nested = (payload, ...keys) =>
  keys.reduce((value, key) => value?.[key], payload);

const normalizeStatusResponse = (payload) => {
  const gatewayResponse =
    payload.payment_gateway_response || payload.gateway_response || {};
  const status = String(
    payload.status || payload.payment_status || payload.txn_status || "",
  ).toUpperCase();
  const amount = Number(
    payload.amount || payload.txn_amount || gatewayResponse.amount,
  );
  return {
    verified: ["SUCCESS", "CAPTURED", "CHARGED"].includes(status),
    failed: ["FAILED", "DECLINED", "AUTHENTICATION_FAILED", "AUTHORIZATION_FAILED", "JUSPAY_DECLINED", "CANCELLED", "CANCELED"].includes(status),
    pending: [
      "NEW",
      "PENDING",
      "STARTED",
      "AUTHORIZING",
      "AUTHORIZED",
      "PENDING_VBV",
      "VBV_SUCCESSFUL",
      "CAPTURE_INITIATED",
    ].includes(status),
    status,
    transactionId:
      payload.txn_id ||
      payload.transaction_id ||
      payload.payment_id ||
      gatewayResponse.txn_id ||
      gatewayResponse.transaction_id ||
      nested(payload, "txn_detail", "txn_id"),
    bankReferenceNumber:
      payload.bank_reference_number ||
      payload.bank_ref_no ||
      payload.rrn ||
      gatewayResponse.rrn ||
      gatewayResponse.bank_ref_no ||
      gatewayResponse.bank_reference_number,
    amount,
    currency: String(payload.currency || "").toUpperCase(),
    method:
      payload.payment_method ||
      payload.payment_method_type ||
      gatewayResponse.payment_method,
    responseCode:
      payload.response_code || payload.code || gatewayResponse.resp_code,
    responseMessage:
      payload.response_message ||
      payload.message ||
      gatewayResponse.resp_message ||
      status,
    raw: payload,
  };
};

const verifyHdfcPaymentStatus = async ({
  paymentReference,
  callbackPayload,
  statusFetcher,
}) => {
  const orderId =
    paymentReference || callbackPayload?.order_id || callbackPayload?.orderId;
  if (!orderId)
    throw new AppError(
      "Payment reference is missing",
      400,
      "PAYMENT_REFERENCE_REQUIRED",
    );

  try {
    const fetchStatus = statusFetcher || ((reference, options) => getJuspay().order.status(reference, options));
    const statusResponse = removeHttpMetadata(
      await fetchStatus(orderId, {
        "options.add_full_gateway_response": true,
      }),
    );
    if (String(statusResponse.order_id || "") !== String(orderId)) {
      throw new AppError("HDFC returned a different order reference", 502, "PAYMENT_REFERENCE_MISMATCH");
    }
    return normalizeStatusResponse(statusResponse);
  } catch (error) {
    throw toGatewayError(
      error,
      "HDFC/Juspay payment status verification failed",
    );
  }
};

const normalizeRefundResponse = (payload) => {
  const refund = payload.refund || payload.refunds?.[0] || payload;
  const status = String(
    refund.status || payload.status || refund.refund_status || "",
  ).toUpperCase();
  const amount = Number(
    refund.amount || refund.refund_amount || payload.amount,
  );
  return {
    successful: ["SUCCESS", "SUCCEEDED", "PROCESSED", "COMPLETED"].includes(
      status,
    ),
    processing: ["PENDING", "PROCESSING", "INITIATED"].includes(status),
    status,
    gatewayRefundId:
      refund.id ||
      refund.refund_id ||
      refund.unique_request_id ||
      refund.gateway_refund_id,
    bankReferenceNumber:
      refund.bank_reference_number || refund.bank_ref_no || refund.rrn,
    amount,
    responseCode: refund.response_code || refund.code,
    responseMessage: refund.response_message || refund.message || status,
    raw: payload,
  };
};

const findRefundByReference = (refunds, refundReference) => {
  const expected = String(refundReference || "").trim();
  if (!expected || !Array.isArray(refunds)) return null;
  return (
    refunds.find((refund) =>
      [
        refund?.unique_request_id,
        refund?.refund_id,
        refund?.id,
        refund?.gateway_refund_id,
      ].some((value) => String(value || "").trim() === expected),
    ) || null
  );
};

const normalizeVerifiedRefund = (statusResponse, refundReference) => {
  const refund = findRefundByReference(
    statusResponse?.refunds,
    refundReference,
  );
  if (!refund) {
    return normalizeRefundResponse({
      refund: {
        status: "NOT_FOUND",
        unique_request_id: refundReference,
        message:
          "Refund is not present in the verified HDFC/Juspay order status",
      },
    });
  }
  return normalizeRefundResponse({ ...statusResponse, refund });
};

const createHdfcRefundRequest = async ({
  refundReference,
  orderReference,
  transactionId,
  amount,
}) => {
  const orderId = orderReference || transactionId;
  if (!orderId)
    throw new AppError(
      "Original HDFC/Juspay order reference is required",
      422,
      "PAYMENT_REFERENCE_REQUIRED",
    );

  try {
    const refundResponse = removeHttpMetadata(
      await getJuspay().order.refund(orderId, {
        unique_request_id: refundReference,
        order_id: orderId,
        amount: numericAmount(amount),
      }),
    );
    return normalizeRefundResponse(refundResponse);
  } catch (error) {
    throw toGatewayError(error, "HDFC/Juspay refund request failed");
  }
};

const verifyHdfcRefundStatus = async ({
  refundReference,
  orderReference,
  statusFetcher,
}) => {
  if (!refundReference)
    throw new AppError(
      "Refund reference is required",
      422,
      "REFUND_REFERENCE_REQUIRED",
    );
  if (!orderReference) {
    throw new AppError(
      "Original HDFC/Juspay order reference is required for refund verification",
      422,
      "PAYMENT_REFERENCE_REQUIRED",
    );
  }

  try {
    const fetchStatus =
      statusFetcher ||
      ((orderId, options) => getJuspay().order.status(orderId, options));
    const statusResponse = removeHttpMetadata(
      await fetchStatus(orderReference, {
        "options.add_full_gateway_response": true,
      }),
    );
    return normalizeVerifiedRefund(statusResponse, refundReference);
  } catch (error) {
    throw toGatewayError(
      error,
      "HDFC/Juspay refund status verification failed",
    );
  }
};

module.exports = {
  createHdfcPaymentRequest,
  verifyHdfcPaymentStatus,
  createHdfcRefundRequest,
  verifyHdfcRefundStatus,
  normalizeHdfcStatusResponse: normalizeStatusResponse,
  normalizeHdfcSessionExpiry: normalizeSessionExpiry,
  buildHdfcPaymentRequestPayload,
  resolveHdfcReturnUrl,
};
