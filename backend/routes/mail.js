const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');
const analyzeController = require('../controllers/analyzeController');
const auth = require('../middleware/auth');

router.post('/send', auth, mailController.sendBatch);
router.get('/logs', auth, mailController.getLogs);
router.post('/analyze-response', auth, analyzeController.analyzeResponse);

module.exports = router;
