const express = require('express');
const inventoryController = require('../controllers/inventoryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get('/manage/all', roleMiddleware('superAdmin', 'admin', 'catalogManager', 'orderManager'), inventoryController.listInventory);
router.get('/manage/movements', roleMiddleware('superAdmin', 'admin', 'catalogManager', 'orderManager'), inventoryController.listMovements);
router.post('/manage/adjust', roleMiddleware('superAdmin', 'admin', 'catalogManager'), inventoryController.adjustInventory);

module.exports = router;
