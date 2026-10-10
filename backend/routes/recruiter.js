const express = require('express');
const router = express.Router();
const multer = require('multer');
const recruiterController = require('../controllers/recruiterController');
const auth = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// Access Control & 1-Click Email Approval routes
router.get('/access-status', auth, recruiterController.getAccessStatus);
router.post('/request-access', auth, recruiterController.requestAccess);
router.get('/access-requests/:token/approve', recruiterController.approveAccessRequest); // Public callback from Khushal's email
router.get('/access-requests/:token/reject', recruiterController.rejectAccessRequest);   // Public callback from Khushal's email
router.get('/admin/requests', auth, recruiterController.getAdminRequests);
router.post('/admin/review-request', auth, recruiterController.adminReviewRequest);

router.get('/curated', auth, recruiterController.getCurated);
router.post('/import-curated', auth, recruiterController.importCurated);
router.post('/upload-sheet', auth, upload.single('file'), recruiterController.uploadSheet);
router.post('/harvest-agencies', auth, recruiterController.harvestAgencies);
router.get('/export-sheet', auth, recruiterController.exportSheet);

module.exports = router;
