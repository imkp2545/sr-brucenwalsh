const express = require('express');
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get('/manage/all', roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), orderController.listOrdersAdmin);
router.get('/manage/:identifier/invoice', roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), orderController.downloadOrderInvoiceAdmin);
router.get('/manage/:identifier', roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), orderController.getOrderAdmin);
router.patch('/manage/:orderId/status', roleMiddleware('superAdmin', 'admin', 'orderManager'), orderController.updateOrderStatus);
router.get('/', roleMiddleware('customer'), orderController.listMyOrders);
router.get('/:identifier/invoice', roleMiddleware('customer'), orderController.downloadMyOrderInvoice);
router.get('/:identifier', roleMiddleware('customer'), orderController.getMyOrder);

module.exports = router;
