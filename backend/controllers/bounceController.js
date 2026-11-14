const { simpleParser } = require('mailparser');
const { createMailbox } = require('../services/secureMailboxService');
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');
const { parseDeliveryStatus } = require('../services/deliveryStatusParser');

exports.scanBounces = async (req, res) => {
  let client, lock;
  try {
    const user = await User.findById(req.user._id);
    if (!user?.smtpConfig?.user || !user.smtpConfig.pass) return res.status(400).json({ error: 'Saved mailbox configuration required.' });
    client = await createMailbox(user.smtpConfig);
    await client.connect(); lock = await client.getMailboxLock('INBOX');
    const results = await client.search({ since: new Date(Date.now() - 7 * 86400000), or: [{ header: ['subject', 'Delivery Status Notification'] }, { header: ['subject', 'Undeliverable'] }] });
    const candidates = [];
    if (results.length) for await (const item of client.fetch(results.slice(-20), { source: true })) {
      if (!item.source || item.source.length > 2 * 1024 * 1024) continue;
      const mail = await simpleParser(item.source, { keepDeliveryStatus: true });
      for (const attachment of mail.attachments || []) {
        if (attachment.contentType !== 'message/delivery-status') continue;
        for (const evidence of parseDeliveryStatus(attachment.content.toString('utf8'))) {
          if (!evidence.messageId) continue;
          const logs = await MailLog.find({ userId: req.user._id, providerMessageId: evidence.messageId }).select('recipientEmail').limit(2).lean();
          if (logs.length !== 1 || logs[0].recipientEmail.toLowerCase() !== evidence.recipientEmail) continue;
          candidates.push({ ...evidence, reviewRequired: true, mailboxVerified: false });
        }
      }
    }
    res.json({ message: 'Read-only DSN review. Inbox messages cannot authenticate permanent recipient failure by themselves.', candidates, bouncedCount: 0, emails: [], truncated: results.length > 20 });
  } catch (_) { res.status(502).json({ error: 'Mailbox scan failed. Check supported mailbox settings and TLS connectivity.' }); }
  finally { if (lock) lock.release(); if (client) await client.logout().catch(() => client.close()); }
};
exports.deleteBounced = async (req, res) => {
  try {
    // Legacy bounce labels can be untrusted. Quarantine without asserting that
    // a mailbox is invalid, and retain stronger existing suppression reasons.
    const result = await Contact.updateMany({ userId: req.user._id, status: 'bounced', suppressedAt: null }, { $set: { suppressedAt: new Date(), suppressionReason: 'Legacy bounce quarantine; mailbox existence inconclusive' } });
    res.json({ message: 'Bounced contacts quarantined; history preserved.', suppressedCount: result.modifiedCount, deletedCount: 0 });
  } catch (_) { res.status(500).json({ error: 'Bounce quarantine failed' }); }
};
