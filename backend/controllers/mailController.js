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
const mongoose = require('mongoose');

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

let queueLimitState = {
  isLimitPaused: false,
  limitType: null, // 'SAFETY_CAP' or 'GMAIL_EXCEEDED'
  limitAccount: null,
  sentToday: 0,
  dailyLimit: 50,
  pauseMessage: null,
  pausedAt: null
};

const getStartOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const getSentTodayCount = async (userId, senderEmail) => {
  const startOfToday = getStartOfToday();
  const query = {
    userId,
    status: { $in: ['sent', 'delivered'] },
    sentAt: { $gte: startOfToday }
  };
  if (senderEmail) {
    query.senderEmail = senderEmail.toLowerCase();
  }
  return await MailLog.countDocuments(query);
};

function isSendingLimitError(err) {
  if (!err) return false;
  const text = ((err.message || '') + ' ' + (err.response || '') + ' ' + (err.command || '')).toLowerCase();
  const responseCode = (err.responseCode || '').toString();
  return (
    text.includes('550-5.4.5') ||
    text.includes('550 5.4.5') ||
    text.includes('daily user sending limit') ||
    text.includes('daily sending limit') ||
    text.includes('sending limit exceeded') ||
    text.includes('quota exceeded') ||
    text.includes('user sending limit') ||
    (responseCode === '550' && text.includes('limit'))
  );
}

function isSmtpAuthError(err) {
  if (!err) return false;
  const text = ((err.message || '') + ' ' + (err.response || '') + ' ' + (err.command || '')).toLowerCase();
  const code = (err.code || '').toString().toUpperCase();
  const responseCode = (err.responseCode || '').toString();
  return (
    responseCode === '535' ||
    text.includes('535') ||
    text.includes('invalid login') ||
    text.includes('username and password not accepted') ||
    text.includes('badcredentials') ||
    text.includes('authentication failed') ||
    code === 'EAUTH'
  );
}

function isNetworkError(err) {
  if (!err) return false;
  const text = ((err.message || '') + ' ' + (err.code || '')).toLowerCase();
  const code = (err.code || '').toString().toUpperCase();
  return (
    code === 'ENETUNREACH' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENOTFOUND' ||
    text.includes('enetunreach') ||
    text.includes('connection timeout') ||
    text.includes('socket close') ||
    text.includes('econnreset')
  );
}

async function processBatches() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    while (true) {
      const batch = activeBatches.find(b => !b.isPaused && b.tasks.length > 0);
      if (!batch) break;
      
      const task = batch.tasks.shift();
      
      await globalRateLimiter.add(async () => {
        try {
          await task();
        } catch (err) {
          console.error("Task error", err);
        }
      });

      // If batch was paused during task execution (e.g. limit reached), stop loop immediately
      if (batch.isPaused) {
        if (batch.tasks.length > 0 && !activeBatches.includes(batch)) {
          activeBatches.push(batch);
        }
        break;
      }

      // Clean up finished batches
      activeBatches = activeBatches.filter(b => b.tasks.length > 0);
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
    const { contactIds, subjectOverride, bodyOverride, jobLinkOverride, roleOverride, smtpId, templateId } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Resolve template
    let chosenTemplate = null;
    if (templateId && user.emailTemplates && user.emailTemplates.length > 0) {
      chosenTemplate = user.emailTemplates.find(t => t._id?.toString() === templateId.toString());
    }
    if (!chosenTemplate && user.selectedTemplateId && user.emailTemplates && user.emailTemplates.length > 0) {
      chosenTemplate = user.emailTemplates.find(t => t._id?.toString() === user.selectedTemplateId.toString());
    }
    if (!chosenTemplate && user.emailTemplates && user.emailTemplates.length > 0) {
      chosenTemplate = user.emailTemplates.find(t => t.isDefault) || user.emailTemplates[0];
    }
    if (!chosenTemplate) {
      chosenTemplate = user.mailTemplate;
    }

    const defaultSubject = chosenTemplate?.subject || user.mailTemplate?.subject || '';
    const defaultBody = chosenTemplate?.body || user.mailTemplate?.body || '';

    // Resolve SMTP account
    let chosenSmtp = null;
    if (smtpId && user.smtpConfigs && user.smtpConfigs.length > 0) {
      chosenSmtp = user.smtpConfigs.find(s => s._id?.toString() === smtpId.toString());
    }
    if (!chosenSmtp && user.selectedSmtpId && user.smtpConfigs && user.smtpConfigs.length > 0) {
      chosenSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId.toString());
    }
    if (!chosenSmtp && user.smtpConfigs && user.smtpConfigs.length > 0) {
      chosenSmtp = user.smtpConfigs.find(s => s.isDefault) || user.smtpConfigs[0];
    }
    if (!chosenSmtp && user.smtpConfig && user.smtpConfig.user) {
      chosenSmtp = user.smtpConfig;
    }

    const useBrevo = !!user.brevoApiKey && !smtpId;

    if (!useBrevo && (!chosenSmtp || !chosenSmtp.user || !chosenSmtp.pass)) {
      return res.status(400).json({ 
        error: 'NO_SMTP_SELECTED',
        message: 'No SMTP connection selected. Please select or configure an email account in Settings.' 
      });
    }

    const senderEmail = (chosenSmtp?.user || user.email || '').toLowerCase();
    const dailyLimit = Number(user.dailyEmailLimit) > 0 ? Number(user.dailyEmailLimit) : 450;
    const sentToday = await getSentTodayCount(userId, senderEmail);

    if (sentToday >= dailyLimit) {
      return res.status(400).json({ 
        error: 'DAILY_SAFETY_LIMIT_REACHED',
        message: `Daily safety limit of ${dailyLimit} emails reached today on ${senderEmail} (${sentToday}/${dailyLimit} sent). Queue is paused to keep 50 emails reserved for your personal use. You can switch to another email account or adjust the limit in Settings.`,
        sentToday,
        dailyLimit
      });
    }

    const contacts = await Contact.find({ _id: { $in: contactIds }, userId });
    
    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No valid contacts found to send emails.' });
    }

    let transporter;
    if (!useBrevo) {
      transporter = nodemailer.createTransport({
        host: chosenSmtp.host,
        port: chosenSmtp.port,
        secure: Number(chosenSmtp.port) === 465,
        auth: {
          user: chosenSmtp.user,
          pass: chosenSmtp.pass,
        },
        tls: {
          rejectUnauthorized: false,
          servername: chosenSmtp.host
        },
        family: 4,
        lookup: lookupSmtpHost
      });
    }

    res.json({ message: `Queued ${contacts.length} emails for sending.`, count: contacts.length });

    // Queue emails for background processing with limit auto-pause protection
    const batchId = Date.now().toString();
    const batchObj = {
      batchId,
      userId,
      user,
      chosenSmtp,
      transporter,
      useBrevo,
      isPaused: false,
      pauseReason: null,
      tasks: []
    };

    const tasks = contacts.map(contact => {
      const taskFn = async () => {
        // If batch was paused before execution, do not proceed
        if (batchObj.isPaused) return;

        // Daily limit safety check per sender
        const currentSender = (batchObj.chosenSmtp?.user || user.email || '').toLowerCase();
        const currentDailyLimit = Number(user.dailyEmailLimit) > 0 ? Number(user.dailyEmailLimit) : 450;
        const currentSentToday = await getSentTodayCount(userId, currentSender);

        if (currentSentToday >= currentDailyLimit) {
          console.warn(`🛑 Daily safety quota (${currentDailyLimit}) reached for ${currentSender} (${currentSentToday}/${currentDailyLimit}). Pausing queue.`);

          // Keep contact status as pending in DB
          await Contact.findByIdAndUpdate(contact._id, { status: 'pending' });

          // Put task back into queue
          batchObj.tasks.unshift(taskFn);
          if (!activeBatches.includes(batchObj)) {
            activeBatches.push(batchObj);
          }

          // Pause all batches for this user
          batchObj.isPaused = true;
          batchObj.pauseReason = 'DAILY_SAFETY_LIMIT_REACHED';
          activeBatches.forEach(b => {
            if (b.userId?.toString() === userId.toString()) {
              b.isPaused = true;
              b.pauseReason = 'DAILY_SAFETY_LIMIT_REACHED';
            }
          });

          queueLimitState = {
            isLimitPaused: true,
            limitType: 'SAFETY_CAP',
            limitAccount: currentSender,
            sentToday: currentSentToday,
            dailyLimit: currentDailyLimit,
            pauseMessage: `Daily safety limit of ${currentDailyLimit} emails reached on ${currentSender} (${currentSentToday}/${currentDailyLimit} sent today). Queue automatically paused so you have 50 emails reserved for important personal emails.`,
            pausedAt: new Date()
          };

          return;
        }

        try {
          const subject = renderTemplate(subjectOverride || defaultSubject, user, contact, jobLinkOverride, roleOverride);
          const body = renderTemplate(bodyOverride || defaultBody, user, contact, jobLinkOverride, roleOverride);

          let messageId = '';
          if (batchObj.useBrevo) {
            const result = await sendWithBrevo(user.brevoApiKey, {
              from: user.email || batchObj.chosenSmtp?.user || 'noreply@jobfinder.com',
              fromName: user.name || '',
              to: contact.email,
              subject,
              text: body,
            });
            messageId = result.messageId || 'brevo-' + Date.now();
          } else {
            const info = await batchObj.transporter.sendMail({
              from: `"${user.name}" <${batchObj.chosenSmtp.user}>`,
              to: contact.email,
              subject: subject,
              text: body, // plain text body
            });
            messageId = info.messageId;
          }

          // Log success with senderEmail
          await MailLog.create({
            userId,
            contactId: contact._id,
            senderEmail: currentSender,
            subject,
            body,
            status: 'sent',
            providerMessageId: messageId
          });

          await Contact.findByIdAndUpdate(contact._id, { status: 'sent', lastMailedAt: new Date() });

        } catch (err) {
          console.error(`Failed to send email to ${contact.email}:`, err.message);

          // 1. Keep contact status as pending in DB so it is NEVER lost or wasted
          await Contact.findByIdAndUpdate(contact._id, { status: 'pending' });

          // 2. Put this task back into the batch queue so it can be resent once resolved
          batchObj.tasks.unshift(taskFn);
          if (!activeBatches.includes(batchObj)) {
            activeBatches.push(batchObj);
          }

          // 3. Determine pause classification and user message
          let pauseReason = 'SEND_ERROR';
          let limitType = 'SEND_ERROR';
          let pauseMessage = `Email to ${contact.email} failed (${err.message}). Queue automatically paused so remaining contacts stay pending.`;

          if (isSendingLimitError(err)) {
            console.warn(`⚠️ Daily sending limit hit on ${currentSender}. Queue paused.`);
            pauseReason = 'DAILY_LIMIT_EXCEEDED';
            limitType = 'GMAIL_EXCEEDED';
            pauseMessage = `Daily sending limit reached on ${currentSender}. Queue automatically paused to protect remaining contacts.`;
          } else if (isSmtpAuthError(err)) {
            console.warn(`🛑 SMTP Auth Error (535) on ${currentSender}. Queue paused.`);
            pauseReason = 'SMTP_AUTH_ERROR';
            limitType = 'AUTH_ERROR';
            pauseMessage = `SMTP Authentication failed for ${currentSender} (Invalid login: 535-5.7.8 Username and Password not accepted). Queue automatically paused so your contacts won't fail. Please update your App Password in Settings or Switch Account.`;
          } else if (isNetworkError(err)) {
            console.warn(`🌐 Network error on sending: ${err.message}. Queue paused.`);
            pauseReason = 'NETWORK_ERROR';
            limitType = 'NETWORK_ERROR';
            pauseMessage = `Network connection failed (${err.code || err.message}). Queue paused automatically so contacts are not lost. Check your internet connection and click Resume.`;
          }

          // 4. Log failure in MailLog for debugging visibility
          await MailLog.create({
            userId,
            contactId: contact._id,
            senderEmail: currentSender,
            subject: subjectOverride || defaultSubject,
            body: bodyOverride || defaultBody,
            status: 'failed',
            bounceReason: err.message
          });

          // 5. PAUSE THIS BATCH AND ALL BATCHES FOR THIS USER IMMEDIATELY
          batchObj.isPaused = true;
          batchObj.pauseReason = pauseReason;
          activeBatches.forEach(b => {
            if (b.userId?.toString() === userId.toString()) {
              b.isPaused = true;
              b.pauseReason = pauseReason;
            }
          });

          queueLimitState = {
            isLimitPaused: true,
            limitType,
            limitAccount: currentSender,
            sentToday: currentSentToday,
            dailyLimit: currentDailyLimit,
            pauseMessage,
            pausedAt: new Date()
          };

          return;
        }
      };

      return taskFn;
    });

    batchObj.tasks = tasks;
    activeBatches.push(batchObj);
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
    const startOfToday = getStartOfToday();

    // Concurrently fetch User, today's aggregated sent counts per email, and failed contacts
    const [user, mailCounts, limitFailedCount] = await Promise.all([
      User.findById(req.user._id).select('email dailyEmailLimit selectedSmtpId smtpConfigs smtpConfig').lean(),
      MailLog.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user._id),
            status: { $in: ['sent', 'delivered'] },
            sentAt: { $gte: startOfToday }
          }
        },
        {
          $group: {
            _id: { $toLower: '$senderEmail' },
            count: { $sum: 1 }
          }
        }
      ]),
      Contact.countDocuments({
        userId: req.user._id,
        status: 'failed'
      })
    ]);

    const countMap = {};
    if (Array.isArray(mailCounts)) {
      mailCounts.forEach(item => {
        if (item._id) countMap[item._id] = item.count;
      });
    }

    let chosenSmtp = null;
    if (user?.selectedSmtpId && user?.smtpConfigs) {
      chosenSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId?.toString());
    }
    if (!chosenSmtp && user?.smtpConfigs && user.smtpConfigs.length > 0) {
      chosenSmtp = user.smtpConfigs.find(s => s.isDefault) || user.smtpConfigs[0];
    }
    if (!chosenSmtp && user?.smtpConfig && user.smtpConfig.user) {
      chosenSmtp = user.smtpConfig;
    }
    const activeSender = (chosenSmtp?.user || user?.email || '').toLowerCase();
    const dailyLimit = Number(user?.dailyEmailLimit) > 0 ? Number(user.dailyEmailLimit) : 450;
    const sentToday = countMap[activeSender] || 0;
    const remaining = Math.max(0, dailyLimit - sentToday);

    // Compute detailed stats for all user's configured SMTP accounts in memory from countMap
    const accounts = [];
    if (user?.smtpConfigs && user.smtpConfigs.length > 0) {
      for (const acc of user.smtpConfigs) {
        if (!acc.user) continue;
        const email = acc.user.toLowerCase();
        const count = countMap[email] || 0;
        accounts.push({
          _id: acc._id,
          name: acc.name || email,
          user: email,
          host: acc.host,
          port: acc.port,
          isDefault: !!acc.isDefault,
          sentToday: count,
          dailyLimit,
          remaining: Math.max(0, dailyLimit - count),
          isActive: (user.selectedSmtpId ? acc._id?.toString() === user.selectedSmtpId.toString() : acc.isDefault) || email === activeSender
        });
      }
    }
    // Also include legacy smtpConfig if user has one not already listed
    if (user?.smtpConfig?.user) {
      const email = user.smtpConfig.user.toLowerCase();
      if (!accounts.some(a => a.user === email)) {
        const count = countMap[email] || 0;
        accounts.push({
          _id: 'legacy',
          name: email,
          user: email,
          host: user.smtpConfig.host,
          port: user.smtpConfig.port,
          isDefault: accounts.length === 0,
          sentToday: count,
          dailyLimit,
          remaining: Math.max(0, dailyLimit - count),
          isActive: email === activeSender
        });
      }
    }

    const isSafetyLimitReached = sentToday >= dailyLimit;

    let finalPauseReason = null;
    if (queueLimitState.isLimitPaused) {
      if (queueLimitState.limitType === 'SAFETY_CAP') finalPauseReason = 'DAILY_SAFETY_LIMIT_REACHED';
      else if (queueLimitState.limitType === 'GMAIL_EXCEEDED') finalPauseReason = 'DAILY_LIMIT_EXCEEDED';
      else if (queueLimitState.limitType === 'AUTH_ERROR') finalPauseReason = 'SMTP_AUTH_ERROR';
      else if (queueLimitState.limitType === 'NETWORK_ERROR') finalPauseReason = 'NETWORK_ERROR';
      else if (queueLimitState.limitType === 'SEND_ERROR') finalPauseReason = 'SEND_ERROR';
      else finalPauseReason = 'ERROR_PAUSED';
    } else if (isSafetyLimitReached) {
      finalPauseReason = 'DAILY_SAFETY_LIMIT_REACHED';
    } else if (isPaused) {
      const activePausedBatch = activeBatches.find(b => b.isPaused && b.pauseReason);
      finalPauseReason = activePausedBatch?.pauseReason || 'MANUAL';
    }

    res.json({
      pending: pending + globalRateLimiter.pending,
      size: globalRateLimiter.size,
      isPaused: isPaused || queueLimitState.isLimitPaused || isSafetyLimitReached,
      pauseReason: finalPauseReason,
      limitType: queueLimitState.limitType || (isSafetyLimitReached ? 'SAFETY_CAP' : null),
      limitAccount: queueLimitState.limitAccount || activeSender,
      limitMessage: queueLimitState.pauseMessage || (isSafetyLimitReached ? `Daily safety limit of ${dailyLimit} emails reached today on ${activeSender} (${sentToday}/${dailyLimit}). Queue paused to keep 50 emails reserved for important personal messages.` : null),
      limitFailedCount,
      sentToday,
      dailyLimit,
      remaining,
      activeSender,
      accounts
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

    const { smtpConfig: customConfig, smtpId } = req.body || {};

    let targetSmtp = null;
    if (customConfig && customConfig.user && customConfig.pass) {
      targetSmtp = customConfig;
    } else if (smtpId && user.smtpConfigs) {
      targetSmtp = user.smtpConfigs.find(s => s._id?.toString() === smtpId.toString());
    } else if (user.selectedSmtpId && user.smtpConfigs) {
      targetSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId.toString());
    } else if (user.smtpConfigs && user.smtpConfigs.length > 0) {
      targetSmtp = user.smtpConfigs.find(s => s.isDefault) || user.smtpConfigs[0];
    } else if (user.smtpConfig && user.smtpConfig.user) {
      targetSmtp = user.smtpConfig;
    }

    // If no custom SMTP specified and Brevo API key exists, test Brevo
    if (!customConfig && !smtpId && user.brevoApiKey) {
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

    if (!targetSmtp || !targetSmtp.user || !targetSmtp.pass) {
      return res.status(400).json({ error: 'SMTP configuration is missing. Please save or enter your SMTP credentials first.' });
    }

    let smtpHostIp = targetSmtp.host || 'smtp.gmail.com';
    try {
      const { address } = await lookup(smtpHostIp, { family: 4 });
      if (address) smtpHostIp = address;
    } catch (e) {
      console.warn("Failed to manually resolve SMTP host to IPv4", e);
    }

    const transporter = nodemailer.createTransport({
      host: smtpHostIp,
      port: Number(targetSmtp.port) || 465,
      secure: Number(targetSmtp.port) === 465,
      auth: {
        user: targetSmtp.user,
        pass: targetSmtp.pass,
      },
      tls: {
        rejectUnauthorized: false,
        servername: targetSmtp.host || 'smtp.gmail.com'
      },
      family: 4,
      lookup: lookupSmtpHost,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000
    });

    console.log(`Starting SMTP verify for user: ${targetSmtp.user}`);
    await transporter.verify();
    console.log(`SMTP verify success for: ${targetSmtp.user}`);
    res.json({ message: `SMTP connected successfully for ${targetSmtp.user}!` });
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
    activeBatches.forEach(b => {
      b.isPaused = true;
      b.pauseReason = 'MANUAL';
    });
    res.json({ message: 'Queue paused.', isPaused: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resumeQueue = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    let chosenSmtp = null;
    if (user?.selectedSmtpId && user?.smtpConfigs) {
      chosenSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId?.toString());
    }
    if (!chosenSmtp && user?.smtpConfigs && user.smtpConfigs.length > 0) {
      chosenSmtp = user.smtpConfigs.find(s => s.isDefault) || user.smtpConfigs[0];
    }
    if (!chosenSmtp && user?.smtpConfig && user.smtpConfig.user) {
      chosenSmtp = user.smtpConfig;
    }
    const activeSender = (chosenSmtp?.user || user?.email || '').toLowerCase();
    const dailyLimit = Number(user?.dailyEmailLimit) > 0 ? Number(user.dailyEmailLimit) : 450;
    const sentToday = await getSentTodayCount(req.user._id, activeSender);

    if (sentToday >= dailyLimit && !req.body?.overrideLimit) {
      return res.status(400).json({
        error: 'DAILY_SAFETY_LIMIT_REACHED',
        message: `Daily safety limit of ${dailyLimit} emails reached today (${sentToday}/${dailyLimit}). Queue cannot be resumed on this account to protect your 50 reserved personal emails. Switch to another email account or adjust your daily limit in Settings.`,
        sentToday,
        dailyLimit
      });
    }

    activeBatches.forEach(b => {
      b.isPaused = false;
      b.pauseReason = null;
    });
    queueLimitState = {
      isLimitPaused: false,
      limitType: null,
      limitAccount: null,
      sentToday,
      dailyLimit,
      pauseMessage: null,
      pausedAt: null
    };
    processBatches();
    res.json({ message: 'Queue resumed.', isPaused: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.restoreLimitFailed = async (req, res) => {
  try {
    const userId = req.user._id;
    const failedContacts = await Contact.find({ userId, status: 'failed' }).select('_id').lean();
    const contactIds = failedContacts.map(c => c._id);

    const result = await Contact.updateMany(
      { _id: { $in: contactIds }, userId },
      { status: 'pending' }
    );

    // Clean up failure logs for auth/limit/network errors
    const errorRegex = new RegExp('(limit|535|login|password|auth|connect|timeout|socket|econn)', 'i');
    await MailLog.deleteMany({ userId, status: 'failed', bounceReason: errorRegex });

    queueLimitState = {
      isLimitPaused: false,
      limitType: null,
      limitAccount: null,
      pauseMessage: null,
      pausedAt: null
    };

    res.json({
      message: `Successfully restored ${result.modifiedCount} contacts back to Pending!`,
      restoredCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.switchQueueAccount = async (req, res) => {
  try {
    const { smtpId } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let newSmtp = null;
    if (smtpId && user.smtpConfigs) {
      newSmtp = user.smtpConfigs.find(s => s._id?.toString() === smtpId.toString());
    }
    if (!newSmtp && user.selectedSmtpId && user.smtpConfigs) {
      newSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId.toString());
    }
    if (!newSmtp && user.smtpConfigs && user.smtpConfigs.length > 0) {
      newSmtp = user.smtpConfigs.find(s => s.isDefault) || user.smtpConfigs[0];
    }

    if (!newSmtp || !newSmtp.user || !newSmtp.pass) {
      return res.status(400).json({ error: 'Selected SMTP account not found or credentials missing.' });
    }

    let smtpHostIp = newSmtp.host || 'smtp.gmail.com';
    try {
      const { address } = await lookup(smtpHostIp, { family: 4 });
      if (address) smtpHostIp = address;
    } catch (e) {
      console.warn("Failed to resolve new SMTP host to IPv4", e);
    }

    const newTransporter = nodemailer.createTransport({
      host: smtpHostIp,
      port: Number(newSmtp.port) || 465,
      secure: Number(newSmtp.port) === 465,
      auth: {
        user: newSmtp.user,
        pass: newSmtp.pass,
      },
      tls: {
        rejectUnauthorized: false,
        servername: newSmtp.host || 'smtp.gmail.com'
      },
      family: 4,
      lookup: lookupSmtpHost
    });

    // Update active batches for this user with new SMTP credentials
    activeBatches.forEach(b => {
      if (b.userId?.toString() === userId.toString()) {
        b.chosenSmtp = newSmtp;
        b.transporter = newTransporter;
        b.isPaused = false;
        b.pauseReason = null;
      }
    });

    user.selectedSmtpId = newSmtp._id;
    await user.save();

    queueLimitState = {
      isLimitPaused: false,
      limitAccount: null,
      pauseMessage: null,
      pausedAt: null
    };

    processBatches();

    res.json({
      message: `Queue resumed using ${newSmtp.user}!`,
      activeAccount: newSmtp.user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
