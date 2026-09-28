const express = require('express');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const { authRateLimiter, refreshRateLimiter } = require('../middleware/securityMiddleware');

const router = express.Router();

router.post('/request-otp', authRateLimiter, authController.requestOtp);
router.post('/verify-otp', authRateLimiter, authController.verifyOtp);
router.post('/register', authRateLimiter, authController.register);
router.post('/verify-email', authRateLimiter, authController.verifyEmail);
router.get('/verify-email', authRateLimiter, authController.verifyEmail);
router.post('/resend-verification', authRateLimiter, authController.resendVerification);
router.post('/login', authRateLimiter, authController.login);
router.post('/refresh', refreshRateLimiter, authController.refreshSession);
router.post('/logout', authController.logout);
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);
router.post('/reset-password', authRateLimiter, authController.resetPassword);

router.get('/me', authMiddleware, authController.getProfile);
router.patch('/me', authMiddleware, authController.updateProfile);
router.patch('/me/password', authMiddleware, authRateLimiter, authController.changePassword);
router.post('/me/addresses', authMiddleware, authController.addAddress);
router.patch('/me/addresses/:addressId', authMiddleware, authController.updateAddress);
router.delete('/me/addresses/:addressId', authMiddleware, authController.deleteAddress);

module.exports = router;
