const express = require('express');
const controller = require('../controllers/customerAnalyticsController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();
router.use(authMiddleware);
router.post('/events/batch', roleMiddleware('customer'), controller.ingest);
router.get('/overview', roleMiddleware('superAdmin', 'admin', 'marketingManager'), controller.getOverview);
router.get('/customers/:userId', roleMiddleware('superAdmin', 'admin', 'supportManager', 'marketingManager'), controller.getCustomer);

module.exports = router;
