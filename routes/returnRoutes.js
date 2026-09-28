const express = require('express');
const returnController = require('../controllers/returnController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');
const { carrierRateLimiter } = require('../middleware/securityMiddleware');

const router = express.Router();
const managementRoles = roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager');
const operationsRoles = roleMiddleware('superAdmin', 'admin', 'orderManager');

router.use(authMiddleware);
router.get('/manage/all', managementRoles, returnController.listReturnsAdmin);
router.post('/manage/:returnId/track-pickup', managementRoles, carrierRateLimiter, returnController.trackReturnPickupAdmin);
router.post('/manage/:returnId/cancel-pickup', operationsRoles, carrierRateLimiter, returnController.cancelReturnPickupAdmin);
router.get('/manage/:returnId/label', managementRoles, returnController.getReturnLabelAdmin);
router.get('/manage/:returnId', managementRoles, returnController.getReturnAdmin);
router.patch('/manage/:returnId/review', managementRoles, returnController.reviewReturn);
router.patch('/manage/:returnId/schedule-pickup', operationsRoles, carrierRateLimiter, returnController.scheduleReturnPickup);
router.patch('/manage/:returnId/picked-up', operationsRoles, returnController.markReturnPickedUp);
router.patch('/manage/:returnId/received', operationsRoles, returnController.markReturnReceived);
router.patch('/manage/:returnId/inspect', managementRoles, returnController.inspectReturn);
router.patch('/manage/:returnId/complete', managementRoles, returnController.completeReturnResolution);
router.get('/', roleMiddleware('customer'), returnController.listMyReturns);
router.post('/', roleMiddleware('customer'), uploadMiddleware.fields([{ name: 'evidence', maxCount: 10 }]), returnController.requestReturn);
router.post('/:returnId/track-pickup', roleMiddleware('customer'), carrierRateLimiter, returnController.trackMyReturnPickup);
router.get('/:returnId', roleMiddleware('customer'), returnController.getMyReturn);
router.patch('/:returnId/cancel', roleMiddleware('customer'), returnController.cancelReturn);

module.exports = router;
