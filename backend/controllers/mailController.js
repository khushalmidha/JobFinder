const nodemailer = require('nodemailer');
const PQueue = require('p-queue').default;
const dns = require('dns');
const { lookup } = require('dns').promises;
dns.setDefaultResultOrder('ipv4first'); // Force IPv4 to fix ENETUNREACH on Render

const lookupSmtpHost = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, family: 4 }, callback);
};

const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendWithBrevo(apiKey, { from, fromName, to, subject, text }) {
  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: fromName, email: from },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Brevo API error: ${response.status}`);
  }
  return payload;
}

const globalRateLimiter = new PQueue({ concurrency: 1, intervalCap: 1, interval: 3000 });

let activeBatches = [];

let isProcessing = false;

async function processBatches() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    while (true) {
      const batch = activeBatches.find(b => !b.isPaused && b.tasks.length > 0);
      if (!batch) break;
      
      const task = batch.tasks.shift();
      activeBatches = activeBatches.filter(b => b.tasks.length > 0);
      
      await globalRateLimiter.add(async () => {
        try {
          await task();
        } catch (err) {
          console.error("Task error", err);
        }
      });
    }
  } finally {
    isProcessing = false;
  }
}

function renderTemplate(template, user, contact, jobLinkOverride, roleOverride) {
  let content = template;
  content = content.replace(/{{userName}}/g, user.name || '');
  content = content.replace(/{{userEmail}}/g, user.email || '');
  content = content.replace(/{{resumeLink}}/g, user.resumeLink || '');
  content = content.replace(/{{jobLink}}/g, jobLinkOverride || user.defaultJobLink || '');
  content = content.replace(/{{jobId}}/g, jobLinkOverride || user.defaultJobLink || '');
  content = content.replace(/{{companyName}}/g, contact.company || '');
  content = content.replace(/{{hrName}}/g, contact.hrName || '');
  content = content.replace(/{{role}}/g, roleOverride || contact.role || '');
  return content;
}

exports.sendBatch = async (req, res) => {
  try {
    const { contactIds, subjectOverride, bodyOverride, jobLinkOverride, roleOverride } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    const useBrevo = !!user.brevoApiKey;

    if (!useBrevo && (!user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass)) {
      return res.status(400).json({ error: 'Email configuration is missing. Please update your settings.' });
    }

    const contacts = await Contact.find({ _id: { $in: contactIds }, userId });
    
    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found to send emails.' });
    }

    let transporter;
    if (!useBrevo) {
      let smtpHostIp = user.smtpConfig.host;
      try {
        const { address } = await lookup(user.smtpConfig.host, { family: 4 });
        if (address) smtpHostIp = address;
      } catch (e) {
        console.warn("Failed to manually resolve SMTP host to IPv4", e);
      }

      transporter = nodemailer.createTransport({
        host: smtpHostIp,
        port: user.smtpConfig.port,
        secure: user.smtpConfig.port === 465,
        auth: {
          user: user.smtpConfig.user,
          pass: user.smtpConfig.pass,
        },
        tls: {
          rejectUnauthorized: false,
          servername: user.smtpConfig.host
        },
        family: 4,
        lookup: lookupSmtpHost
      });
    }

    res.json({ message: `Queued ${contacts.length} emails for sending.`, count: contacts.length });

    // Queue emails for background processing
    const batchId = Date.now().toString();
    const tasks = contacts.map(contact => async () => {
      try {
        const subject = renderTemplate(subjectOverride || user.mailTemplate.subject, user, contact, jobLinkOverride, roleOverride);
        const body = renderTemplate(bodyOverride || user.mailTemplate.body, user, contact, jobLinkOverride, roleOverride);

        let messageId = '';
        if (useBrevo) {
          const result = await sendWithBrevo(user.brevoApiKey, {
            from: user.email || user.smtpConfig?.user || 'noreply@jobfinder.com',
            fromName: user.name || '',
            to: contact.email,
            subject,
            text: body,
          });
          messageId = result.messageId || 'brevo-' + Date.now();
        } else {
          const info = await transporter.sendMail({
            from: `"${user.name}" <${user.smtpConfig.user}>`,
            to: contact.email,
            subject: subject,
            text: body, // plain text body
          });
          messageId = info.messageId;
        }

        // Log success
        await MailLog.create({
          userId,
          contactId: contact._id,
          subject,
          body,
          status: 'sent',
          providerMessageId: messageId
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

    activeBatches.push({ batchId, isPaused: false, tasks });
    processBatches();

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

exports.getQueueStatus = async (req, res) => {
  try {
    const pending = activeBatches.reduce((sum, b) => sum + b.tasks.length, 0);
    const isPaused = activeBatches.length > 0 && activeBatches.every(b => b.isPaused);
    res.json({
      pending: pending + globalRateLimiter.pending,
      size: globalRateLimiter.size,
      isPaused
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.testConnection = async (req, res) => {
  let user;
  try {
    user = await User.findById(req.user._id);
    if (!user) {
      return res.status(400).json({ error: 'User not found.' });
    }

    if (user.brevoApiKey) {
      console.log('Starting Brevo API verify');
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': user.brevoApiKey }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || `Brevo API error: ${response.status}`);
      }
      console.log('Brevo verify success');
      return res.json({ message: 'Brevo API connected successfully!' });
    }

    if (!user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      return res.status(400).json({ error: 'SMTP configuration is missing. Please save your settings first.' });
    }

    let smtpHostIp = user.smtpConfig.host;
    try {
      const { address } = await lookup(user.smtpConfig.host, { family: 4 });
      if (address) smtpHostIp = address;
    } catch (e) {
      console.warn("Failed to manually resolve SMTP host to IPv4", e);
    }

    const transporter = nodemailer.createTransport({
      host: smtpHostIp,
      port: user.smtpConfig.port,
      secure: user.smtpConfig.port === 465,
      auth: {
        user: user.smtpConfig.user,
        pass: user.smtpConfig.pass,
      },
      tls: {
        rejectUnauthorized: false,
        servername: user.smtpConfig.host
      },
      family: 4,
      lookup: lookupSmtpHost,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000
    });

    console.log(`Starting SMTP verify for user: ${user.smtpConfig.user}`);
    await transporter.verify();
    console.log('SMTP verify success');
    res.json({ message: 'Gmail connected successfully!' });
  } catch (error) {
    console.error('Connection Test Error:', error);
    let friendlyAdvice = '';
    const errMsg = (error.message || '').toLowerCase();
    
    if (error.code === 'EAUTH' || errMsg.includes('535') || errMsg.includes('username and password not accepted') || errMsg.includes('badcredentials')) {
      friendlyAdvice = '🔑 Invalid Credentials: In Gmail, you CANNOT use your regular account password. You MUST turn on 2-Step Verification and generate a 16-character Google App Password at https://myaccount.google.com/apppasswords, then paste that 16-character code here.';
    } else if (error.code === 'ENETUNREACH' || error.code === 'ETIMEDOUT' || errMsg.includes('timeout')) {
      friendlyAdvice = '🌐 Network Timeout / IPv6 Block: Free cloud platforms like Render can block direct outbound SMTP connections to Gmail. Deploying this project on AWS (EC2 / App Runner) fixes this completely with direct IPv4 network access, or you can use a free Brevo API key.';
    }

    res.status(400).json({ 
      error: friendlyAdvice || `Failed to connect: ${error.message}`,
      technicalError: error.message,
      code: error.code
    });
  }
};

exports.pauseQueue = async (req, res) => {
  try {
    activeBatches.forEach(b => b.isPaused = true);
    res.json({ message: 'Queue paused.', isPaused: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resumeQueue = async (req, res) => {
  try {
    activeBatches.forEach(b => b.isPaused = false);
    processBatches();
    res.json({ message: 'Queue resumed.', isPaused: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
