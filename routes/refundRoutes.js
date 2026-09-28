const express = require('express');
const refundController = require('../controllers/refundController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/hdfc/webhook', refundController.hdfcRefundWebhook);
router.get('/manage/all', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), refundController.listRefundsAdmin);
router.get('/manage/:refundId', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), refundController.getRefundAdmin);
router.post('/', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), refundController.initiateRefund);
router.post('/:refundId/verify', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), refundController.verifyRefund);
router.get('/', authMiddleware, roleMiddleware('customer'), refundController.listMyRefunds);

module.exports = router;
