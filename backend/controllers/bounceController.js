const { simpleParser } = require('mailparser');
const { createMailbox } = require('../services/secureMailboxService');
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const RecipientSuppression = require('../models/RecipientSuppression');
const { parseDeliveryStatus, isConfirmedAddressNotFound } = require('../services/deliveryStatusParser');
const { normalizeEmail, validEmail } = require('../services/campaignService');

exports.scanBounces = async (req, res) => {
  let client, lock;
  try {
    const user = await User.findById(req.user._id);
    if (!user?.smtpConfig?.user || !user.smtpConfig.pass) {
      return res.status(400).json({ error: 'Saved mailbox configuration required.' });
    }
    client = await createMailbox(user.smtpConfig);
    await client.connect();
    lock = await client.getMailboxLock('INBOX');

    // Comprehensive search for bounce / delivery status failure notifications
    const sinceDate = new Date(Date.now() - 14 * 86400000);
    let results = [];
    try {
      results = await client.search({
        since: sinceDate,
        or: [
          { from: 'mailer-daemon' },
          { header: ['subject', 'Delivery Status Notification'] },
          { header: ['subject', 'Undeliverable'] },
          { header: ['subject', 'Mail delivery failed'] },
          { header: ['subject', 'failure notice'] }
        ]
      });
    } catch (_) {
      // Fallback search if complex query is not supported by IMAP server
      results = await client.search({ since: sinceDate, header: ['subject', 'Delivery Status Notification'] });
    }

    const confirmedInvalid = new Set();
    const temporaryOrOther = [];

    if (results.length) {
      // Fetch up to 50 most recent bounce notifications
      const fetchList = results.slice(-50);
      for await (const item of client.fetch(fetchList, { source: true })) {
        if (!item.source || item.source.length > 3 * 1024 * 1024) continue;
        const mail = await simpleParser(item.source, { keepDeliveryStatus: true });

        const foundRecipients = [];
        let isPermanent = false;
        const originalMessageId = mail.headers.get('x-original-message-id') || mail.headers.get('original-message-id') || null;

        // 1. Check message/delivery-status attachment
        for (const attachment of mail.attachments || []) {
          if (attachment.contentType === 'message/delivery-status') {
            const parsed = parseDeliveryStatus(attachment.content.toString('utf8'));
            for (const ev of parsed) {
              if (ev.recipientEmail && validEmail(ev.recipientEmail)) {
                foundRecipients.push({
                  email: normalizeEmail(ev.recipientEmail),
                  status: ev.enhancedStatus,
                  diagnostic: ev.diagnosticCode,
                  messageId: ev.messageId || originalMessageId
                });
                if (isConfirmedAddressNotFound(ev.enhancedStatus, ev.diagnosticCode, '')) {
                  isPermanent = true;
                }
              }
            }
          }
        }

        // 2. Check X-Failed-Recipients header (standard in Gmail mailer-daemon)
        const failedHeader = mail.headers.get('x-failed-recipients');
        if (failedHeader) {
          const rawEmails = String(failedHeader).split(',').map(e => normalizeEmail(e)).filter(validEmail);
          for (const email of rawEmails) {
            if (!foundRecipients.some(r => r.email === email)) {
              foundRecipients.push({ email, messageId: originalMessageId });
            }
          }
        }

        // 3. Check plain text body for "Address not found" / "550 5.1.1" patterns
        const bodyText = mail.text || '';
        if (isConfirmedAddressNotFound('', '', bodyText)) {
          isPermanent = true;
          const emailMatch = bodyText.match(/(?:wasn't delivered to|failed to deliver to|delivery to)\s+<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63})>?/i)
            || bodyText.match(/<([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63})>:\s*550/i);
          if (emailMatch && validEmail(emailMatch[1])) {
            const email = normalizeEmail(emailMatch[1]);
            if (!foundRecipients.some(r => r.email === email)) {
              foundRecipients.push({ email, messageId: originalMessageId });
            }
          }
        }

        // Classify recipients
        for (const r of foundRecipients) {
          const isInvalid = isPermanent || isConfirmedAddressNotFound(r.status, r.diagnostic, bodyText);
          if (isInvalid) {
            confirmedInvalid.add(r.email);
          } else {
            temporaryOrOther.push({ email: r.email, reason: r.status || 'temporary_or_inconclusive' });
          }
        }
      }
    }

    const confirmedEmails = [...confirmedInvalid];
    let suppressedCount = 0;

    // Apply suppression and mark contacts for confirmed invalid addresses
    if (confirmedEmails.length > 0) {
      const now = new Date();
      for (const email of confirmedEmails) {
        // 1. Add persistent suppression
        await RecipientSuppression.updateOne(
          { userId: req.user._id, email },
          {
            $setOnInsert: {
              userId: req.user._id,
              email,
              source: 'authenticated_provider_5.1.1',
              reason: 'Confirmed invalid: Address not found (5.1.1 permanent failure)',
              createdAt: now
            }
          },
          { upsert: true }
        );

        // 2. Mark contact in Contact collection as bounced and invalid
        const contactResult = await Contact.updateMany(
          { userId: req.user._id, email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          {
            $set: {
              status: 'bounced',
              deliverabilityStatus: 'invalid',
              verificationStatus: 'invalid',
              suppressedAt: now,
              suppressionReason: 'Confirmed invalid: Address not found (5.1.1 permanent failure)'
            }
          }
        );
        suppressedCount += contactResult.modifiedCount;

        // 3. Update MailLog and DeliveryLedger
        await MailLog.updateMany(
          { userId: req.user._id, recipientEmail: email, status: { $ne: 'bounced' } },
          { $set: { status: 'bounced', bounceReason: 'Address not found (5.1.1 permanent failure)' } }
        );
        await DeliveryLedger.updateMany(
          { userId: req.user._id, recipientEmail: email, status: { $ne: 'bounced' } },
          { $set: { status: 'bounced', bounceReason: 'Address not found (5.1.1 permanent failure)' } }
        );
      }
    }

    res.json({
      message: confirmedEmails.length > 0
        ? `Scanned mailbox: found ${confirmedEmails.length} confirmed invalid ("address not found") recipient(s). ${suppressedCount} contact(s) suppressed. ${temporaryOrOther.length} temporary notice(s) preserved.`
        : (results.length > 0 ? `Scanned ${results.length} delivery notices: 0 confirmed invalid (no "address not found" failures). ${temporaryOrOther.length} temporary/inconclusive notices preserved.` : 'No delivery failure notices found in mailbox.'),
      confirmedCount: confirmedEmails.length,
      suppressedCount,
      confirmedEmails,
      temporaryCount: temporaryOrOther.length,
      scannedNotices: results.length
    });
  } catch (err) {
    res.status(502).json({ error: `Mailbox scan failed: ${err.message || 'Check supported mailbox settings and TLS connectivity.'}` });
  } finally {
    if (lock) lock.release();
    if (client) await client.logout().catch(() => client.close());
  }
};

exports.deleteBounced = async (req, res) => {
  try {
    // Delete contacts that are confirmed invalid (bounced or deliverabilityStatus=invalid)
    const result = await Contact.deleteMany({
      userId: req.user._id,
      $or: [
        { status: 'bounced', deliverabilityStatus: 'invalid' },
        { suppressionReason: /Address not found/i }
      ]
    });
    // For any remaining legacy bounced contacts that are not confirmed invalid, keep them quarantined
    const quarantined = await Contact.updateMany(
      { userId: req.user._id, status: 'bounced', suppressedAt: null },
      { $set: { suppressedAt: new Date(), suppressionReason: 'Legacy bounce quarantine; mailbox existence inconclusive' } }
    );
    res.json({
      message: `Deleted ${result.deletedCount} confirmed-invalid bounced contacts. ${quarantined.modifiedCount} unconfirmed bounces quarantined.`,
      deletedCount: result.deletedCount,
      quarantinedCount: quarantined.modifiedCount
    });
  } catch (err) {
    res.status(500).json({ error: `Bounce cleanup failed: ${err.message}` });
  }
};
