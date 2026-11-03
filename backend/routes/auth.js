const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.get('/settings', auth, authController.getSettings);
router.patch('/settings', auth, authController.updateSettings);
router.get('/profile', auth, authController.getProfile);
router.put('/profile', auth, authController.updateProfile);
router.post('/convert-template', auth, authController.convertTemplate);
router.post('/block-company', auth, authController.blockCompany);
router.post('/unblock-company', auth, authController.unblockCompany);
router.get('/available-sync-accounts', auth, authController.getAvailableSyncAccounts);

module.exports = router;
