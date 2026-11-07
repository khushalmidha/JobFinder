const { contactBlockReason } = require('./outreachResearchService');
function assertApprovedMessage(contact, subject, body, approvals) {
  const blocked = contactBlockReason(contact);
  if (blocked) throw new Error(blocked);
  if (!subject?.trim() || /[\r\n]/.test(subject) || !body?.trim()) throw new Error('Valid subject and body required');
  const approval = Array.isArray(approvals) && approvals.find(a => a.contactId === String(contact._id));
  if (!approval || approval.recipient !== contact.email || approval.subject !== subject || approval.body !== body) throw new Error('Approve the exact recipient, subject and body before sending');
}
module.exports = { assertApprovedMessage };
