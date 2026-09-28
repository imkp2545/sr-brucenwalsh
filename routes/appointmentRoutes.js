const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get(
  '/manage/all',
  roleMiddleware('superAdmin', 'admin', 'supportManager'),
  appointmentController.listAppointmentsAdmin,
);
router.get(
  '/manage/consultants',
  roleMiddleware('superAdmin', 'admin', 'supportManager'),
  appointmentController.listAppointmentConsultants,
);
router.get(
  '/manage/:appointmentId',
  roleMiddleware('superAdmin', 'admin', 'supportManager'),
  appointmentController.getAppointmentAdmin,
);
router.patch(
  '/manage/:appointmentId',
  roleMiddleware('superAdmin', 'admin', 'supportManager'),
  appointmentController.updateAppointmentAdmin,
);
router.get('/', roleMiddleware('customer'), appointmentController.listMyAppointments);
router.post('/', roleMiddleware('customer'), appointmentController.bookAppointment);
router.get('/:appointmentId', roleMiddleware('customer'), appointmentController.getAppointment);
router.patch('/:appointmentId/cancel', roleMiddleware('customer'), appointmentController.cancelAppointment);

module.exports = router;
