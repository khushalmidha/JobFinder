const Policy = require('../models/ResearchPolicy');
const Usage = require('../models/ResearchUsage');
async function policyFor(userId) {
  return await Policy.findOne({ userId }).lean() || { stopped: false, paidProvidersEnabled: false, monthlyCredits: 0, dailyRequests: 25, maxRuntimeSeconds: 30 };
}
function validatePolicy(body) {
  const out = {};
  for (const key of ['stopped', 'paidProvidersEnabled']) if (key in body) {
    if (typeof body[key] !== 'boolean') throw new Error(`${key} must be boolean`);
    out[key] = body[key];
  }
  for (const [key, min, max] of [['monthlyCredits',0,1000], ['dailyRequests',0,500], ['maxRuntimeSeconds',5,120]]) if (key in body) {
    if (!Number.isInteger(body[key]) || body[key] < min || body[key] > max) throw new Error(`Invalid ${key}`);
    out[key] = body[key];
  }
  return out;
}
async function reserve(userId, key, amount, limit) {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(limit) || limit < amount) throw new Error('Research budget exhausted or not approved');
  try { await Usage.updateOne({ userId, key }, { $setOnInsert: { reserved: 0 } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const result = await Usage.findOneAndUpdate({ userId, key, reserved: { $lte: limit - amount } }, { $inc: { reserved: amount } }, { returnDocument: 'after' });
  if (!result) throw new Error('Research budget exhausted');
  return result.reserved;
}
async function reserveResearch(userId, { requests = 1, credits = 0, now = new Date() } = {}) {
  const policy = await policyFor(userId);
  if (process.env.RESEARCH_STOP === 'true' || policy.stopped) throw new Error('Research is stopped');
  if (credits > 0 && (!policy.paidProvidersEnabled || policy.monthlyCredits <= 0)) throw new Error('Paid provider calls are disabled; explicit budget approval required');
  // Reserve worst-case before network access; no refund on errors or timeouts.
  // Failed secondary reservations can overcount, never overspend.
  await reserve(userId, `requests:${now.toISOString().slice(0,10)}`, requests, policy.dailyRequests);
  if (credits) await reserve(userId, `credits:${now.toISOString().slice(0,7)}`, credits, policy.monthlyCredits);
  return policy;
}
module.exports = { policyFor, validatePolicy, reserveResearch, reserve };
