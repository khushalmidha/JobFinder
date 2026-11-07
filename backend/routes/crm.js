const router = require('express').Router();
const auth = require('../middleware/auth');
const service = require('../services/outreachCrmService');
const Contact = require('../models/Contact');
router.use(auth);
const handle = fn => async (req, res) => { try { res.json(await fn(req)); } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'CRM operation failed' }); } };
router.get('/overview', handle(req => service.overview(req.user._id)));
router.get('/contacts', handle(async req => {
  const q = String(req.query.q || '').slice(0, 100);
  const pattern = new RegExp(service.escape(q), 'i');
  return { contacts: await Contact.find({ userId: req.user._id, $or: [{ email: pattern }, { company: pattern }] }).select('company email hrName status').sort({ updatedAt: -1 }).limit(50).lean() };
}));
router.post('/reminders', handle(req => service.createReminder(req.user._id, req.body || {})));
router.patch('/reminders/:id', handle(req => service.closeReminder(req.user._id, req.params.id, req.body || {})));
router.get('/reminders/:id/draft', handle(req => service.draft(req.user._id, req.params.id)));
router.post('/contacts/:id/reply', handle(req => service.recordReplyOrOptOut(req.user._id, req.params.id, req.body || {})));
router.post('/contacts/:id/opt-out', handle(req => service.recordReplyOrOptOut(req.user._id, req.params.id, req.body || {}, true)));
module.exports = router;
