const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Webhooks don't use JWT auth, they rely on provider signatures or secrets usually.
// For MVP, we'll keep it open but recommend adding signature verification later.
router.post('/mail-status', express.json(), webhookController.handleBounceWebhook);

module.exports = router;
