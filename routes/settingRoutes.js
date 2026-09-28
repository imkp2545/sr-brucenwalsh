const express = require('express');
const settingController = require('../controllers/settingController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.get('/public', settingController.getPublicSettings);
router.get('/manage/all', authMiddleware, roleMiddleware('superAdmin', 'admin'), settingController.listSettingsAdmin);
router.get('/manage/business', authMiddleware, roleMiddleware('superAdmin', 'admin'), settingController.getBusinessSettings);
router.patch('/manage/business', authMiddleware, roleMiddleware('superAdmin'), settingController.updateBusinessSettings);
router.get('/manage/:key', authMiddleware, roleMiddleware('superAdmin', 'admin'), settingController.getSettingAdmin);
router.put('/manage/:key', authMiddleware, roleMiddleware('superAdmin'), settingController.upsertSetting);
router.delete('/manage/:key', authMiddleware, roleMiddleware('superAdmin'), settingController.deleteSetting);

module.exports = router;
