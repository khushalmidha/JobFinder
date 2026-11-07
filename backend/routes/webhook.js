const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

router.post('/mail-status', express.raw({ type: 'application/json', limit: '32kb' }), webhookController.handleBounceWebhook);

module.exports = router;
