const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');
const analyzeController = require('../controllers/analyzeController');
const bounceController = require('../controllers/bounceController');
const otpController = require('../controllers/otpController');
const auth = require('../middleware/auth');

router.post('/send', auth, mailController.sendBatch);
router.get('/logs', auth, mailController.getLogs);
router.get('/queue-status', auth, mailController.getQueueStatus);
router.post('/test-connection', auth, mailController.testConnection);
router.post('/pause-queue', auth, mailController.pauseQueue);
router.post('/resume-queue', auth, mailController.resumeQueue);
router.post('/scan-bounces', auth, bounceController.scanBounces);
router.delete('/delete-bounced', auth, bounceController.deleteBounced);
router.post('/analyze-response', auth, analyzeController.analyzeResponse);
router.post('/generate-form-answers', auth, analyzeController.generateFormAnswers);
router.get('/latest-otp', auth, otpController.getLatestOtp);

module.exports = router;
