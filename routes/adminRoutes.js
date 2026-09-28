const express = require('express');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { authRateLimiter } = require('../middleware/securityMiddleware');

const router = express.Router();

router.post('/setup-super-admin', authRateLimiter, adminController.setupSuperAdmin);
router.post('/verify-email', authRateLimiter, adminController.verifyAdminEmail);
router.get('/verify-email', authRateLimiter, adminController.verifyAdminEmail);
router.post('/resend-verification', authRateLimiter, adminController.resendAdminVerification);
router.post('/forgot-password', authRateLimiter, adminController.forgotAdminPassword);
router.post('/reset-password', authRateLimiter, adminController.resetAdminPassword);
router.post('/login', authRateLimiter, adminController.adminLogin);

router.use(authMiddleware);
router.get('/me', roleMiddleware('superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'), adminController.getAdminProfile);
router.patch('/me', roleMiddleware('superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'), adminController.updateAdminProfile);
router.patch('/me/password', authRateLimiter, roleMiddleware('superAdmin', 'admin', 'catalogManager', 'orderManager', 'supportManager', 'marketingManager'), adminController.changeAdminPassword);

router.get('/customers', roleMiddleware('superAdmin', 'admin', 'supportManager'), adminController.listCustomers);
router.get('/customers/:userId/360', roleMiddleware('superAdmin', 'admin', 'supportManager'), adminController.getCustomer360);
router.patch('/customers/:userId/status', roleMiddleware('superAdmin', 'admin', 'supportManager'), adminController.updateCustomerStatus);

router.get('/', roleMiddleware('superAdmin'), adminController.listAdmins);
router.post('/', roleMiddleware('superAdmin'), adminController.createAdmin);
router.post('/:adminId/verify', authRateLimiter, roleMiddleware('superAdmin'), adminController.verifyCreatedAdmin);
router.post('/:adminId/resend-verification', authRateLimiter, roleMiddleware('superAdmin'), adminController.resendCreatedAdminVerification);
router.patch('/:adminId', roleMiddleware('superAdmin'), adminController.updateAdmin);
router.delete('/:adminId', roleMiddleware('superAdmin'), adminController.deleteAdmin);

module.exports = router;
