const express = require('express');
const checkoutController = require('../controllers/checkoutController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/summary', authMiddleware, roleMiddleware('customer'), checkoutController.getCheckoutSummary);

module.exports = router;
