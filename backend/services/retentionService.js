const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');

function calculateRetentionCutoff(now = new Date(), hours = 48) {
  const parsed = new Date(now);
  if (isNaN(parsed.getTime())) throw new Error('Invalid timestamp for retention cutoff');
  return new Date(parsed.getTime() - hours * 60 * 60 * 1000);
}

async function pruneOldMailLogs({
  now = new Date(),
  retentionHours = 48,
  batchSize = 200,
  maxBatches = 50,
  dryRun = false
} = {}) {
  const cutoff = calculateRetentionCutoff(now, retentionHours);
  const eligibleQuery = { sentAt: { $lt: cutoff } };

  if (dryRun) {
    const eligibleCount = await MailLog.countDocuments(eligibleQuery);
    return {
      dryRun: true,
      cutoff,
      retentionHours,
      eligible: eligibleCount,
      archived: 0,
      deleted: 0,
      batches: 0
    };
  }

  let totalEligible = 0;
  let totalArchived = 0;
  let totalDeleted = 0;
  let batchesRun = 0;

  for (let b = 0; b < maxBatches; b++) {
    const batch = await MailLog.find(eligibleQuery)
      .sort({ sentAt: 1 })
      .limit(batchSize)
      .lean();

    if (!batch.length) break;
    batchesRun++;
    totalEligible += batch.length;

    // 1. Prepare compact ledger records without subject/body text
    const ops = batch.map(log => ({
      updateOne: {
        filter: { originalMailLogId: log._id },
        update: {
          $setOnInsert: {
            userId: log.userId,
            contactId: log.contactId,
            recipientEmail: String(log.recipientEmail || '').trim().toLowerCase(),
            senderEmail: String(log.senderEmail || '').trim().toLowerCase(),
            campaignId: log.campaignId,
            dispatchId: log.dispatchId,
            providerMessageId: String(log.providerMessageId || '').trim(),
            status: log.status || 'sent',
            bounceReason: log.bounceReason || '',
            sentAt: log.sentAt,
            originalMailLogId: log._id,
            messageHash: log.messageHash || '',
            archivedAt: new Date(now)
          }
        },
        upsert: true
      }
    }));

    // 2. Perform idempotent bulk write to DeliveryLedger
    await DeliveryLedger.bulkWrite(ops, { ordered: false });

    // 3. Confirm persistence before deleting detailed MailLog rows
    const batchIds = batch.map(l => l._id);
    const persisted = await DeliveryLedger.find({ originalMailLogId: { $in: batchIds } })
      .select('originalMailLogId')
      .lean();
    const verifiedIds = persisted.map(p => p.originalMailLogId);
    totalArchived += verifiedIds.length;

    // 4. Safe partial-failure deletion: only remove verified rows
    if (verifiedIds.length > 0) {
      const deleteResult = await MailLog.deleteMany({ _id: { $in: verifiedIds } });
      totalDeleted += deleteResult.deletedCount;
    }

    // Stop if batch was smaller than the batchSize limit
    if (batch.length < batchSize) break;
  }

  return {
    dryRun: false,
    cutoff,
    retentionHours,
    eligible: totalEligible,
    archived: totalArchived,
    deleted: totalDeleted,
    batches: batchesRun
  };
}

let schedulerTask = null;

function initRetentionScheduler() {
  if (process.env.MAIL_RETENTION_ENABLED === 'false') return null;
  // Restart-safe background job running every hour in UTC
  // Browser closure has zero effect as this runs purely on the backend server
  try {
    const cron = require('node-cron');
    schedulerTask = cron.schedule('0 * * * *', async () => {
      try {
        await pruneOldMailLogs({ now: new Date(), retentionHours: 48 });
      } catch (err) {
        console.error('Mail log retention cleanup failed:', err);
      }
    }, { timezone: 'UTC' });
    return schedulerTask;
  } catch (err) {
    console.error('Failed to initialize retention cron scheduler:', err);
    return null;
  }
}

module.exports = {
  calculateRetentionCutoff,
  pruneOldMailLogs,
  initRetentionScheduler
};
