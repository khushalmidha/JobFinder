const crypto = require('node:crypto');
const User = require('../models/User');
const Audit = require('../models/AdminRoleMigration');

function proofHash(proof) {
  return crypto.createHash('sha256').update(JSON.stringify({
    method: proof?.method, issuer: proof?.issuer, subject: proof?.subject,
    verifiedAt: proof?.verifiedAt ? new Date(proof.verifiedAt).toISOString() : null
  })).digest('hex');
}
function verificationProblem(user, now) {
  if (user.emailVerified !== true) return 'Stored email verification is missing';
  const date = new Date(user.emailVerifiedAt);
  if (!user.emailVerifiedAt || !Number.isFinite(date.getTime()) || date > now) return 'Stored verification date must be valid and not in the future';
  const proof = user.emailVerificationProof;
  if (!proof || !['method', 'issuer', 'subject'].every(key => typeof proof[key] === 'string' && proof[key].trim() && proof[key].length <= 500)) return 'Stored verification evidence is missing or incomplete';
  if (proof.subject !== user.email) return 'Verification evidence subject does not match the account email';
  const evidenceDate = new Date(proof.verifiedAt);
  if (!proof.verifiedAt || !Number.isFinite(evidenceDate.getTime()) || evidenceDate > now || evidenceDate.getTime() !== date.getTime()) return 'Verification evidence timestamp does not match the stored verification';
  return null;
}
function snapshot(user) {
  return { userId: user._id, email: user.email, role: user.role, emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt, verificationProofHash: proofHash(user.emailVerificationProof) };
}
function validateArguments(email, migrationId, now) {
  if (typeof email !== 'string' || email !== email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('An exact existing account email is required');
  if (typeof migrationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,119}$/.test(migrationId)) throw new Error('Use a unique migration ID of 8–120 safe characters');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Valid migration time required');
}

async function promoteVerifiedAdmin({ email, migrationId, apply = false, now = new Date(), actor = 'local_cli_operator' }) {
  validateArguments(email, migrationId, now);
  const user = await User.findOne({ email }).lean();
  if (!user) throw new Error('Existing account not found; migration never creates an account');
  const existing = await Audit.findById(migrationId).lean();
  if (existing && (String(existing.userId) !== String(user._id) || existing.email !== email)) throw new Error('Migration ID already belongs to a different account');
  const problem = verificationProblem(user, now);
  if (problem) return { mode: apply ? 'apply' : 'preview', eligible: false, applied: false, migrationId, reason: problem };
  if (existing?.status === 'applied') {
    if (user.role !== 'admin' || user.adminRoleMigrationId !== migrationId) throw new Error('Applied audit conflicts with current account state; inspect manually');
    return { mode: apply ? 'apply' : 'preview', eligible: true, applied: true, idempotent: true, migrationId, auditStatus: 'applied' };
  }
  if (existing?.status === 'failed') throw new Error('This migration previously failed; inspect its audit before using a new migration ID');
  if (user.role !== 'user' && !(existing?.status === 'pending' && user.role === 'admin' && user.adminRoleMigrationId === migrationId)) throw new Error('Only an existing user account can be promoted by this migration');
  if (user.adminRoleMigrationId && user.adminRoleMigrationId !== migrationId) throw new Error('Account is attributed to another role migration');
  if (!apply) return { mode: 'preview', eligible: true, applied: false, migrationId, auditStatus: existing?.status || 'not_created', before: snapshot(user), proposedRole: 'admin', needsPendingRecovery: existing?.status === 'pending' };

  const leaseOwner = crypto.randomUUID();
  const leaseUntil = new Date(now.getTime() + 60000);
  let audit;
  if (existing) {
    audit = await Audit.findOneAndUpdate({ _id: migrationId, status: 'pending', leaseUntil: { $lte: now } },
      { $set: { leaseOwner, leaseUntil } }, { returnDocument: 'after' }).lean();
    if (!audit) throw new Error('Migration is in progress; retry after its one-minute recovery lease expires');
  } else {
    try {
      audit = (await Audit.create({ _id: migrationId, userId: user._id, email, actor: String(actor).slice(0,200), status: 'pending', before: snapshot(user), leaseOwner, leaseUntil })).toObject();
    } catch (error) {
      if (error.code === 11000) throw new Error('Migration was concurrently claimed; retry after inspecting its audit');
      throw error;
    }
  }
  try {
    // Re-read after claiming the audit, including recovery after a process crash.
    const current = await User.findById(user._id).lean();
    if (!current || current.email !== email) throw new Error('Account identity changed after preview');
    const currentProblem = verificationProblem(current, now);
    if (currentProblem) throw new Error(currentProblem);
    if (current.role === 'admin' && current.adminRoleMigrationId === migrationId) {
      await Audit.updateOne({ _id: migrationId, status: 'pending', leaseOwner }, { $set: { status: 'applied', after: snapshot(current), finishedAt: now, recovered: true }, $unset: { leaseOwner: '', leaseUntil: '' } });
      return { mode: 'apply', eligible: true, applied: true, recovered: true, migrationId, auditStatus: 'applied' };
    }
    if (current.role !== 'user' || current.adminRoleMigrationId || proofHash(current.emailVerificationProof) !== audit.before.verificationProofHash || new Date(current.emailVerifiedAt).getTime() !== new Date(audit.before.emailVerifiedAt).getTime()) throw new Error('Account or verification evidence changed since the audit was created');
    const proof = current.emailVerificationProof;
    const updated = await User.findOneAndUpdate({ _id: current._id, email, role: 'user', emailVerified: true,
      emailVerifiedAt: current.emailVerifiedAt, 'emailVerificationProof.method': proof.method,
      'emailVerificationProof.issuer': proof.issuer, 'emailVerificationProof.subject': proof.subject,
      'emailVerificationProof.verifiedAt': proof.verifiedAt, adminRoleMigrationId: { $exists: false } },
    { $set: { role: 'admin', adminRoleMigrationId: migrationId } }, { returnDocument: 'after', runValidators: true }).lean();
    if (!updated) throw new Error('Account changed concurrently; no promotion applied by this attempt');
    const recorded = await Audit.updateOne({ _id: migrationId, status: 'pending', leaseOwner }, { $set: { status: 'applied', after: snapshot(updated), finishedAt: now }, $unset: { leaseOwner: '', leaseUntil: '' } });
    if (recorded.modifiedCount !== 1) throw new Error('Promotion applied but audit finalization needs recovery; inspect the pending audit');
    return { mode: 'apply', eligible: true, applied: true, migrationId, auditStatus: 'applied' };
  } catch (error) {
    // Never mark a promoted account failed: leave its pending record recoverable.
    const current = await User.findById(user._id).lean();
    if (!(current?.role === 'admin' && current.adminRoleMigrationId === migrationId)) {
      await Audit.updateOne({ _id: migrationId, status: 'pending', leaseOwner }, { $set: { status: 'failed', error: error.message, finishedAt: now }, $unset: { leaseOwner: '', leaseUntil: '' } });
    }
    throw error;
  }
}

module.exports = { promoteVerifiedAdmin, verificationProblem, proofHash, snapshot };
