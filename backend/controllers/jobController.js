const JobOpening = require('../models/JobOpening');
const Company = require('../models/Company');
const JobSchedulerConfig = require('../models/JobSchedulerConfig');
const { runScheduledCrawl, getSchedulerStatus } = require('../services/jobSchedulerService');
const { generateJobSpreadsheet } = require('../services/jobScraperService');

/**
 * Get all job openings with filters and pagination
 */
exports.getJobs = async (req, res) => {
  try {
    const { 
      category, 
      locationType, // 'india', 'remote', 'all'
      status, 
      tier,
      search,
      jobType, // '6_months_internship', 'internship', 'full_time', 'all'
      fresherOnly, // 'true'
      minCtc, // number e.g. 12
      page = 1, 
      limit = 50 
    } = req.query;

    const query = {};

    if (category && category !== 'all') {
      query.roleCategory = category;
    }

    if (jobType === 'international_remote') {
      query.isInternationalRemote = true;
    } else if (jobType === '6_months_internship') {
      query.is6MonthIntern = true;
    } else if (jobType === 'internship') {
      query.jobType = { $in: ['internship', '6_months_internship'] };
    } else if (jobType === 'full_time') {
      query.jobType = 'full_time';
    }

    if (fresherOnly === 'true') {
      query.isFresherEligible = true;
    }

    if (minCtc) {
      query.ctcMin = { $gte: Number(minCtc) };
    }

    if (locationType === 'india') {
      query.isIndia = true;
    } else if (locationType === 'remote') {
      query.isRemote = true;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (tier && tier !== 'all') {
      query.tier = tier;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await JobOpening.countDocuments(query);
    // Sort by priority first (critical = 6m interns, high = freshers, normal = full-time), then detectedAt desc
    const jobs = await JobOpening.find(query)
      .sort({ priority: 1, detectedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    // Summary counts
    const totalJobs = await JobOpening.countDocuments();
    const internationalInternships = await JobOpening.countDocuments({ isInternationalRemote: true });
    const sixMonthInternships = await JobOpening.countDocuments({ is6MonthIntern: true });
    const internships = await JobOpening.countDocuments({ jobType: { $in: ['internship', '6_months_internship'] } });
    const fullTimeJobs = await JobOpening.countDocuments({ jobType: 'full_time' });
    const fresherJobs = await JobOpening.countDocuments({ isFresherEligible: true, ctcMin: { $gte: 12 } });
    const indiaJobs = await JobOpening.countDocuments({ isIndia: true });
    const remoteJobs = await JobOpening.countDocuments({ isRemote: true });
    const appliedJobs = await JobOpening.countDocuments({ status: { $in: ['applied', 'auto_applied'] } });

    res.json({
      jobs,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      stats: {
        totalJobs,
        internationalInternships,
        sixMonthInternships,
        internships,
        fullTimeJobs,
        fresherJobs,
        indiaJobs,
        remoteJobs,
        appliedJobs
      }
    });
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Trigger an on-demand career scraper scan
 */
exports.triggerScan = async (req, res) => {
  try {
    const result = await runScheduledCrawl('Manual Request');
    res.json({ message: 'Scan initiated successfully', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Mark a job as auto-applied or updated status
 */
exports.updateJobStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const job = await JobOpening.findById(id);
    if (!job) return res.status(404).json({ error: 'Job opening not found' });

    job.status = status || 'applied';
    if (status === 'applied' || status === 'auto_applied') {
      job.appliedAt = new Date();
    }
    await job.save();

    res.json({ message: 'Job status updated', job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Download Excel (.xlsx) sheet of all job openings
 */
exports.exportJobSheet = async (req, res) => {
  try {
    const buffer = await generateJobSpreadsheet();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=JobFinder_India_Remote_Jobs_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Export Jobs Error:', err);
    res.status(500).json({ error: 'Failed to generate spreadsheet' });
  }
};

/**
 * Get company directory with active openings counts
 */
exports.getCompanies = async (req, res) => {
  try {
    const companies = await Company.find().sort({ tier: 1, name: 1 }).lean();
    res.json({ companies, count: companies.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Add a new target company to the directory
 */
exports.addCompany = async (req, res) => {
  try {
    const { name, domain, tier, locations, isIndia, isRemoteFriendly, careersUrl, atsType, atsToken } = req.body;
    if (!name || !careersUrl) {
      return res.status(400).json({ error: 'Company name and careers URL are required' });
    }

    const company = await Company.create({
      name,
      domain,
      tier: tier || 'Funded Tech Startup',
      locations: locations || ['India'],
      isIndia: isIndia !== undefined ? isIndia : true,
      isRemoteFriendly: isRemoteFriendly !== undefined ? isRemoteFriendly : true,
      careersUrl,
      atsType: atsType || 'custom',
      atsToken: atsToken || ''
    });

    res.json({ message: 'Company added to crawl directory', company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get automated scheduler status & user timer settings
 */
exports.getSchedulerInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    let config = await JobSchedulerConfig.findOne({ userId });
    if (!config) {
      config = await JobSchedulerConfig.create({ userId });
    }

    const systemStatus = getSchedulerStatus();
    res.json({
      systemStatus,
      userConfig: config
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Update scheduler settings
 */
exports.updateSchedulerInfo = async (req, res) => {
  try {
    const userId = req.user._id;
    const { enabled, autoApplyEnabled, morningTime, afternoonTime, nightTime } = req.body;

    const config = await JobSchedulerConfig.findOneAndUpdate(
      { userId },
      { 
        $set: { 
          enabled, 
          autoApplyEnabled, 
          morningTime: morningTime || '09:00',
          afternoonTime: afternoonTime || '14:00',
          nightTime: nightTime || '20:30'
        } 
      },
      { upsert: true, new: true }
    );

    res.json({ message: 'Scheduler settings updated', config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
