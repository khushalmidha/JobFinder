const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const auth = require('../middleware/auth');

// Jobs list and filters
router.get('/', auth, jobController.getJobs);
router.post('/scan', auth, jobController.triggerScan);
router.patch('/:id/status', auth, jobController.updateJobStatus);
router.get('/export-sheet', auth, jobController.exportJobSheet);

// Companies directory
router.get('/companies', auth, jobController.getCompanies);
router.post('/companies', auth, jobController.addCompany);

// Scheduler
router.get('/scheduler', auth, jobController.getSchedulerInfo);
router.post('/scheduler', auth, jobController.updateSchedulerInfo);

module.exports = router;
