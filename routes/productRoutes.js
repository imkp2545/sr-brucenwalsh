const express = require('express');
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');

const router = express.Router();
const catalogRoles = roleMiddleware('superAdmin', 'admin', 'catalogManager');
const productImages = uploadMiddleware.fields([{ name: 'images', maxCount: 10 }]);

router.get('/', productController.listProducts);
router.get('/featured', productController.getFeaturedProducts);
router.get('/new-arrivals', productController.getNewArrivals);
router.get('/best-sellers', productController.getBestSellers);
router.get('/trending', productController.getTrendingProducts);
router.get('/on-sale', productController.getOnSaleProducts);
router.get('/manage/all', authMiddleware, catalogRoles, productController.listAllProducts);
router.get('/manage/brands', authMiddleware, catalogRoles, productController.listBrandsAdmin);
router.get('/manage/:productId', authMiddleware, catalogRoles, productController.getProductAdmin);
router.get('/:identifier/related', productController.getRelatedProducts);
router.post('/', authMiddleware, catalogRoles, productImages, productController.createProduct);
router.patch('/:productId', authMiddleware, catalogRoles, productImages, productController.updateProduct);
router.delete('/:productId/images/:imageId', authMiddleware, catalogRoles, productController.removeProductImage);
router.patch('/:productId/images/:imageId/primary', authMiddleware, catalogRoles, productController.setPrimaryImage);
router.delete('/:productId', authMiddleware, catalogRoles, productController.deleteProduct);
router.get('/:identifier', productController.getProduct);

module.exports = router;
