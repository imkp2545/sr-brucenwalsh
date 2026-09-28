const express = require('express');
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const moderationRoles = roleMiddleware('superAdmin', 'admin', 'catalogManager', 'supportManager');

router.get('/product/:productId', reviewController.listProductReviews);
router.get('/manage/all', authMiddleware, moderationRoles, reviewController.listReviewsAdmin);
router.get('/manage/:reviewId', authMiddleware, moderationRoles, reviewController.getReviewAdmin);
router.delete('/manage/:reviewId', authMiddleware, moderationRoles, reviewController.deleteReviewAdmin);
router.get('/mine', authMiddleware, roleMiddleware('customer'), reviewController.listMyReviews);
router.post('/', authMiddleware, roleMiddleware('customer'), uploadMiddleware.fields([{ name: 'images', maxCount: 5 }]), reviewController.createReview);
router.patch('/:reviewId', authMiddleware, roleMiddleware('customer'), reviewController.updateMyReview);
router.delete('/:reviewId', authMiddleware, roleMiddleware('customer'), reviewController.deleteMyReview);
router.post('/:reviewId/helpful', authMiddleware, roleMiddleware('customer'), reviewController.toggleHelpful);

module.exports = router;
