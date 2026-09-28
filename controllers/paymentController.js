const mongoose = require("mongoose");
const Payment = require("../models/paymentModel");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const Coupon = require("../models/couponModel");
const User = require("../models/userModel");
const AppError = require("../utils/appError");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { prepareCheckout } = require("./checkoutController");
const {
  generateHdfcOrderId,
  generateOrderNumber,
} = require("../utils/orderNumberUtils");
const {
  createHdfcPaymentRequest,
  verifyHdfcPaymentStatus,
} = require("../utils/hdfcPaymentUtils");
const {
  createAndUploadInvoice,
  sendInvoiceEmail,
} = require("../utils/invoiceUtils");
const {
  notifyUser,
  notifyRoles,
  emitToUser,
  emitToRoles,
} = require("../utils/notificationUtils");
const { logAudit } = require("../utils/auditLogUtils");
const {
  applyStatusFilter,
  summarizeStatusFields,
} = require("../utils/statusSummaryUtils");
const {
  recordInventoryMovement,
  stockSnapshot,
} = require("../services/inventoryMovementService");
const {
  captureRequiredLegalAcceptances,
} = require("../services/legalAcceptanceService");

const {
  confirmedOrderForPayment,
  updateUnconfirmedPayment,
} = require("../services/paymentConfirmationService");

const PAYMENT_METHODS = ["card", "netBanking", "upi", "wallet"];
const ORDER_PAYMENT_METHOD = {
  card: "hdfcCard",
  netBanking: "hdfcNetBanking",
  upi: "hdfcUpi",
  wallet: "hdfcWallet",
};
const PAYMENT_SESSION_FALLBACK_MS = 15 * 60 * 1000;

const paymentReferenceFromPayload = (payload = {}) =>
  String(
    payload.payment_reference ||
      payload.paymentReference ||
      payload.merchant_txn_id ||
      payload.order_id ||
      payload.orderId ||
      payload.udf1 ||
      "",
  ).trim();

const webPaymentResultBaseUrl = () => {
  const configured =
    process.env.PAYMENT_RESULT_URL ||
    process.env.WEB_PAYMENT_RESULT_URL ||
    process.env.HDFC_WEB_RESULT_URL;
  if (configured) return configured;

  const clientUrls = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    clientUrls.find((value) => /localhost:5174|brucenwalsh/i.test(value)) ||
    clientUrls[0] ||
    "https://brucenwalsh.com"
  );
};

const paymentResultRedirectUrl = ({ paymentReference, status, message } = {}) => {
  const resultUrl = new URL("/payment/result", webPaymentResultBaseUrl());
  if (paymentReference) resultUrl.searchParams.set("payment_reference", paymentReference);
  if (status) resultUrl.searchParams.set("status", status);
  if (message) resultUrl.searchParams.set("message", String(message).slice(0, 180));
  return resultUrl.toString();
};

const paymentSnapshot = (checkout, input, legalAcceptances = []) => ({
  billingVersion: "state-based-gst-v2",
  items: checkout.summary.items,
  subtotal: checkout.summary.subtotal,
  discount: checkout.summary.discount,
  taxableSubtotal: checkout.summary.taxableSubtotal,
  cgst: checkout.summary.cgst,
  sgst: checkout.summary.sgst,
  igst: checkout.summary.igst,
  tax: checkout.summary.tax,
  taxMode: checkout.summary.taxMode,
  placeOfSupplyState: checkout.summary.placeOfSupplyState,
  supplierState: checkout.summary.supplierState,
  taxBreakup: checkout.summary.taxBreakup,
  grandTotal: checkout.summary.grandTotal,
  currency: checkout.summary.currency,
  coupon: checkout.summary.coupon,
  couponCode: checkout.summary.couponCode,
  shippingAddress: checkout.shippingAddress,
  billingAddress: checkout.billingAddress,
  customerNote: input.customerNote,
  legalAcceptances,
  source: ["android", "ios"].includes(input.source) ? input.source : "web",
  calculatedAt: new Date().toISOString(),
});

const publicGatewayResponse = (response = {}) => ({
  redirectUrl:
    response.redirect_url || response.payment_url || response.redirectUrl,
  sessionId: response.session_id || response.sessionId,
  gatewayOrderId: response.order_id || response.gateway_order_id,
  token: response.payment_token || response.token,
});

const initiatePayment = asyncHandler(async (req, res) => {
  const method = req.body.method;
  if (!PAYMENT_METHODS.includes(method))
    throw new AppError(
      "Invalid HDFC payment method",
      422,
      "INVALID_PAYMENT_METHOD",
    );
  const idempotencyKey = String(req.get("idempotency-key") || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new AppError(
      "A valid Idempotency-Key header is required",
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }

  const existing = await Payment.findOne({
    idempotencyKey,
    user: req.user.id,
  }).select("+gatewayMetadata +idempotencyKey");
  if (existing) {
    const storedResponse = existing.gatewayMetadata?.get("gatewayResponse");
    const storedSnapshotValue =
      existing.gatewayMetadata?.get("checkoutSnapshot");
    const storedSnapshot = storedSnapshotValue
      ? JSON.parse(storedSnapshotValue)
      : null;
    return ApiResponse.success(res, {
      message: "Existing payment request returned",
      data: {
        paymentReference: existing.paymentReference,
        amount: existing.amount,
        currency: existing.currency,
        status: existing.status,
        expiresAt: existing.expiresAt,
        taxBreakup: storedSnapshot?.taxBreakup,
        gateway: storedResponse
          ? publicGatewayResponse(JSON.parse(storedResponse))
          : {},
      },
    });
  }

  const [checkout, legalAcceptances] = await Promise.all([
    prepareCheckout(req.user.id, req.body),
    captureRequiredLegalAcceptances(req.body.legalAcceptances),
  ]);
  const snapshot = paymentSnapshot(checkout, req.body, legalAcceptances);
  const paymentReference = generateHdfcOrderId();
  const payment = await Payment.create({
    user: req.user.id,
    paymentReference,
    gateway: "hdfc",
    gatewayOrderId: paymentReference,
    method,
    amount: snapshot.grandTotal,
    currency: snapshot.currency,
    status: "created",
    idempotencyKey,
    expiresAt: new Date(Date.now() + PAYMENT_SESSION_FALLBACK_MS),
    attempts: [
      {
        attemptNumber: 1,
        gatewayRequestId: paymentReference,
        status: "initiated",
      },
    ],
    gatewayMetadata: { checkoutSnapshot: JSON.stringify(snapshot) },
  });

  try {
    const hdfc = await createHdfcPaymentRequest({
      paymentReference,
      amount: payment.amount,
      currency: payment.currency,
      user: checkout.user,
      source: snapshot.source,
    });
    payment.status = "pending";
    payment.expiresAt = hdfc.expiresAt || payment.expiresAt;
    payment.attempts[0].status = "pending";
    payment.gatewayMetadata.set(
      "gatewayResponse",
      JSON.stringify(hdfc.gatewayResponse),
    );
    await payment.save({ validateBeforeSave: false });
    await logAudit(req, {
      action: "create",
      resourceType: "Payment",
      resourceId: payment._id,
      resourceLabel: payment.paymentReference,
      description: "HDFC payment request created",
      statusCode: 201,
    });
    return ApiResponse.success(res, {
      statusCode: 201,
      message: "Payment request created",
      data: {
        paymentReference,
        amount: payment.amount,
        currency: payment.currency,
        taxBreakup: snapshot.taxBreakup,
        expiresAt: payment.expiresAt,
        gateway: publicGatewayResponse(hdfc.gatewayResponse),
      },
    });
  } catch (error) {
    payment.status = "failed";
    payment.failedAt = new Date();
    payment.responseMessage = error.message;
    payment.attempts[0].status = "failed";
    payment.attempts[0].errorMessage = error.message;
    payment.attempts[0].completedAt = new Date();
    await payment.save({ validateBeforeSave: false });
    throw error;
  }
});

const deductInventory = async (item, session, reference) => {
  let filter;
  let update;
  if (item.variantId) {
    filter = {
      _id: item.product,
      status: "active",
      deletedAt: null,
      variants: {
        $elemMatch: {
          _id: item.variantId,
          status: "active",
          stock: { $gte: item.quantity },
        },
      },
    };
    update = {
      $inc: { "variants.$.stock": -item.quantity, salesCount: item.quantity },
    };
  } else {
    filter = {
      _id: item.product,
      status: "active",
      deletedAt: null,
      stock: { $gte: item.quantity },
    };
    update = { $inc: { stock: -item.quantity, salesCount: item.quantity } };
  }
  const result = await Product.updateOne(filter, update, { session });
  if (result.modifiedCount !== 1) {
    throw new AppError(
      `Stock is no longer available for SKU ${item.sku}`,
      409,
      "INSUFFICIENT_STOCK_AFTER_PAYMENT",
    );
  }
  const product = await Product.findById(item.product).session(session);
  if (product) {
    const snapshot = stockSnapshot(product, item.variantId || null);
    await recordInventoryMovement({
      product,
      variantId: item.variantId || null,
      type: "sale",
      source: "payment",
      quantityBefore: snapshot.stock + Number(item.quantity || 0),
      quantityAfter: snapshot.stock,
      reservedBefore: snapshot.reservedStock,
      reservedAfter: snapshot.reservedStock,
      reason: "Paid order stock deduction",
      reference,
      session,
    });
  }
};

const runPostPaymentActions = async (payment, order, req) => {
  const freshPayment = await Payment.findById(payment._id).select(
    "+gatewayMetadata",
  );
  if (freshPayment.gatewayMetadata?.get("postPaymentCompleted") === "true")
    return order;
  const user = await User.findById(order.user);
  if (!user) throw new Error("Order customer no longer exists");

  const invoice = await createAndUploadInvoice(order);
  await sendInvoiceEmail({ user, order, invoice });
  await notifyUser({
    userId: user._id,
    type: "order",
    title: "Order confirmed",
    message: `Your order ${order.orderNumber} has been confirmed.`,
    data: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      invoiceUrl: invoice.invoiceUrl,
    },
    action: { type: "order", value: String(order._id), label: "View order" },
    priority: "high",
  });
  await notifyRoles({
    roles: ["superAdmin", "admin", "orderManager"],
    type: "order",
    title: "New paid order",
    message: `Order ${order.orderNumber} has been paid and confirmed.`,
    data: { orderId: order._id, orderNumber: order.orderNumber },
    priority: "high",
  });
  emitToUser(user._id, "order:created", order.toObject());
  emitToRoles(
    ["superAdmin", "admin", "orderManager"],
    "order:created",
    order.toObject(),
  );
  await logAudit(req, {
    actorType: req.user ? "user" : "webhook",
    action: "create",
    resourceType: "Order",
    resourceId: order._id,
    resourceLabel: order.orderNumber,
    description: "Paid order created after HDFC verification",
    statusCode: 201,
  });
  freshPayment.gatewayMetadata.set("postPaymentCompleted", "true");
  freshPayment.gatewayMetadata.set(
    "postPaymentCompletedAt",
    new Date().toISOString(),
  );
  await freshPayment.save({ validateBeforeSave: false });
  return order;
};

const finalizeVerifiedPayment = async ({ payment, gatewayResult, req }) => {
  // A concurrent callback may already have committed the order while the bank query ran.
  const latest = await Payment.findById(payment._id);
  const receipt = await confirmedOrderForPayment(latest, Order);
  if (receipt) return receipt;

  if (!gatewayResult.pending && !gatewayResult.verified && !gatewayResult.failed) {
    throw new AppError("The gateway payment status requires review", 409, "PAYMENT_STATUS_UNKNOWN");
  }

  if (gatewayResult.pending || !gatewayResult.verified) {
    const pending = gatewayResult.pending;
    const updated = await updateUnconfirmedPayment(Payment, payment, {
      status: pending ? "pending" : "failed",
      responseCode: gatewayResult.responseCode,
      responseMessage: gatewayResult.responseMessage || gatewayResult.status,
      ...(pending ? {} : { failedAt: new Date() }),
      "gatewayMetadata.lastStatusResponse": JSON.stringify(gatewayResult.raw),
    });
    if (!updated) {
      const current = await Payment.findById(payment._id);
      const confirmed = await confirmedOrderForPayment(current, Order);
      if (confirmed) return confirmed;
      // Captured funds must never be reported as failed or invite a second charge.
      throw new AppError("Payment requires reconciliation", 409, "PAYMENT_RECONCILIATION_REQUIRED");
    }
    throw new AppError(
      pending ? "Payment is still pending confirmation" : "Payment was not successful",
      pending ? 409 : 402,
      pending ? "PAYMENT_PENDING" : "PAYMENT_NOT_COMPLETED",
      { status: gatewayResult.status },
    );
  }
  const capturedFields = {
    status: "captured",
    bankReferenceNumber: gatewayResult.bankReferenceNumber,
    responseCode: gatewayResult.responseCode,
    responseMessage: gatewayResult.responseMessage,
    signatureVerified: true,
    capturedAt: new Date(),
    "gatewayMetadata.verifiedResponse": JSON.stringify(gatewayResult.raw),
  };
  if (gatewayResult.transactionId)
    capturedFields.transactionId = gatewayResult.transactionId;
  await Payment.updateOne(
    { _id: payment._id, order: null, status: { $nin: ["partiallyRefunded", "refunded"] } },
    { $set: capturedFields },
  );
  payment.status = "captured";
  payment.signatureVerified = true;

  if (
    !Number.isFinite(gatewayResult.amount) ||
    Math.abs(gatewayResult.amount - payment.amount) > 0.009 ||
    gatewayResult.currency !== payment.currency
  ) {
    try {
      await notifyRoles({
        roles: ["superAdmin", "admin", "orderManager"],
        type: "payment",
        title: "Captured payment amount mismatch",
        message: `Payment ${payment.paymentReference} requires immediate reconciliation.`,
        data: {
          paymentId: payment._id,
          expectedAmount: payment.amount,
          receivedAmount: gatewayResult.amount,
        },
        priority: "urgent",
      });
    } catch (error) {
      console.error("Payment mismatch alert failed", error.message);
    }
    throw new AppError(
      "Verified payment amount or currency does not match checkout",
      409,
      "PAYMENT_AMOUNT_MISMATCH",
    );
  }
  if (!gatewayResult.transactionId) {
    try {
      await notifyRoles({
        roles: ["superAdmin", "admin", "orderManager"],
        type: "payment",
        title: "Captured payment missing transaction ID",
        message: `Payment ${payment.paymentReference} requires reconciliation.`,
        data: { paymentId: payment._id },
        priority: "urgent",
      });
    } catch (error) {
      console.error("Payment reconciliation alert failed", error.message);
    }
    throw new AppError(
      "HDFC did not return a transaction ID",
      502,
      "MISSING_GATEWAY_TRANSACTION_ID",
    );
  }

  if (payment.order) {
    const existingOrder = await Order.findById(payment.order);
    if (!existingOrder) throw new Error("Payment references a missing order");
    await runPostPaymentActions(payment, existingOrder, req);
    return existingOrder;
  }

  const snapshotValue = payment.gatewayMetadata?.get("checkoutSnapshot");
  if (!snapshotValue) throw new Error("Payment checkout snapshot is missing");
  const snapshot = JSON.parse(snapshotValue);
  const usesCurrentBilling = [
    "fixed-cgst-sgst-v1",
    "state-based-gst-v2",
  ].includes(snapshot.billingVersion);
  let orderId;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        const currentPayment = await Payment.findById(payment._id)
          .select("+gatewayMetadata")
          .session(session);
        if (currentPayment.order) {
          orderId = currentPayment.order;
          return;
        }
        for (const item of snapshot.items) {
          await deductInventory(item, session, {
            model: "Payment",
            id: currentPayment._id,
            label: currentPayment.paymentReference,
          });
        }

        const [order] = await Order.create(
          [
            {
              orderNumber: generateOrderNumber(),
              user: currentPayment.user,
              items: snapshot.items,
              shippingAddress: snapshot.shippingAddress,
              billingAddress: snapshot.billingAddress,
              subtotal: snapshot.subtotal,
              discount: snapshot.discount,
              shippingCharge: usesCurrentBilling
                ? 0
                : Number(snapshot.shipping || 0),
              insuranceCharge: usesCurrentBilling
                ? 0
                : Number(snapshot.insurance || 0),
              cgst: usesCurrentBilling ? snapshot.cgst : 0,
              sgst: usesCurrentBilling ? snapshot.sgst : 0,
              igst:
                snapshot.billingVersion === "state-based-gst-v2"
                  ? snapshot.igst
                  : 0,
              tax: snapshot.tax,
              taxMode:
                snapshot.billingVersion === "state-based-gst-v2"
                  ? snapshot.taxMode
                  : undefined,
              placeOfSupplyState:
                snapshot.billingVersion === "state-based-gst-v2"
                  ? snapshot.placeOfSupplyState
                  : undefined,
              supplierState:
                snapshot.billingVersion === "state-based-gst-v2"
                  ? snapshot.supplierState
                  : undefined,
              roundOff: 0,
              grandTotal: snapshot.grandTotal,
              currency: snapshot.currency,
              coupon: snapshot.coupon || null,
              couponCode: snapshot.couponCode || null,
              paymentMethod: ORDER_PAYMENT_METHOD[currentPayment.method],
              paymentStatus: "paid",
              fulfillmentStatus: "unfulfilled",
              orderStatus: "confirmed",
              source: ["android", "ios"].includes(snapshot.source)
                ? "mobileApp"
                : "web",
              customerNote: snapshot.customerNote,
              legalAcceptances: snapshot.legalAcceptances || [],
              metadata: usesCurrentBilling
                ? {
                    billingVersion: snapshot.billingVersion,
                    taxMode: snapshot.taxMode || "exclusive",
                    placeOfSupplyState:
                      snapshot.placeOfSupplyState ||
                      snapshot.shippingAddress?.state ||
                      "",
                    supplierState:
                      snapshot.supplierState ||
                      process.env.INVOICE_STATE_NAME ||
                      "Maharashtra",
                    cgstRate: String(
                      snapshot.taxMode === "interState" ? 0 : 1.5,
                    ),
                    sgstRate: String(
                      snapshot.taxMode === "interState" ? 0 : 1.5,
                    ),
                    igstRate: String(snapshot.taxMode === "interState" ? 3 : 0),
                  }
                : {
                    billingVersion: "legacy",
                    pricesIncludeGst: String(
                      Boolean(snapshot.pricesIncludeGst),
                    ),
                  },
              statusHistory: [
                {
                  status: "confirmed",
                  note: "Payment verified by HDFC",
                  changedByType: "system",
                },
              ],
              confirmedAt: new Date(),
              idempotencyKey: currentPayment.paymentReference,
            },
          ],
          { session },
        );
        orderId = order._id;

        currentPayment.order = order._id;
        currentPayment.status = "captured";
        currentPayment.transactionId = gatewayResult.transactionId;
        currentPayment.bankReferenceNumber = gatewayResult.bankReferenceNumber;
        currentPayment.responseCode = gatewayResult.responseCode;
        currentPayment.responseMessage = gatewayResult.responseMessage;
        currentPayment.signatureVerified = true;
        currentPayment.capturedAt = new Date();
        currentPayment.attempts.push({
          attemptNumber: currentPayment.attempts.length + 1,
          gatewayRequestId: gatewayResult.transactionId,
          status: "captured",
          completedAt: new Date(),
        });
        currentPayment.gatewayMetadata.set(
          "verifiedResponse",
          JSON.stringify(gatewayResult.raw),
        );
        await currentPayment.save({ session, validateBeforeSave: false });

        if (snapshot.coupon)
          await Coupon.updateOne(
            { _id: snapshot.coupon },
            { $inc: { usedCount: 1 } },
            { session },
          );
        await Cart.updateOne(
          { user: currentPayment.user },
          {
            $set: {
              items: [],
              coupon: null,
              couponCode: null,
              subtotal: 0,
              discount: 0,
              cgst: 0,
              sgst: 0,
              igst: 0,
              tax: 0,
              shipping: 0,
              insurance: 0,
              total: 0,
            },
          },
          { session },
        );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );
  } catch (error) {
    if (gatewayResult.verified) {
      await Payment.updateOne(
        { _id: payment._id, order: null },
        {
          $set: {
            status: "captured",
            transactionId: gatewayResult.transactionId,
            bankReferenceNumber: gatewayResult.bankReferenceNumber,
            signatureVerified: true,
            capturedAt: new Date(),
            responseMessage: `Payment captured; fulfillment failed: ${error.message}`,
          },
        },
      );
      try {
        await notifyRoles({
          roles: ["superAdmin", "admin", "orderManager"],
          type: "payment",
          title: "Paid order needs intervention",
          message: `Payment ${payment.paymentReference} was captured but order creation failed.`,
          data: {
            paymentId: payment._id,
            paymentReference: payment.paymentReference,
          },
          priority: "urgent",
        });
      } catch (notificationError) {
        console.error("Admin payment alert failed", notificationError.message);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const order = await Order.findById(orderId);
  try {
    await runPostPaymentActions(payment, order, req);
  } catch (error) {
    // The order transaction is committed; email/invoice/notification errors are not payment failures.
    console.error("Post-payment actions require retry", payment.paymentReference, error.message);
  }
  return order;
};

const verifyAndFinalize = async ({
  paymentReference,
  callbackPayload,
  callbackSignature,
  callbackRawBody,
  userId,
  req,
}) => {
  if (typeof paymentReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(paymentReference)) {
    throw new AppError("A valid payment reference is required", 422, "PAYMENT_REFERENCE_REQUIRED");
  }
  const filter = { paymentReference };
  if (userId) filter.user = userId;
  const payment = await Payment.findOne(filter).select(
    "+gatewayMetadata +idempotencyKey",
  );
  if (!payment)
    throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  const receipt = await confirmedOrderForPayment(payment, Order);
  if (receipt) return receipt;
  const gatewayResult = await verifyHdfcPaymentStatus({
    paymentReference: payment.gatewayOrderId || paymentReference,
    callbackPayload,
    callbackSignature,
    callbackRawBody,
  });
  return finalizeVerifiedPayment({ payment, gatewayResult, req });
};

const verifyPayment = asyncHandler(async (req, res) => {
  const order = await verifyAndFinalize({
    paymentReference: req.body.paymentReference,
    userId: req.user.id,
    req,
  });
  return ApiResponse.success(res, {
    message: "Payment verified and order confirmed",
    data: order,
  });
});

const getHdfcOrderStatus = asyncHandler(async (req, res) => {
  const paymentReference = String(req.body.paymentReference || "").trim();
  if (!paymentReference) {
    throw new AppError(
      "Payment reference is required",
      422,
      "PAYMENT_REFERENCE_REQUIRED",
    );
  }

  const payment = await Payment.findOne({
    paymentReference,
    user: req.user.id,
    gateway: "hdfc",
  }).select("paymentReference gatewayOrderId");
  if (!payment) {
    throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  }

  const gatewayResult = await verifyHdfcPaymentStatus({
    paymentReference: payment.gatewayOrderId || payment.paymentReference,
  });

  return ApiResponse.success(res, {
    message: "HDFC order status retrieved",
    data: gatewayResult.raw,
  });
});

const hdfcCallback = asyncHandler(async (req, res) => {
  const paymentReference =
    req.body.merchant_txn_id || req.body.payment_reference || req.body.order_id;
  if (!paymentReference)
    throw new AppError(
      "Payment reference is missing",
      400,
      "PAYMENT_REFERENCE_REQUIRED",
    );
  const order = await verifyAndFinalize({
    paymentReference,
    callbackPayload: req.body,
    callbackSignature: req.get("x-hdfc-signature") || req.body.signature,
    callbackRawBody: req.get("x-hdfc-signature") ? req.rawBody : undefined,
    req,
  });
  return ApiResponse.success(res, {
    message: "Payment processed",
    data: { orderId: order._id, orderNumber: order.orderNumber },
  });
});

const hdfcBrowserReturn = asyncHandler(async (req, res) => {
  const paymentReference =
    paymentReferenceFromPayload(req.body) || paymentReferenceFromPayload(req.query);

  if (!paymentReference) {
    return res.redirect(
      303,
      paymentResultRedirectUrl({
        status: "missing_reference",
        message: "Payment reference is missing",
      }),
    );
  }

  return res.redirect(
    303,
    paymentResultRedirectUrl({
      paymentReference,
      status: req.body.status || req.query.status,
    }),
  );
});

const getPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({
    paymentReference: req.params.paymentReference,
    user: req.user.id,
  }).select(
    "paymentReference order amount currency status method capturedAt failedAt responseMessage",
  );
  if (!payment)
    throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  return ApiResponse.success(res, { data: payment });
});

const listPaymentsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const baseFilter = {};
  if (req.query.search) {
    const escaped = String(req.query.search)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) {
      baseFilter.$or = [
        { paymentReference: new RegExp(escaped, "i") },
        { gatewayOrderId: new RegExp(escaped, "i") },
        { transactionId: new RegExp(escaped, "i") },
        { bankReferenceNumber: new RegExp(escaped, "i") },
      ];
    }
  }
  const filter = { ...baseFilter };
  applyStatusFilter(filter, "status", req.query.status);

  const [payments, total, summary] = await Promise.all([
    Payment.find(filter)
      .select("-attempts")
      .populate("user", "firstName lastName email phone")
      .populate("order", "orderNumber orderStatus paymentStatus grandTotal")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(filter),
    summarizeStatusFields(Payment, baseFilter),
  ]);

  return ApiResponse.success(res, {
    data: payments,
    meta: { page, limit, total, pages: Math.ceil(total / limit), summary },
  });
});

const getPaymentAdmin = asyncHandler(async (req, res) => {
  const identity = mongoose.isValidObjectId(req.params.identifier)
    ? { _id: req.params.identifier }
    : { paymentReference: String(req.params.identifier).trim().toUpperCase() };
  const payment = await Payment.findOne(identity)
    .populate("user", "firstName lastName email phone")
    .populate(
      "order",
      "orderNumber orderStatus paymentStatus fulfillmentStatus grandTotal",
    );
  if (!payment)
    throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  return ApiResponse.success(res, { data: payment });
});

module.exports = {
  initiatePayment,
  verifyPayment,
  getHdfcOrderStatus,
  hdfcCallback,
  hdfcBrowserReturn,
  getPaymentStatus,
  listPaymentsAdmin,
  getPaymentAdmin,
  finalizeVerifiedPayment,
};
