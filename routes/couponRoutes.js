const express = require('express');
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/validate', authMiddleware, roleMiddleware('customer'), couponController.validateCoupon);
router.get('/manage/all', authMiddleware, roleMiddleware('superAdmin', 'admin', 'marketingManager'), couponController.listCoupons);
router.get('/manage/:couponId', authMiddleware, roleMiddleware('superAdmin', 'admin', 'marketingManager'), couponController.getCoupon);
router.post('/', authMiddleware, roleMiddleware('superAdmin', 'admin', 'marketingManager'), couponController.createCoupon);
router.patch('/:couponId', authMiddleware, roleMiddleware('superAdmin', 'admin', 'marketingManager'), couponController.updateCoupon);
router.delete('/:couponId', authMiddleware, roleMiddleware('superAdmin', 'admin', 'marketingManager'), couponController.deleteCoupon);

module.exports = router;
