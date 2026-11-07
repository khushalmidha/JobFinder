const mongoose = require('mongoose');
const Contact = require('../models/Contact');
const Reminder = require('../models/OutreachReminder');
const Company = require('../models/Company');
const Job = require('../models/JobOpening');
const Lead = require('../models/PublicRecruitmentLead');
const User = require('../models/User');
const Suppression = require('../models/RecipientSuppression');
const { contactBlockReason } = require('./outreachResearchService');
const { qualifyCompany } = require('./salaryEvidenceService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const id = value => { if (!mongoose.isValidObjectId(value)) throw fail('Invalid record ID'); return value; };
async function ownedContact(userId, contactId) {
  const contact = await Contact.findOne({ _id: id(contactId), userId }).lean();
  if (!contact) throw fail('Owned contact not found', 404);
  return contact;
}
async function blockedReason(userId, contact) {
  if (!contact) return 'Contact no longer available';
  if (await Suppression.exists({ userId, email: contact.email.trim().toLowerCase() })) return 'Recipient has a persistent suppression record';
  const [duplicates, user] = await Promise.all([
    Contact.find({ userId, email: { $regex: '^' + escape(contact.email.trim()) + '$', $options: 'i' } }).lean(),
    User.findById(userId).select('blockedCompanies').lean()
  ]);
  if ((user?.blockedCompanies || []).some(name => name.toLowerCase() === contact.company.toLowerCase())) return 'Company is on your do-not-contact list';
  const duplicate = duplicates.find(c => c.optOutAt || c.suppressedAt || c.deliverabilityStatus === 'invalid' || ['bounced', 'removed', 'replied', 'reply_received', 'positive_response', 'negative_response'].includes(c.status));
  return duplicate ? 'Recipient suppressed or already replied' : contactBlockReason(contact);
}
async function createReminder(userId, input, now = new Date()) {
  const contact = await ownedContact(userId, input.contactId);
  const reason = await blockedReason(userId, contact); if (reason) throw fail(reason, 409);
  const dueAt = new Date(input.dueAt);
  if (typeof input.dueAt !== 'string' || !/Z$/.test(input.dueAt) || !Number.isFinite(+dueAt) || dueAt <= now || dueAt - now > 366 * 86400000) throw fail('Choose a future date within one year, converted to UTC');
  for (const [key, max] of [['subject', 300], ['body', 20000]]) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) throw fail('Subject and body must be nonempty and within limits');
  if (/[\r\n]/.test(input.subject)) throw fail('Subject must be one line');
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > 2000)) throw fail('Note too long');
  const reminder = await Reminder.create({ userId, contactId: contact._id, dueAt, subject: input.subject.trim(), body: input.body.trim(), note: input.note || '' });
  // A concurrent reply/opt-out is authoritative even if it raced the insert.
  if (await blockedReason(userId, await ownedContact(userId, contact._id))) await Reminder.updateOne({ _id: reminder._id }, { $set: { status: 'cancelled', closedAt: new Date(), closeReason: 'Recipient blocked during reminder creation' }, $inc: { revision: 1 } });
  return Reminder.findById(reminder._id).lean();
}
async function closeReminder(userId, reminderId, input) {
  if (!['completed', 'cancelled'].includes(input.status) || !Number.isInteger(input.revision)) throw fail('Status and current revision required');
  const row = await Reminder.findOneAndUpdate({ _id: id(reminderId), userId, status: 'open', revision: input.revision }, { $set: { status: input.status, closedAt: new Date(), closeReason: 'User action' }, $inc: { revision: 1 } }, { returnDocument: 'after' }).lean();
  if (!row) throw fail('Reminder changed or not owned; refresh before retrying', 409);
  return row;
}
async function draft(userId, reminderId) {
  const reminder = await Reminder.findOne({ _id: id(reminderId), userId, status: 'open' }).lean();
  if (!reminder) throw fail('Open reminder not found', 404);
  const contact = await ownedContact(userId, reminder.contactId);
  const reason = await blockedReason(userId, contact); if (reason) throw fail(reason, 409);
  return { subject: reminder.subject, body: reminder.body, contactId: contact._id, recipientEmail: contact.email, needsReview: true, sent: false, campaignApprovalRequired: true };
}
async function recordReplyOrOptOut(userId, contactId, input, optOut = false) {
  const contact = await ownedContact(userId, contactId);
  if (!optOut && (typeof input.snippet !== 'string' || !input.snippet.trim() || input.snippet.length > 2000)) throw fail('Record a reply snippet up to 2000 characters');
  if (optOut && input.confirmed !== true) throw fail('Confirm recipient opt-out');
  if (optOut) await Suppression.updateOne({ userId, email: contact.email.trim().toLowerCase() }, { $setOnInsert: { userId, email: contact.email.trim().toLowerCase(), reason: 'Recipient opt-out recorded by owner', source: 'owner_opt_out' } }, { upsert: true });
  const siblings = await Contact.find({ userId, email: { $regex: '^' + escape(contact.email.trim()) + '$', $options: 'i' } }).select('_id').lean();
  const ids = siblings.map(c => c._id); const now = new Date();
  // Never clear existing invalid/suppression evidence when recording a reply.
  await Contact.updateMany({ userId, _id: { $in: ids } }, { $set: optOut ? { optOutAt: now } : { repliedAt: now, replySnippet: input.snippet.trim(), status: 'reply_received' } });
  if (optOut) await Contact.updateMany({ userId, _id: { $in: ids }, suppressedAt: null }, { $set: { suppressedAt: now, suppressionReason: 'Recipient opt-out recorded by owner' } });
  await Reminder.updateMany({ userId, contactId: { $in: ids }, status: 'open' }, { $set: { status: 'cancelled', closedAt: now, closeReason: optOut ? 'Recipient opted out' : 'Reply recorded' }, $inc: { revision: 1 } });
  return { updated: ids.length, sending: false };
}
async function overview(userId) {
  const [rows, owned, publicLeads] = await Promise.all([
    Promise.all([Reminder.find({ userId, status: 'open' }).sort({ dueAt: 1 }).limit(201).lean(), Reminder.find({ userId, status: { $ne: 'open' } }).sort({ updatedAt: -1 }).limit(50).lean()]),
    Contact.find({ userId }).select('companyId company email hrName status verificationStatus provenance inferenceFlag suppressedAt optOutAt deliverabilityStatus vendorStatus').sort({ updatedAt: -1 }).limit(1001).lean(),
    Lead.find({ listingStatus: 'official_publicly_listed' }).select('companyId companyName email listingStatus evidenceUrl').limit(301).lean()
  ]);
  const companyIds = [...new Set([...owned, ...publicLeads].filter(c => c.companyId).map(c => String(c.companyId)))];
  const companies = companyIds.length ? await Company.find({ _id: { $in: companyIds } }).sort({ name: 1 }).limit(101).lean() : [];
  const graphCompanies = companies.slice(0, 100);
  const jobs = await Job.find({ companyId: { $in: graphCompanies.map(c => c._id) }, status: { $nin: ['ignored', 'applied', 'auto_applied'] } }).select('companyId title url isFresherEligible').sort({ detectedAt: -1 }).limit(501).lean();
  const reminders = await Promise.all([...rows[0].slice(0, 200), ...rows[1]].map(async row => {
    const contact = await Contact.findOne({ _id: row.contactId, userId }).lean();
    return { ...row, contact: contact ? { _id: contact._id, company: contact.company, email: contact.email, hrName: contact.hrName, status: contact.status } : null, blockedReason: await blockedReason(userId, contact) };
  }));
  return { reminders, graph: graphCompanies.map(company => {
    const contacts = owned.slice(0, 1000).filter(c => String(c.companyId) === String(company._id));
    const linkedJobs = jobs.filter(j => String(j.companyId) === String(company._id));
    const qualificationStatus = qualifyCompany(company).qualificationStatus;
    return { company: { _id: company._id, name: company.name, qualificationStatus }, contacts: contacts.map(c => ({ _id: c._id, email: c.email, hrName: c.hrName, status: c.status, verificationStatus: c.verificationStatus, blockedReason: contactBlockReason(c) })), jobs: linkedJobs, publicLeads: publicLeads.filter(l => String(l.companyId) === String(company._id)), score: (qualificationStatus === 'qualified' ? 40 : 0) + (linkedJobs.some(j => j.isFresherEligible) ? 25 : 0) + (contacts.some(c => !contactBlockReason(c)) ? 20 : 0) };
  }), unlinkedContactCount: await Contact.countDocuments({ userId, companyId: null }), truncated: rows[0].length > 200 || rows[1].length === 50 || owned.length > 1000 || companies.length > 100 || publicLeads.length > 300 || jobs.length > 500 };
}
module.exports = { createReminder, closeReminder, draft, recordReplyOrOptOut, overview, blockedReason, escape };
