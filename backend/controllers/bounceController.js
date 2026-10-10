const imaps = require('imap-simple');
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

    const config = {
      imap: {
        user: user.smtpConfig.user,
        password: user.smtpConfig.pass,
        host: 'imap.gmail.com', // Default to gmail
        port: 993,
        tls: true,
        authTimeout: 5000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    // Search for recent failure notifications (last 7 days for safety)
    const delay = 7 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - delay);
    
    const searchCriteria = [
      ['SINCE', since.toISOString()],
      ['OR', ['SUBJECT', 'Delivery Status Notification'], ['SUBJECT', 'Undeliverable']]
    ];

    const fetchOptions = {
      bodies: ['TEXT'],
      markSeen: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    let bouncedEmails = new Set();

    for (let item of messages) {
      const all = item.parts.find(part => part.which === 'TEXT');
      const id = item.attributes.uid;
      const idHeader = "Imap-Id: "+id+"\r\n";
      const mail = await simpleParser(idHeader + all.body);
      
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
    
    connection.end();

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
    const result = await Contact.deleteMany({ userId, status: 'bounced' });
    res.json({ message: `Successfully removed ${result.deletedCount} bounced contacts.`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
