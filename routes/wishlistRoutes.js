const express = require('express');
const wishlistController = require('../controllers/wishlistController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware, roleMiddleware('customer'));
router.get('/', wishlistController.getWishlist);
router.post('/items', wishlistController.addToWishlist);
router.post('/items/:itemId/move-to-cart', wishlistController.moveToCart);
router.delete('/items/:itemId', wishlistController.removeFromWishlist);
router.delete('/', wishlistController.clearWishlist);

module.exports = router;
