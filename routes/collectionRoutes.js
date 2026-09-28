const express = require('express');
const collectionController = require('../controllers/collectionController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const managementRoles = roleMiddleware('superAdmin', 'admin', 'catalogManager', 'marketingManager');

router.get('/', collectionController.listCollections);
router.get('/screen', collectionController.getCollectionScreen);
router.get('/home', collectionController.getHomeCollections);
router.get('/manage/all', authMiddleware, managementRoles, collectionController.listAllCollections);
router.post(
  '/',
  authMiddleware,
  managementRoles,
  uploadMiddleware.fields([{ name: 'heroImage', maxCount: 1 }, { name: 'mobileImage', maxCount: 1 }]),
  collectionController.createCollection,
);
router.patch(
  '/:collectionId',
  authMiddleware,
  managementRoles,
  uploadMiddleware.fields([{ name: 'heroImage', maxCount: 1 }, { name: 'mobileImage', maxCount: 1 }]),
  collectionController.updateCollection,
);
router.delete('/:collectionId', authMiddleware, managementRoles, collectionController.deleteCollection);
router.get('/:identifier', collectionController.getCollection);

module.exports = router;
