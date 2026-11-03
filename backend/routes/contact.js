const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const auth = require('../middleware/auth');

router.get('/', auth, contactController.getContacts);
router.get('/companies', auth, contactController.getCompanies);
router.post('/bulk', auth, contactController.bulkCreate);
router.patch('/:id', auth, contactController.updateContact);
router.delete('/:id', auth, contactController.deleteContact);

// Manual Share and Reply endpoints
router.put('/:id/toggle-shared', auth, contactController.toggleShared);
router.put('/:id/mark-replied', auth, contactController.markReplied);
router.post('/bulk-toggle-shared', auth, contactController.bulkToggleShared);
router.post('/bulk-mark-replied', auth, contactController.bulkMarkReplied);
router.post('/bulk-delete', auth, contactController.bulkDelete);

// Email Deliverability & Verification endpoints
router.post('/validate-deliverability', auth, contactController.validateDeliverability);
router.post('/bulk-deliverability', auth, contactController.batchMarkDeliverability);
router.put('/:id/deliverability', auth, contactController.markDeliverability);

module.exports = router;
