const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Receipt = require('../models/DeliveryEventReceipt');
const MailLog = require('../models/MailLog');
const Contact = require('../models/Contact');
const Suppression = require('../models/RecipientSuppression');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const exactEmail = email => ({ $regex: '^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' });
function authenticate(raw, headers, env = process.env, now = Date.now()) {
  const secret = env.MAIL_STATUS_WEBHOOK_SECRET;
  if (env.MAIL_STATUS_WEBHOOK_ENABLED !== 'true' || !secret || secret.length < 32 || !mongoose.isValidObjectId(env.MAIL_STATUS_WEBHOOK_OWNER_ID)) throw fail('Delivery webhook is disabled or unconfigured', 503);
  if (!Buffer.isBuffer(raw)) throw fail('Exact raw JSON payload required');
  const timestamp = headers['x-jobfinder-timestamp'];
  const signature = headers['x-jobfinder-signature'];
  if (!/^\d{10}$/.test(timestamp || '') || Math.abs(now - Number(timestamp) * 1000) > 300000 || !/^[a-f0-9]{64}$/i.test(signature || '')) throw fail('Invalid delivery signature', 401);
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw fail('Invalid delivery signature', 401);
  let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw fail('Invalid JSON'); }
  if (!event || !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.eventId || '') || typeof event.messageId !== 'string' || !event.messageId.trim() || event.messageId.length > 512 || typeof event.recipientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.recipientEmail)) throw fail('Event ID, exact message ID and recipient required');
  return { event, userId: env.MAIL_STATUS_WEBHOOK_OWNER_ID, digest: crypto.createHash('sha256').update(raw).digest('hex') };
}
async function applyEvent({ event, userId, digest }) {
  const email = event.recipientEmail.trim().toLowerCase();
  const candidates = await MailLog.find({ userId, providerMessageId: event.messageId, recipientEmail: exactEmail(email) }).limit(2).lean();
  if (candidates.length !== 1) throw fail('No unique owned sent-message match', 409);
  let receipt;
  try { receipt = await Receipt.create({ eventId: event.eventId, digest, userId, mailLogId: candidates[0]._id, recipientEmail: email, providerMessageId: event.messageId, eventType: String(event.eventType || '').slice(0, 100), enhancedStatus: String(event.enhancedStatus || '').slice(0, 30) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await Receipt.findOne({ eventId: event.eventId }).lean();
    if (previous?.digest !== digest) throw fail('Event identifier reused with a different payload', 409);
    if (previous.state !== 'completed') throw fail('Event processing incomplete; operator reconciliation required', 409);
    return { duplicate: true, outcome: previous.outcome };
  }
  // Only an authenticated provider adapter asserting the exact 5.1.1 recipient
  // failure can invalidate a mailbox. Policy, outage and quota failures cannot.
  let outcome = 'inconclusive_no_suppression';
  if (event.eventType === 'permanent_failure' && event.enhancedStatus === '5.1.1') {
    const reason = 'Authenticated provider recipient failure 5.1.1';
    await Suppression.updateOne({ userId, email }, { $setOnInsert: { userId, email, reason, source: 'authenticated_provider_5.1.1', evidenceEventId: event.eventId } }, { upsert: true });
    await Contact.updateMany({ userId, email: exactEmail(email) }, { $set: { deliverabilityStatus: 'invalid', verificationStatus: 'invalid' } });
    await Contact.updateMany({ userId, email: exactEmail(email), suppressedAt: null }, { $set: { suppressedAt: new Date(), suppressionReason: reason } });
    await MailLog.updateOne({ _id: candidates[0]._id, userId, status: { $ne: 'bounced' } }, { $set: { status: 'bounced', bounceReason: reason } });
    outcome = 'confirmed_recipient_failure';
  }
  await Receipt.updateOne({ _id: receipt._id }, { $set: { state: 'completed', outcome } });
  return { duplicate: false, outcome };
}
module.exports = { authenticate, applyEvent };
