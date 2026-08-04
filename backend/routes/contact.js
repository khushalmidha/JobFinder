const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const auth = require('../middleware/auth');

router.get('/', auth, contactController.getContacts);
router.post('/bulk', auth, contactController.bulkCreate);
router.patch('/:id', auth, contactController.updateContact);
router.delete('/:id', auth, contactController.deleteContact);

module.exports = router;
