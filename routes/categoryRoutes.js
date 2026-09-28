const express = require('express');
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const catalogRoles = roleMiddleware('superAdmin', 'admin', 'catalogManager');

router.get('/', categoryController.listCategories);
router.get('/menu', categoryController.getCategoryMenu);
router.get('/manage/all', authMiddleware, catalogRoles, categoryController.listAllCategories);
router.post(
  '/',
  authMiddleware,
  catalogRoles,
  uploadMiddleware.fields([{ name: 'image', maxCount: 1 }, { name: 'icon', maxCount: 1 }]),
  categoryController.createCategory,
);
router.patch(
  '/:categoryId',
  authMiddleware,
  catalogRoles,
  uploadMiddleware.fields([{ name: 'image', maxCount: 1 }, { name: 'icon', maxCount: 1 }]),
  categoryController.updateCategory,
);
router.delete('/:categoryId', authMiddleware, catalogRoles, categoryController.deleteCategory);
router.get('/:identifier', categoryController.getCategory);

module.exports = router;
