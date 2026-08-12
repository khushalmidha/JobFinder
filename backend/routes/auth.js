const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.get('/settings', auth, authController.getSettings);
router.patch('/settings', auth, authController.updateSettings);
router.post('/convert-template', auth, authController.convertTemplate);

module.exports = router;
