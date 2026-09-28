const express = require('express');
const cmsController = require('../controllers/cmsController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const contentRoles = roleMiddleware('superAdmin', 'admin', 'marketingManager');
const blockMedia = uploadMiddleware.fields([{ name: 'blockMedia', maxCount: 10 }]);

router.get('/', cmsController.listPublishedPages);
router.get('/legal/index', cmsController.listPublishedLegalPages);
router.get('/manage/all', authMiddleware, contentRoles, cmsController.listPagesAdmin);
router.get('/manage/:pageId', authMiddleware, contentRoles, cmsController.getPageAdmin);
router.post('/', authMiddleware, contentRoles, blockMedia, cmsController.createPage);
router.patch('/:pageId', authMiddleware, contentRoles, blockMedia, cmsController.updatePage);
router.delete('/:pageId', authMiddleware, contentRoles, cmsController.archivePage);
router.get('/:slug', cmsController.getPublishedPage);

module.exports = router;
