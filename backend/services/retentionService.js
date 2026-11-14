const crypto = require('node:crypto');
const mongoose = require('mongoose');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const Runtime = require('../models/OutreachRuntime');

const normalizeEmail = val => String(val || '').trim().toLowerCase();

function calculateRetentionCutoff(now = new Date(), hours = 48) {
  const parsed = new Date(now);
  if (isNaN(parsed.getTime())) throw new Error('Invalid timestamp for retention cutoff');
  if (!Number.isInteger(hours) || hours <= 0 || hours > 87600) {
    throw new Error('retentionHours must be a positive integer between 1 and 87600');
  }
  return new Date(parsed.getTime() - hours * 60 * 60 * 1000);
}

function validateRetentionOptions({ retentionHours = 48, batchSize = 200, maxBatches = 50, userId, allowGlobal, dryRun } = {}) {
  if (!Number.isInteger(retentionHours) || retentionHours <= 0 || retentionHours > 87600) {
    throw new Error('retentionHours must be a positive integer between 1 and 87600');
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 1000) {
    throw new Error('batchSize must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(maxBatches) || maxBatches <= 0 || maxBatches > 1000) {
    throw new Error('maxBatches must be an integer between 1 and 1000');
  }
  if (userId && !mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId scope provided');
  }
  if (!userId && allowGlobal !== true && !dryRun) {
    throw new Error('Explicit userId scope or allowGlobal: true is required before executing destructive retention cleanup');
  }
}

async function ensureRuntime() {
  try {
    await Runtime.updateOne(
      { _id: 'retention_worker' },
      { $setOnInsert: { leaseUntil: new Date(0), leaseToken: '' } },
      { upsert: true }
    );
  } catch (e) {
    if (e.code !== 11000) throw e;
  }
}

/**
 * Monotonically archive eligible MailLog records older than rolling cutoff (UTC)
 * into a compact DeliveryLedger, validating canonical evidence before atomic CAS deletion.
 */
async function pruneOldMailLogs({
  now = new Date(),
  retentionHours = 48,
  batchSize = 200,
  maxBatches = 50,
  userId,
  allowGlobal = false,
  dryRun = false,
  skipLock = false
} = {}) {
  validateRetentionOptions({ retentionHours, batchSize, maxBatches, userId, allowGlobal, dryRun });

  const parsedNow = new Date(now);
  if (isNaN(parsedNow.getTime())) throw new Error('Invalid timestamp for retention execution');
  const cutoff = calculateRetentionCutoff(parsedNow, retentionHours);

  const eligibleQuery = {
    sentAt: { $lt: cutoff },
    ...(userId ? { userId } : {})
  };

  if (dryRun) {
    const eligibleCount = await MailLog.countDocuments(eligibleQuery);
    return {
      dryRun: true,
      cutoff,
      retentionHours,
      eligible: eligibleCount,
      archived: 0,
      deleted: 0,
      batches: 0,
      scope: userId ? `user:${userId}` : 'global'
    };
  }

  // Acquire distributed lock to prevent overlapping runs across multiple backend instances
  let lockToken = null;
  const LEASE_MS = 120000;
  if (!skipLock) {
    await ensureRuntime();
    lockToken = crypto.randomUUID();
    const lock = await Runtime.findOneAndUpdate(
      { _id: 'retention_worker', leaseUntil: { $lte: parsedNow } },
      { $set: { leaseToken: lockToken, leaseUntil: new Date(+parsedNow + LEASE_MS), lastRunAt: parsedNow } },
      { returnDocument: 'after' }
    );
    if (!lock || lock.leaseToken !== lockToken) {
      return {
        status: 'locked',
        message: 'Another retention job is actively running or holding the worker lease',
        cutoff,
        retentionHours
      };
    }
  }

  let totalEligible = 0;
  let totalArchived = 0;
  let totalDeleted = 0;
  let batchesRun = 0;

  try {
    for (let b = 0; b < maxBatches; b++) {
      const batch = await MailLog.find(eligibleQuery)
        .sort({ sentAt: 1 })
        .limit(batchSize)
        .lean();

      if (!batch.length) break;
      batchesRun++;
      totalEligible += batch.length;

      // 1. Prepare idempotent monotonic upserts into DeliveryLedger
      const ops = [];
      for (const log of batch) {
        const recEmail = normalizeEmail(log.recipientEmail);
        const sendEmail = normalizeEmail(log.senderEmail);
        const provId = String(log.providerMessageId || '').trim();
        const hash = log.messageHash || '';

        // Base upsert with immutable identifiers and canonical metadata
        ops.push({
          updateOne: {
            filter: { originalMailLogId: log._id },
            update: {
              $setOnInsert: {
                originalMailLogId: log._id,
                contactId: log.contactId,
                senderEmail: sendEmail,
                campaignId: log.campaignId,
                dispatchId: log.dispatchId,
                archivedAt: parsedNow
              },
              $set: {
                userId: log.userId,
                recipientEmail: recEmail,
                sentAt: log.sentAt,
                providerMessageId: provId,
                messageHash: hash
              }
            },
            upsert: true
          }
        });

        // Monotonic status promotion: ensure ledger does NOT keep a stale 'failed' outcome
        // if the source MailLog indicates the outreach was sent/delivered/bounced.
        if (log.status === 'sent') {
          ops.push({
            updateOne: {
              filter: { originalMailLogId: log._id, status: { $in: ['failed', null] } },
              update: { $set: { status: 'sent' } }
            }
          });
        } else if (log.status === 'delivered') {
          ops.push({
            updateOne: {
              filter: { originalMailLogId: log._id, status: { $in: ['failed', 'sent', null] } },
              update: { $set: { status: 'delivered' } }
            }
          });
        } else if (log.status === 'bounced') {
          ops.push({
            updateOne: {
              filter: { originalMailLogId: log._id },
              update: { $set: { status: 'bounced', bounceReason: log.bounceReason || '' } }
            }
          });
        } else if (log.status === 'failed') {
          ops.push({
            updateOne: {
              filter: { originalMailLogId: log._id, status: { $exists: false } },
              update: { $set: { status: 'failed', bounceReason: log.bounceReason || '' } }
            }
          });
        }
      }

      await DeliveryLedger.bulkWrite(ops, { ordered: false });

      // 2. Strict evidence validation: fetch persisted records and fail closed if any canonical
      // field (owner, recipient, sentAt, monotonic status, providerId, messageHash) mismatches.
      const batchIds = batch.map(l => l._id);
      const persisted = await DeliveryLedger.find({ originalMailLogId: { $in: batchIds } }).lean();
      const persistedMap = new Map(persisted.map(p => [String(p.originalMailLogId), p]));

      const verifiedLogs = [];
      for (const log of batch) {
        const ledger = persistedMap.get(String(log._id));
        if (!ledger) continue;

        // Verify owner match
        if (String(ledger.userId) !== String(log.userId)) continue;
        // Verify recipient match
        if (ledger.recipientEmail !== normalizeEmail(log.recipientEmail)) continue;
        // Verify sentAt exact match
        if (new Date(ledger.sentAt).getTime() !== new Date(log.sentAt).getTime()) continue;
        // Verify provider message ID match
        if (String(ledger.providerMessageId || '').trim() !== String(log.providerMessageId || '').trim()) continue;
        // Verify message hash match
        if (String(ledger.messageHash || '') !== String(log.messageHash || '')) continue;

        // Monotonic outcome validation:
        // A 'sent' or 'delivered' or 'bounced' log cannot be verified by a 'failed' ledger.
        if (['sent', 'delivered', 'bounced'].includes(log.status) && ledger.status === 'failed') {
          continue; // Fail closed: do not permit deletion
        }
        if (['delivered', 'bounced'].includes(log.status) && ledger.status === 'sent') {
          continue; // Fail closed: source is delivered/bounced but ledger is only sent
        }
        if (log.status === 'bounced' && ledger.status !== 'bounced') {
          continue; // Fail closed: source is bounced but ledger is not
        }

        verifiedLogs.push(log);
      }

      totalArchived += verifiedLogs.length;

      // 3. Atomic Compare-And-Delete (CAS Deletion):
      // Only delete if the document in MongoDB still matches the EXACT archived version
      // and sentAt is STILL strictly less than cutoff. A concurrent update to sentAt=now
      // or status change will cause the delete filter to match 0 documents, preventing data loss.
      if (verifiedLogs.length > 0) {
        const deleteOps = verifiedLogs.map(log => ({
          deleteOne: {
            filter: {
              _id: log._id,
              userId: log.userId,
              status: log.status,
              recipientEmail: log.recipientEmail,
              sentAt: { $eq: log.sentAt, $lt: cutoff }
            }
          }
        }));

        const deleteResult = await MailLog.bulkWrite(deleteOps, { ordered: false });
        totalDeleted += (deleteResult.deletedCount || 0);
      }

      if (batch.length < batchSize) break;
    }
  } finally {
    if (lockToken) {
      await Runtime.updateOne(
        { _id: 'retention_worker', leaseToken: lockToken },
        { $set: { leaseUntil: new Date(0) }, $unset: { leaseToken: 1 } }
      ).catch(() => {});
    }
  }

  return {
    dryRun: false,
    cutoff,
    retentionHours,
    eligible: totalEligible,
    archived: totalArchived,
    deleted: totalDeleted,
    batches: batchesRun,
    scope: userId ? `user:${userId}` : 'global'
  };
}

let schedulerTask = null;

function initRetentionScheduler() {
  // Blocker 3 fix: Explicit 'true' required. Never enable silently on deploy.
  if (process.env.MAIL_RETENTION_ENABLED !== 'true') return null;

  try {
    const cron = require('node-cron');
    schedulerTask = cron.schedule('0 * * * *', async () => {
      try {
        await pruneOldMailLogs({
          now: new Date(),
          retentionHours: 48,
          allowGlobal: true
        });
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
  initRetentionScheduler,
  validateRetentionOptions
};
