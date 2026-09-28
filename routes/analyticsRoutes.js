const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();
const analyticsRoles = roleMiddleware('superAdmin');
const workspaceRoles = roleMiddleware(
  'superAdmin',
  'admin',
  'catalogManager',
  'orderManager',
  'supportManager',
  'marketingManager',
);

router.use(authMiddleware);
router.get('/workspace', workspaceRoles, analyticsController.getWorkspaceDashboard);
router.use(analyticsRoles);
router.get('/dashboard', analyticsController.getDashboard);
router.get('/revenue', analyticsController.getRevenueAnalytics);
router.get('/products', analyticsController.getProductAnalytics);

module.exports = router;
