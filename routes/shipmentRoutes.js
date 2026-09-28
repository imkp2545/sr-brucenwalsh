const express = require('express');
const shipmentController = require('../controllers/shipmentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/bluedart/webhook', shipmentController.blueDartWebhook);
router.get('/serviceability', authMiddleware, roleMiddleware('customer', 'superAdmin', 'admin', 'orderManager'), shipmentController.serviceability);
router.get('/manage/all', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), shipmentController.listShipmentsAdmin);
router.get('/manage/eligible-orders', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), shipmentController.listEligibleOrders);
router.get('/manage/:shipmentId', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), shipmentController.getShipmentAdmin);
router.get('/manage/:shipmentId/label', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), shipmentController.getShipmentLabelAdmin);
router.post('/', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), shipmentController.createShipment);
router.post('/manage/:shipmentId/track', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager'), shipmentController.trackShipmentAdmin);
router.patch('/manage/:shipmentId/waybill', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), shipmentController.updateWaybillAdmin);
router.post('/manage/:shipmentId/cancel', authMiddleware, roleMiddleware('superAdmin', 'admin', 'orderManager'), shipmentController.cancelWaybillAdmin);
router.get('/', authMiddleware, roleMiddleware('customer'), shipmentController.listMyShipments);
router.post('/:shipmentId/track', authMiddleware, roleMiddleware('customer'), shipmentController.trackMyShipment);

module.exports = router;
