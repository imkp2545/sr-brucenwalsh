const express = require('express');
const supportEnquiryController = require('../controllers/supportEnquiryController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

const router = express.Router();
const managementRoles = roleMiddleware('superAdmin', 'admin', 'supportManager');

router.use(authMiddleware);
router.get('/manage/all', managementRoles, supportEnquiryController.listEnquiriesAdmin);
router.get('/manage/agents', managementRoles, supportEnquiryController.listSupportAgents);
router.get('/manage/:enquiryId', managementRoles, supportEnquiryController.getEnquiryAdmin);
router.patch('/manage/:enquiryId', managementRoles, supportEnquiryController.updateEnquiryAdmin);
router.get('/', roleMiddleware('customer'), supportEnquiryController.listMyEnquiries);
router.post('/', roleMiddleware('customer'), supportEnquiryController.createEnquiry);
router.post('/:enquiryId/replies', roleMiddleware('customer'), supportEnquiryController.replyToEnquiry);

module.exports = router;
