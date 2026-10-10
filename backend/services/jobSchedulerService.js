const cron = require('node-cron');
const { crawlAllCompanies } = require('./jobScraperService');
const JobSchedulerConfig = require('../models/JobSchedulerConfig');

let scheduledTasks = [];
let isScanRunning = false;
let scanStartedAt = 0;

/**
 * Initializes the Morning, Afternoon, and Night cron jobs
 */
function initJobScheduler() {
  // Clear any existing tasks
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];

  console.log('Initializing Job Hunter 3-Slot Automated Scheduler (Morning, Afternoon, Night)...');

  // Slot 1: Morning (09:00 AM IST)
  // Note: cron expression: minute hour day-of-month month day-of-week
  const morningCron = cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Executing MORNING Scheduled Job Crawl (09:00 AM)...');
    await runScheduledCrawl('Morning (09:00 AM)');
  }, { scheduled: true, timezone: 'Asia/Kolkata' });
  scheduledTasks.push(morningCron);

  // Slot 2: Afternoon (02:00 PM IST)
  const afternoonCron = cron.schedule('0 14 * * *', async () => {
    console.log('⏰ Executing AFTERNOON Scheduled Job Crawl (02:00 PM)...');
    await runScheduledCrawl('Afternoon (02:00 PM)');
  }, { scheduled: true, timezone: 'Asia/Kolkata' });
  scheduledTasks.push(afternoonCron);

  // Slot 3: Night (08:30 PM IST)
  const nightCron = cron.schedule('30 20 * * *', async () => {
    console.log('⏰ Executing NIGHT Scheduled Job Crawl (08:30 PM)...');
    await runScheduledCrawl('Night (08:30 PM)');
  }, { scheduled: true, timezone: 'Asia/Kolkata' });
  scheduledTasks.push(nightCron);

  console.log('✅ Automated Schedulers Active: 09:00 AM | 02:00 PM | 08:30 PM IST');
}

/**
 * Executes a crawl and records stats in scheduler config
 */
async function runScheduledCrawl(slotName = 'Manual') {
  if (isScanRunning) {
    // If it's been running for more than 60 seconds, treat as timed out and auto-recover
    if (Date.now() - scanStartedAt > 60000) {
      console.warn('Previous scan took longer than 60s, auto-resetting isScanRunning flag.');
      isScanRunning = false;
    } else {
      console.log('Scan is already in progress, skipping duplicate execution.');
      return { status: 'already_running', message: 'A scan is currently running in background' };
    }
  }

  isScanRunning = true;
  scanStartedAt = Date.now();
  try {
    const result = await crawlAllCompanies();

    // Update all user scheduler configs
    await JobSchedulerConfig.updateMany({}, {
      $set: {
        lastRunAt: new Date(),
        lastRunStatus: `Completed ${slotName}`,
        lastRunJobsFound: result.totalDiscovered
      },
      $push: {
        scanHistory: {
          $each: [{
            runAt: new Date(),
            jobsFound: result.totalDiscovered,
            newJobsAdded: result.newJobsAdded,
            status: 'Completed',
            slot: slotName
          }],
          $slice: -20 // keep last 20 runs
        }
      }
    });

    return { success: true, ...result, slot: slotName };
  } catch (err) {
    console.error(`Error during ${slotName} crawl:`, err);
    return { success: false, error: err.message, slot: slotName };
  } finally {
    isScanRunning = false;
  }
}

/**
 * Gets current scheduler status and next run times
 */
function getSchedulerStatus() {
  const now = new Date();
  
  return {
    isActive: true,
    isCurrentlyScanning: isScanRunning,
    slots: [
      { name: 'Morning Scan', time: '09:00 AM IST', cron: '0 9 * * *' },
      { name: 'Afternoon Scan', time: '02:00 PM IST', cron: '0 14 * * *' },
      { name: 'Night Scan', time: '08:30 PM IST', cron: '30 20 * * *' }
    ],
    timezone: 'Asia/Kolkata',
    currentTime: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
}

module.exports = {
  initJobScheduler,
  runScheduledCrawl,
  getSchedulerStatus
};
