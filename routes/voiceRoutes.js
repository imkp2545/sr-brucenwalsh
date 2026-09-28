const express = require('express');
const voiceController = require('../controllers/voiceController');

const router = express.Router();

router.get('/greeting', voiceController.getGreeting);
router.get('/greeting-audio', voiceController.getGreetingAudio);
router.get('/query-audio', voiceController.getQueryAudio);
router.get('/reply-audio', voiceController.getReplyAudio);
router.post('/assist', voiceController.getVoiceAssistance);

module.exports = router;
