const express = require('express');
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get('/', notificationController.listNotifications);
router.get('/sent', roleMiddleware('superAdmin', 'admin', 'marketingManager', 'supportManager'), notificationController.listSentNotifications);
router.patch('/sent/:campaignId/cancel', roleMiddleware('superAdmin', 'admin', 'marketingManager', 'supportManager'), notificationController.cancelScheduledCampaign);
router.get('/targets/customers', roleMiddleware('superAdmin', 'admin', 'marketingManager', 'supportManager'), notificationController.listCustomerTargets);
router.patch('/read-all', notificationController.markAllAsRead);
router.delete('/all', notificationController.deleteAllNotifications);
router.post('/devices', roleMiddleware('customer'), notificationController.registerFcmToken);
router.delete('/devices', roleMiddleware('customer'), notificationController.unregisterFcmToken);
router.post('/send', roleMiddleware('superAdmin', 'admin', 'marketingManager', 'supportManager'), notificationController.sendAdminNotification);
router.patch('/:notificationId/unread', notificationController.markAsUnread);
router.patch('/:notificationId/read', notificationController.markAsRead);
router.delete('/:notificationId', notificationController.deleteNotification);

module.exports = router;
