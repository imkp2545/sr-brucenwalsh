const express = require('express');
const cartController = require('../controllers/cartController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware, roleMiddleware('customer'));
router.get('/', cartController.getCart);
router.post('/items', cartController.addItem);
router.patch('/items/:itemId', cartController.updateItem);
router.delete('/items/:itemId', cartController.removeItem);
router.delete('/', cartController.clearCart);
router.post('/coupon', cartController.applyCoupon);
router.delete('/coupon', cartController.removeCoupon);
router.post('/refresh-prices', cartController.refreshPrices);

module.exports = router;
