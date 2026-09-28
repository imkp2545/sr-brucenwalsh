const express = require('express');
const bannerController = require('../controllers/bannerController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const contentRoles = roleMiddleware('superAdmin', 'admin', 'marketingManager');
const bannerImages = uploadMiddleware.fields([
  { name: 'mobileImage', maxCount: 1 },
]);

router.get('/', bannerController.listActiveBanners);
router.post('/:bannerId/impression', bannerController.trackImpression);
router.post('/:bannerId/click', bannerController.trackClick);
router.get('/manage/all', authMiddleware, contentRoles, bannerController.listBannersAdmin);
router.get('/manage/:bannerId', authMiddleware, contentRoles, bannerController.getBannerAdmin);
router.post('/', authMiddleware, contentRoles, bannerImages, bannerController.createBanner);
router.patch('/:bannerId', authMiddleware, contentRoles, bannerImages, bannerController.updateBanner);
router.delete('/:bannerId', authMiddleware, contentRoles, bannerController.deactivateBanner);

module.exports = router;
