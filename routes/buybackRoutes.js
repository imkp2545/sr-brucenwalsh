const express = require('express');
const buybackController = require('../controllers/buybackController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const managementRoles = roleMiddleware('superAdmin', 'admin', 'orderManager', 'supportManager');
const operationalRoles = roleMiddleware('superAdmin', 'admin', 'orderManager');

router.use(authMiddleware);
router.get('/manage/all', managementRoles, buybackController.listBuybacksAdmin);
router.get('/manage/:buybackId', managementRoles, buybackController.getBuybackAdmin);
router.patch('/manage/:buybackId/appointment', managementRoles, buybackController.scheduleAppointment);
router.patch('/manage/:buybackId/check-in', managementRoles, buybackController.checkIn);
router.patch('/manage/:buybackId/start-inspection', operationalRoles, buybackController.startInspection);
router.patch(
  '/manage/:buybackId/inspect',
  operationalRoles,
  uploadMiddleware.fields([{ name: 'inspectionImages', maxCount: 6 }]),
  buybackController.completeInspection,
);
router.patch('/manage/:buybackId/no-show', managementRoles, buybackController.markNoShow);
router.patch('/manage/:buybackId/close', managementRoles, buybackController.closeWithoutBuyback);
router.patch('/manage/:buybackId/start-settlement', operationalRoles, buybackController.startSettlement);
router.patch(
  '/manage/:buybackId/complete',
  operationalRoles,
  uploadMiddleware.fields([{ name: 'proof', maxCount: 1 }]),
  buybackController.completeSettlement,
);

router.get('/eligible-items', roleMiddleware('customer'), buybackController.eligibleItems);
router.get('/', roleMiddleware('customer'), buybackController.listMyBuybacks);
router.post(
  '/',
  roleMiddleware('customer'),
  uploadMiddleware.fields([
    { name: 'productImages', maxCount: 6 },
    { name: 'certificateImages', maxCount: 2 },
  ]),
  buybackController.createBuyback,
);
router.get('/:buybackId', roleMiddleware('customer'), buybackController.getMyBuyback);
router.patch('/:buybackId/cancel', roleMiddleware('customer'), buybackController.cancelBuyback);
router.patch('/:buybackId/appointment-preferences', roleMiddleware('customer'), buybackController.updateAppointmentPreferences);
router.patch('/:buybackId/withdraw', roleMiddleware('customer'), buybackController.requestWithdrawal);
router.patch('/:buybackId/accept-offer', roleMiddleware('customer'), buybackController.acceptOffer);
router.patch('/:buybackId/decline-offer', roleMiddleware('customer'), buybackController.declineOffer);

module.exports = router;
