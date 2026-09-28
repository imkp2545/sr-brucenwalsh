const express = require('express');
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { authRateLimiter } = require('../middleware/securityMiddleware');

const router = express.Router();

router.post('/hdfc/callback', paymentController.hdfcCallback);
router.get('/hdfc/return', paymentController.hdfcBrowserReturn);
router.post('/hdfc/return', paymentController.hdfcBrowserReturn);
router.post('/hdfc/initiate', authMiddleware, roleMiddleware('customer'), authRateLimiter, paymentController.initiatePayment);
router.post('/hdfc/order-status', authMiddleware, roleMiddleware('customer'), authRateLimiter, paymentController.getHdfcOrderStatus);
router.post('/hdfc/verify', authMiddleware, roleMiddleware('customer'), authRateLimiter, paymentController.verifyPayment);
router.get('/manage/all', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), paymentController.listPaymentsAdmin);
router.get('/manage/:identifier', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), paymentController.getPaymentAdmin);
router.get('/:paymentReference/status', authMiddleware, roleMiddleware('customer'), paymentController.getPaymentStatus);

module.exports = router;
