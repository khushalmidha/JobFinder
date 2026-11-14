const crypto = require('node:crypto');
const mongoose = require('mongoose');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const Runtime = require('../models/OutreachRuntime');

const normalizeEmail = val => String(val || '').trim().toLowerCase();
const canonicalFields = ['userId','contactId','recipientEmail','senderEmail','providerMessageId','messageHash','status','bounceReason','sentAt','campaignId','dispatchId','subject','body','updatedAt','__v'];
function sourceVersion(log) {
  return Object.fromEntries(['_id', ...canonicalFields].map(key => [key, log[key] === undefined ? { $exists: false } : { $eq: log[key] }]));
}
const sameId = (a,b) => String(a || '') === String(b || '');


const STATUS_RANKS = {
  failed: 0,
  sent: 1,
  delivered: 2,
  bounced: 3
};

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

const LEASE_MS = 120000;

async function assertLeaseOwnership(token) {
  if (!token) return true; // skipLock mode
  const now = new Date();
  const renewed = await Runtime.findOneAndUpdate(
    { _id: 'retention_worker', leaseToken: token, leaseUntil: { $gt: now } },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: 'after' }
  );
  if (!renewed || renewed.leaseToken !== token) {
    throw new Error('Retention worker lease expired or preempted by another worker');
  }
  return true;
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
  skipLock = false,
  beforeDeleteHook = null
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

  // Acquire distributed lease to prevent overlapping runs across instances
  let lockToken = null;
  if (!skipLock) {
    await ensureRuntime();
    lockToken = crypto.randomUUID();
    const leaseNow = new Date();
    const lock = await Runtime.findOneAndUpdate(
      { _id: 'retention_worker', leaseUntil: { $lte: leaseNow } },
      { $set: { leaseToken: lockToken, leaseUntil: new Date(+leaseNow + LEASE_MS), lastRunAt: parsedNow } },
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
      // Lease renewal fence before fetching batch
      await assertLeaseOwnership(lockToken);

      const batch = await MailLog.find(eligibleQuery)
        .sort({ sentAt: 1 })
        .limit(batchSize)
        .lean();

      if (!batch.length) break;
      batchesRun++;
      totalEligible += batch.length;

      const batchIds = batch.map(l => l._id);
      const existingLedgers = await DeliveryLedger.find({ originalMailLogId: { $in: batchIds } }).lean();
      const existingMap = new Map(existingLedgers.map(l => [String(l.originalMailLogId), l]));

      // 1. Prepare exactly ONE atomic upsert operation per document in ops (zero ordering assumptions)
      const ops = [];
      const skippedIds = new Set();

      for (const log of batch) {
        const recEmail = normalizeEmail(log.recipientEmail);
        const sendEmail = normalizeEmail(log.senderEmail);
        const provId = String(log.providerMessageId || '').trim();
        const hash = log.messageHash || '';
        const sourceStatus = log.status || 'sent';

        const existing = existingMap.get(String(log._id));
        if (existing) {
          // Check immutable canonical identity: do not silently overwrite a mismatched identity
          if (String(existing.userId) !== String(log.userId) ||
              existing.recipientEmail !== recEmail ||
              new Date(existing.sentAt).getTime() !== new Date(log.sentAt).getTime() ||
              (existing.contactId && !sameId(existing.contactId, log.contactId)) || (existing.campaignId && !sameId(existing.campaignId, log.campaignId)) || (existing.dispatchId && !sameId(existing.dispatchId, log.dispatchId)) ||
              (existing.senderEmail && normalizeEmail(existing.senderEmail) !== sendEmail) || (existing.providerMessageId && existing.providerMessageId.trim() !== provId) || (existing.messageHash && existing.messageHash !== hash)) {
            skippedIds.add(String(log._id));
            continue; // Fail closed: identity mismatch
          }

          // Monotonic status promotion: winning status is max(existing, source)
          const existingRank = STATUS_RANKS[existing.status] ?? -1;
          const sourceRank = STATUS_RANKS[sourceStatus] ?? 0;
          const winningStatus = sourceRank > existingRank ? sourceStatus : existing.status;
          const winningBounceReason = winningStatus === 'bounced' ? (log.bounceReason || existing.bounceReason || '') : '';

          ops.push({
            updateOne: {
              filter: Object.fromEntries(Object.entries(existing).map(([key,value]) => [key, { $eq: value }])),
              update: {
                $set: {
                  status: winningStatus,
                  bounceReason: winningBounceReason,
                  providerMessageId: provId,
                  messageHash: hash,
                  senderEmail: sendEmail,
                  contactId: log.contactId,
                  campaignId: log.campaignId,
                  dispatchId: log.dispatchId
                }
              }
            }
          });
        } else {
          // Fresh insertion: initialize the EXACT source outcome atomically
          // (failed remains failed, sent remains sent, delivered remains delivered, bounced remains bounced)
          ops.push({
            updateOne: {
              filter: { originalMailLogId: log._id },
              update: {
                $setOnInsert: {
                  originalMailLogId: log._id,
                  userId: log.userId,
                  contactId: log.contactId,
                  recipientEmail: recEmail,
                  senderEmail: sendEmail,
                  campaignId: log.campaignId,
                  dispatchId: log.dispatchId,
                  providerMessageId: provId,
                  status: sourceStatus,
                  bounceReason: log.bounceReason || '',
                  sentAt: log.sentAt,
                  messageHash: hash,
                  archivedAt: parsedNow
                }
              },
              upsert: true
            }
          });
        }
      }

      if (ops.length > 0) {
        await assertLeaseOwnership(lockToken);
        await DeliveryLedger.bulkWrite(ops, { ordered: false });
      }

      // 2. Strict canonical evidence validation: fetch persisted records and fail closed
      // if any canonical field (owner, recipient, sentAt, monotonic status, providerId, messageHash) mismatches.
      const persisted = await DeliveryLedger.find({ originalMailLogId: { $in: batchIds } }).lean();
      const persistedMap = new Map(persisted.map(p => [String(p.originalMailLogId), p]));

      const verifiedLogs = [];
      for (const log of batch) {
        if (skippedIds.has(String(log._id))) continue;
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
          continue; // Fail closed
        }
        if (log.status === 'bounced' && ledger.status !== 'bounced') {
          continue; // Fail closed
        }
        if (log.status === 'failed' && ledger.status !== 'failed') {
          // If source was failed and ledger was somehow not failed
          // (e.g. prior sent), verify monotonic progression
        }

        verifiedLogs.push(log);
      }

      totalArchived += verifiedLogs.length;

      // Optional hook for test barriers (e.g. injecting concurrent updates between archive and delete)
      if (typeof beforeDeleteHook === 'function') {
        await beforeDeleteHook(verifiedLogs);
      }

      // 3. Fencing check & Atomic Compare-And-Delete (CAS Deletion):
      // The delete filter covers ALL canonical evidence fields:
      // _id, userId, contactId, recipientEmail, senderEmail, providerMessageId, messageHash,
      // status, bounceReason, and sentAt strictly less than cutoff.
      // If ANY field was modified concurrently, the delete filter matches 0 documents.
      if (verifiedLogs.length > 0) {
        await assertLeaseOwnership(lockToken);

        const deleteOps = verifiedLogs.map(log => ({
          deleteOne: {
            filter: { ...sourceVersion(log), sentAt: { $eq: log.sentAt, $lt: cutoff } }
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
  // Explicit 'true' required. Never enable silently on deploy.
  if (process.env.MAIL_RETENTION_ENABLED !== 'true') return null;
  const owners = [...new Set(String(process.env.MAIL_RETENTION_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean))];
  const globalAllowed = process.env.MAIL_RETENTION_ALLOW_GLOBAL === 'true';
  if (owners.some(id => !mongoose.isValidObjectId(id)) || (!owners.length && !globalAllowed)) {
    console.error('Retention requires valid owner IDs or explicit global authorization');
    return null;
  }
  if (schedulerTask) return schedulerTask;

  try {
    const cron = require('node-cron');
    schedulerTask = cron.schedule('0 * * * *', async () => {
      try {
        const scopes = owners.length ? owners.map(userId => ({ userId })) : [{ allowGlobal: true }];
        for (const scope of scopes) await pruneOldMailLogs({ now: new Date(), retentionHours: 48, ...scope });
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
  validateRetentionOptions,
  assertLeaseOwnership
};
