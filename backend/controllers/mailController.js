const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const dns = require('dns');
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');
const Campaign = require('../models/OutreachCampaign');
const Dispatch = require('../models/OutreachDispatch');
const campaignService = require('../services/campaignService');
const { renderTemplateText } = require('../services/outreachTemplateService');

exports.previewImmediate = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const {
      contactIds: rawContactIds,
      useBrevoDirect,
      smtpId,
      templateId,
      subjectOverride,
      bodyOverride,
      jobLinkOverride,
      roleOverride,
      overrideSalary,
      dailyLimit,
      intervalSeconds,
      name
    } = req.body || {};

    // 1. Explicitly chosen provider must never silently fall back; Brevo API is not supported for durable worker
    if (useBrevoDirect === true || smtpId === 'brevo') {
      return res.status(400).json({
        error: 'Durable outreach requires an SMTP connection. Brevo API is not currently supported by the campaign worker.'
      });
    }

    if (!Array.isArray(rawContactIds) || rawContactIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one contact to preview.' });
    }
    if (rawContactIds.length > 1000) {
      return res.status(400).json({ error: 'Select between 1 and 1000 recipients.' });
    }

    // 2. Resolve template defaults if overrides are not directly provided
    let defaultSubject = '';
    let defaultBody = '';
    if (templateId && Array.isArray(user.emailTemplates)) {
      const tmpl = user.emailTemplates.find(t => String(t._id) === String(templateId));
      if (tmpl) {
        defaultSubject = tmpl.subject || '';
        defaultBody = tmpl.body || '';
      }
    }
    if (!defaultSubject && user.mailTemplate) {
      defaultSubject = user.mailTemplate.subject || '';
      defaultBody = user.mailTemplate.body || '';
    }

    const rawSubject = (typeof subjectOverride === 'string' && subjectOverride.trim()) ? subjectOverride : defaultSubject;
    const rawBody = (typeof bodyOverride === 'string' && bodyOverride.trim()) ? bodyOverride : defaultBody;

    if (!rawSubject || !rawBody) {
      return res.status(400).json({ error: 'Subject and body are required.' });
    }

    // 3. Resolve sender: explicitly chosen sender or user default; never silently fallback from an explicit invalid id
    const senderIdToUse = (typeof smtpId === 'string' && smtpId.trim())
      ? smtpId.trim()
      : (user.selectedSmtpId || (user.smtpConfigs?.[0]?._id ? String(user.smtpConfigs[0]._id) : (user.smtpConfig?.user ? 'legacy-smtp' : '')));
    if (!senderIdToUse) {
      return res.status(400).json({ error: 'Choose an existing owned SMTP sender with complete credentials' });
    }

    const sender = campaignService.resolveSender(user, senderIdToUse);

    // 4. Fetch and account for every selected contact
    const validObjectIds = rawContactIds.filter(id => mongoose.isValidObjectId(id));
    const contacts = validObjectIds.length > 0
      ? await Contact.find({ _id: { $in: validObjectIds }, userId }).lean()
      : [];
    const contactMap = new Map(contacts.map(c => [String(c._id), c]));

    const processedContactIds = new Set();
    const recipients = [];
    const initialBlocked = [];

    for (const rawId of rawContactIds) {
      const idStr = String(rawId || '').trim();
      if (!idStr) continue;

      if (processedContactIds.has(idStr)) {
        initialBlocked.push({
          contactId: idStr,
          email: contactMap.get(idStr)?.email ? campaignService.normalizeEmail(contactMap.get(idStr).email) : null,
          reason: 'Duplicate recipient in selection'
        });
        continue;
      }
      processedContactIds.add(idStr);

      const c = contactMap.get(idStr);
      if (!c || String(c.userId) !== String(userId)) {
        // Report unavailable or non-owned contacts without leaking another owner's contact data
        initialBlocked.push({
          contactId: idStr,
          email: null,
          reason: 'Owned contact not found or unavailable'
        });
        continue;
      }

      const subject = renderTemplateText(rawSubject, { user, contact: c, jobLinkOverride, roleOverride }).replace(/[\r\n]+/g, ' ').trim();
      const body = renderTemplateText(rawBody, { user, contact: c, jobLinkOverride, roleOverride }).trim();
      recipients.push({
        contactId: String(c._id),
        subject,
        body,
        overrideSalary: overrideSalary === true
      });
    }

    const now = new Date();
    const sendingEnabled = process.env.OUTREACH_SENDING_ENABLED === 'true';
    const workerEnabled = process.env.OUTREACH_WORKER_ENABLED === 'true';
    const effectiveInterval = (Number.isInteger(intervalSeconds) && intervalSeconds >= 180 && intervalSeconds <= 86400) ? intervalSeconds : 180;

    if (recipients.length === 0) {
      return res.json({
        campaignId: null,
        digest: null,
        snapshot: {
          name: name || 'Immediate batch outreach',
          senderId: sender.id,
          senderEmail: sender.email,
          senderName: sender.name,
          senderHost: sender.host,
          senderPort: sender.port,
          provider: sender.provider,
          startAtUtc: now.toISOString(),
          immediate: true,
          dailyLimit: dailyLimit || Math.min(user.dailyEmailLimit || 450, 450),
          intervalSeconds: effectiveInterval,
          recipients: []
        },
        blocked: initialBlocked,
        eligibleCount: 0,
        blockedCount: initialBlocked.length,
        selectedCount: rawContactIds.length,
        sendingEnabled,
        workerEnabled,
        intervalSeconds: effectiveInterval,
        startAtUtc: now.toISOString(),
        estimatedMinutes: 0,
        minimumDays: 0
      });
    }

    const campaignInput = {
      name: name || 'Immediate batch outreach',
      senderId: sender.id,
      immediate: true,
      dailyLimit,
      intervalSeconds: effectiveInterval,
      recipients
    };

    const preview = await campaignService.previewCampaign(userId, campaignInput, now);
    let draft = null;
    if (preview.snapshot.recipients.length > 0) {
      draft = await campaignService.saveCampaign(userId, { ...campaignInput, recipients: preview.snapshot.recipients }, null, now);
    }

    const allBlocked = [...initialBlocked, ...preview.blocked];

    res.json({
      campaignId: draft ? draft._id : null,
      digest: draft ? draft.digest : preview.digest,
      snapshot: draft ? draft.snapshot : preview.snapshot,
      blocked: allBlocked,
      eligibleCount: preview.snapshot.recipients.length,
      blockedCount: allBlocked.length,
      selectedCount: rawContactIds.length,
      sendingEnabled,
      workerEnabled,
      intervalSeconds: preview.snapshot.intervalSeconds,
      startAtUtc: preview.startAtUtc,
      estimatedMinutes: preview.estimatedMinutes,
      minimumDays: preview.minimumDays
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.sendBatch = async (req, res) => {
  try {
    const { campaignId, approvedDigest } = req.body || {};

    // Reject arbitrary unapproved sends
    if (!campaignId || !approvedDigest || typeof approvedDigest !== 'string') {
      if (process.env.OUTREACH_SENDING_ENABLED !== 'true') {
        return res.status(403).json({ error: 'Sending is disabled. Preview and approve an exact campaign first.', requiredStep: 'preview' });
      }
      return res.status(409).json({
        error: 'Explicit preview and approved digest required. Review the exact recipients, sender, and exclusions before approving.',
        requiredStep: 'preview',
        campaignsPath: '/campaigns'
      });
    }

    const now = new Date();
    const campaign = await campaignService.approveCampaign(req.user._id, campaignId, approvedDigest, now);

    res.json({
      success: true,
      message: `Approved and queued ${campaign.snapshot.recipients.length} messages for immediate sending.`,
      campaignId: campaign._id,
      count: campaign.snapshot.recipients.length,
      status: campaign.state
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
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

// Backward-compatible summary backed by the same durable queue as /campaigns.
exports.getQueueStatus = async (req,res) => {
  try {
    const userId=req.user._id, user=await User.findById(userId);
    if(!user)return res.status(404).json({error:'User not found'});
    const start=new Date();start.setUTCHours(0,0,0,0);
    const {senderOptions,configuredLimit}=require('../services/campaignService');
    const dailyLimit=Math.min(user.dailyEmailLimit||450,configuredLimit('OUTREACH_MAX_DAILY',450));
    const senders=senderOptions(user);
    const [campaigns,pending,sending,sentToday,limitFailedCount]=await Promise.all([
      Campaign.find({userId,state:{$in:['scheduled','running','paused','needs_review']}}).select('state reason').lean(),
      Dispatch.countDocuments({userId,status:'queued'}),Dispatch.countDocuments({userId,status:'sending'}),
      MailLog.countDocuments({userId,status:{$in:['sent','delivered']},sentAt:{$gte:start}}),Contact.countDocuments({userId,status:'failed'})
    ]);
    const isPaused=campaigns.some(c=>['paused','needs_review'].includes(c.state));
    const accounts=await Promise.all(senders.map(async s=>{const count=await MailLog.countDocuments({userId,senderEmail:s.email,status:{$in:['sent','delivered']},sentAt:{$gte:start}});return {_id:s.id,name:s.name,user:s.email,host:s.host,port:s.port,sentToday:count,dailyLimit,remaining:Math.max(0,dailyLimit-count),isActive:s.id===user.selectedSmtpId};}));
    res.json({pending:pending+sending,size:pending,isPaused,pauseReason:isPaused?'CAMPAIGN_REVIEW':null,limitType:null,limitMessage:campaigns.find(c=>c.reason)?.reason||null,limitFailedCount,sentToday,dailyLimit,remaining:Math.max(0,dailyLimit-sentToday),activeSender:senders.find(s=>s.id===user.selectedSmtpId)?.email||senders[0]?.email||'',accounts,campaignsPath:'/campaigns',quotaDay:'UTC'});
  }catch(error){res.status(500).json({error:error.message});}
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

    const { isPublicIP } = require('../services/safePublicFetch');
    const host = targetSmtp.host || 'smtp.gmail.com';
    const port = Number(targetSmtp.port) || 465;
    if (![465, 587].includes(port)) return res.status(400).json({ error: 'Use TLS port 465 or STARTTLS port 587.' });
    const records = await dns.promises.lookup(host, { all: true, family: 4 });
    if (!records.length || records.some(r => !isPublicIP(r.address))) return res.status(400).json({ error: 'Private or unsupported SMTP destination.' });
    const address = records[0].address;
    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: true,
      auth: { user: targetSmtp.user, pass: targetSmtp.pass },
      tls: { rejectUnauthorized: true, servername: host },
      lookup: (_host, options, callback) => callback(null, options?.all ? [{ address, family: 4 }] : address, options?.all ? undefined : 4),
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000
    });

    console.log(`Starting SMTP verify for user: ${targetSmtp.user}`);
    try { await transporter.verify(); } finally { transporter.close(); }
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
    const result = await Campaign.updateMany(
      { userId: req.user._id, state: { $in: ['scheduled', 'running'] } },
      {
        $set: { state: 'paused', reason: 'Owner paused from dashboard' },
        $push: { events: { $each: [{ at: new Date(), action: 'pause_dashboard' }], $slice: -200 } }
      }
    );
    res.json({
      message: 'Active campaigns paused.',
      paused: result.modifiedCount,
      isPaused: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resumeQueue = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Never resume if unresolved unknown outcomes exist anywhere for this user
    const hasUnknownOutcome = await Dispatch.exists({ userId, status: 'unknown_outcome' });
    if (hasUnknownOutcome) {
      return res.status(409).json({
        error: 'Unresolved unknown delivery outcomes exist. Reconcile provider outcomes in Scheduled Campaigns before resuming.',
        requiresReconciliation: true,
        campaignsPath: '/campaigns'
      });
    }

    // 2. Find eligible owned paused/needs_review campaigns
    const pausedCampaigns = await Campaign.find({
      userId,
      state: { $in: ['paused', 'needs_review'] }
    });

    const now = new Date();
    let resumedCount = 0;

    for (const campaign of pausedCampaigns) {
      try {
        const updated = await campaignService.controlCampaign(userId, campaign._id, 'resume', now);
        if (updated) {
          resumedCount++;
        }
      } catch (err) {
        // Skipped: campaign with invalid digest, revision race, unknown outcome, or cancelled
      }
    }

    // 3. Derive actual resulting state: check if any paused / needs_review campaigns remain
    const remainingPaused = await Campaign.exists({ userId, state: { $in: ['paused', 'needs_review'] } });

    res.json({
      message: `Successfully resumed ${resumedCount} campaign(s).`,
      resumed: resumedCount,
      isPaused: Boolean(remainingPaused)
    });
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
    // Preserve historical failure/audit records when restoring pending contacts.

    res.json({
      message: `Successfully restored ${result.modifiedCount} contacts back to Pending!`,
      restoredCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.switchQueueAccount = async (req, res) => {
  return res.status(409).json({ error: 'Sender changes require a new exact campaign approval.', campaignsPath: '/campaigns' });
};
