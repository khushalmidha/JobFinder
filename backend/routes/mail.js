const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');
const auth = require('../middleware/auth');

router.post('/send', auth, mailController.sendBatch);
router.get('/logs', auth, mailController.getLogs);

module.exports = router;
