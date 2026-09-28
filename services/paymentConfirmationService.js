const AppError = require('../utils/appError');

// Resolve only a server-created receipt belonging to this payment's customer.
const confirmedOrderForPayment = async (payment, Order) => {
  if (!payment?.order) return null;
  const order = await Order.findById(payment.order);
  if (!order || String(order.user) !== String(payment.user) || !['paid', 'partiallyRefunded', 'refunded'].includes(order.paymentStatus)) {
    throw new AppError('The payment receipt requires reconciliation', 409, 'PAYMENT_RECEIPT_INCONSISTENT');
  }
  return order;
};

const updateUnconfirmedPayment = async (Payment, payment, fields) => {
  const result = await Payment.updateOne(
    {
      _id: payment._id,
      order: null,
      status: { $nin: ['captured', 'partiallyRefunded', 'refunded'] },
    },
    { $set: fields },
  );
  return result.matchedCount === 1;
};

module.exports = { confirmedOrderForPayment, updateUnconfirmedPayment };
