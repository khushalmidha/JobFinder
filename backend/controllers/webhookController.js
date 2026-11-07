const service = require('../services/signedDeliveryEventService');
exports.handleBounceWebhook = async (req, res) => {
  try { res.json(await service.applyEvent(service.authenticate(req.body, req.headers))); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Delivery event processing failed; review server history' }); }
};
