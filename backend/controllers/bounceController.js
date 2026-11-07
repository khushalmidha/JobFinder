const { ImapFlow } = require('imapflow');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');

exports.scanBounces = async (req, res) => {
  const userId = req.user._id;
  try {
    const user = await User.findById(userId);
    
    if (!user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      return res.status(400).json({ error: 'Email configuration is missing.' });
    }

    const client = new ImapFlow({
      host: user.smtpConfig.host || 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: user.smtpConfig.user,
        pass: user.smtpConfig.pass
      },
      logger: false,
      tls: { rejectUnauthorized: false }
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let bouncedEmails = new Set();

    try {
      // Search for recent failure notifications (last 7 days for safety)
      const delay = 7 * 24 * 3600 * 1000;
      const since = new Date(Date.now() - delay);

      const searchResult = await client.search({
        since,
        or: [
          { header: ['subject', 'Delivery Status Notification'] },
          { header: ['subject', 'Undeliverable'] }
        ]
      });

      if (Array.isArray(searchResult) && searchResult.length > 0) {
        for await (const item of client.fetch(searchResult, { source: true, flags: true })) {
          const mail = await simpleParser(item.source);
          const bodyText = mail.text || '';
          
          const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
          let match;
          while ((match = emailRegex.exec(bodyText)) !== null) {
            const foundEmail = match[1].toLowerCase();
            if (foundEmail !== user.smtpConfig.user.toLowerCase() && !foundEmail.includes('mailer-daemon')) {
              bouncedEmails.add(foundEmail);
            }
          }
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }

    const emailsArray = Array.from(bouncedEmails);
    let modifiedCount = 0;
    
    if (emailsArray.length > 0) {
      const result = await Contact.updateMany(
        { userId, email: { $in: emailsArray }, status: { $ne: 'bounced' } },
        { $set: { status: 'bounced' } }
      );
      modifiedCount = result.modifiedCount;
    }

    res.json({ 
      message: `Scanned inbox and found ${emailsArray.length} unique bounced addresses. Updated ${modifiedCount} contacts.`, 
      bouncedCount: modifiedCount, 
      emails: emailsArray 
    });
  } catch (error) {
    console.error('Scan Bounces Error:', error);
    res.status(500).json({ error: 'Failed to scan inbox for bounces. Ensure your app password allows IMAP access and IMAP is enabled in your Gmail settings.' });
  }
};

exports.deleteBounced = async (req, res) => {
  const userId = req.user._id;
  try {
    const result = await Contact.updateMany({ userId, status: 'bounced' }, { $set: { suppressedAt: new Date(), suppressionReason: 'bounce', deliverabilityStatus: 'invalid' } });
    res.json({ message: `Quarantined ${result.modifiedCount} bounced contacts; history preserved.`, suppressedCount: result.modifiedCount, deletedCount: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
