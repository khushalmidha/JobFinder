const nodemailer = require('nodemailer');
const PQueue = require('p-queue').default;
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');

// Use a simple in-memory queue with concurrency 1 and interval 3 seconds
// This ensures we don't hit rate limits quickly for Gmail
const emailQueue = new PQueue({ concurrency: 1, intervalCap: 1, interval: 3000 });

function renderTemplate(template, user, contact, jobLinkOverride) {
  let content = template;
  content = content.replace(/{{userName}}/g, user.name || '');
  content = content.replace(/{{userEmail}}/g, user.email || '');
  // add more replacements as needed like {{college}}, {{cgpa}}, {{userPhone}} if they were added to user schema
  content = content.replace(/{{resumeLink}}/g, user.resumeLink || '');
  content = content.replace(/{{jobLink}}/g, jobLinkOverride || user.defaultJobLink || '');
  content = content.replace(/{{companyName}}/g, contact.company || '');
  content = content.replace(/{{hrName}}/g, contact.hrName || '');
  return content;
}

exports.sendBatch = async (req, res) => {
  try {
    const { contactIds, subjectOverride, bodyOverride, jobLinkOverride } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      return res.status(400).json({ error: 'SMTP configuration is missing. Please update your settings.' });
    }

    const contacts = await Contact.find({ _id: { $in: contactIds }, userId });
    
    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found to send emails.' });
    }

    const transporter = nodemailer.createTransport({
      host: user.smtpConfig.host,
      port: user.smtpConfig.port,
      secure: user.smtpConfig.port === 465, // true for 465, false for other ports
      auth: {
        user: user.smtpConfig.user,
        pass: user.smtpConfig.pass, // decryption happens automatically via mongoose getter
      },
    });

    res.json({ message: `Queued ${contacts.length} emails for sending.`, count: contacts.length });

    // Queue emails for background processing
    for (const contact of contacts) {
      emailQueue.add(async () => {
        try {
          const subject = renderTemplate(subjectOverride || user.mailTemplate.subject, user, contact, jobLinkOverride);
          const body = renderTemplate(bodyOverride || user.mailTemplate.body, user, contact, jobLinkOverride);

          const info = await transporter.sendMail({
            from: `"${user.name}" <${user.smtpConfig.user}>`,
            to: contact.email,
            subject: subject,
            text: body, // plain text body
          });

          // Log success
          await MailLog.create({
            userId,
            contactId: contact._id,
            subject,
            body,
            status: 'sent',
            providerMessageId: info.messageId
          });

          await Contact.findByIdAndUpdate(contact._id, { status: 'sent', lastMailedAt: new Date() });

        } catch (err) {
          console.error(`Failed to send email to ${contact.email}:`, err);
          // Log failure
          await MailLog.create({
            userId,
            contactId: contact._id,
            subject: subjectOverride || user.mailTemplate.subject,
            body: bodyOverride || user.mailTemplate.body,
            status: 'failed',
            bounceReason: err.message
          });
          await Contact.findByIdAndUpdate(contact._id, { status: 'failed' });
        }
      });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const logs = await MailLog.find({ userId: req.user._id })
      .populate('contactId', 'company email hrName')
      .sort({ sentAt: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
