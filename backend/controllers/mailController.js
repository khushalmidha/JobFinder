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
      contactIds,
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

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one contact to preview.' });
    }
    if (contactIds.length > 1000) {
      return res.status(400).json({ error: 'Select between 1 and 1000 recipients.' });
    }

    // Resolve template defaults if overrides are not directly provided
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

    // Resolve sender
    const senderIdToUse = smtpId || user.selectedSmtpId || (user.smtpConfigs?.[0]?._id ? String(user.smtpConfigs[0]._id) : (user.smtpConfig?.user ? 'legacy-smtp' : ''));
    if (!senderIdToUse) {
      return res.status(400).json({ error: 'Choose an existing owned SMTP sender with complete credentials' });
    }

    // Fetch owned contacts
    const validContactIds = contactIds.map(id => campaignService.objectId(id));
    const contacts = await Contact.find({ _id: { $in: validContactIds }, userId }).lean();
    const contactMap = new Map(contacts.map(c => [String(c._id), c]));

    const recipients = [];
    for (const id of contactIds) {
      const c = contactMap.get(String(id));
      if (!c) continue;
      const subject = renderTemplateText(rawSubject, { user, contact: c, jobLinkOverride, roleOverride }).replace(/[\r\n]+/g, ' ').trim();
      const body = renderTemplateText(rawBody, { user, contact: c, jobLinkOverride, roleOverride }).trim();
      recipients.push({
        contactId: String(c._id),
        subject,
        body,
        overrideSalary: overrideSalary === true
      });
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No valid owned contacts found to preview.' });
    }

    const now = new Date();
    const campaignInput = {
      name: name || 'Immediate batch outreach',
      senderId: senderIdToUse,
      immediate: true,
      dailyLimit,
      intervalSeconds,
      recipients
    };

    const preview = await campaignService.previewCampaign(userId, campaignInput, now);
    let draft = null;
    if (preview.snapshot.recipients.length > 0) {
      draft = await campaignService.saveCampaign(userId, { ...campaignInput, recipients: preview.snapshot.recipients }, null, now);
    }

    res.json({
      campaignId: draft ? draft._id : null,
      digest: draft ? draft.digest : preview.digest,
      snapshot: draft ? draft.snapshot : preview.snapshot,
      blocked: preview.blocked,
      eligibleCount: preview.snapshot.recipients.length,
      blockedCount: preview.blocked.length,
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

    // 1. Never resume if unresolved unknown outcomes exist
    const hasUnknownOutcome = await Dispatch.exists({ userId, status: 'unknown_outcome' });
    if (hasUnknownOutcome) {
      return res.status(409).json({
        error: 'Unresolved unknown delivery outcomes exist. Reconcile provider outcomes in Scheduled Campaigns before resuming.',
        requiresReconciliation: true,
        campaignsPath: '/campaigns'
      });
    }

    // 2. Find eligible owned paused campaigns (strictly 'paused')
    const pausedCampaigns = await Campaign.find({
      userId,
      state: 'paused'
    });

    if (pausedCampaigns.length === 0) {
      return res.json({
        message: 'No paused campaigns to resume.',
        resumed: 0,
        isPaused: false
      });
    }

    const { digest } = require('../services/campaignService');
    const now = new Date();
    let resumedCount = 0;

    for (const campaign of pausedCampaigns) {
      // Re-verify no unknown outcome dispatches in this campaign
      const dispatchUnknown = await Dispatch.exists({ campaignId: campaign._id, status: 'unknown_outcome' });
      if (dispatchUnknown) continue;

      // Verify approvedDigest binds to snapshot
      if (!campaign.approvedDigest || digest(campaign.snapshot) !== campaign.approvedDigest) {
        continue;
      }

      const nextState = campaign.startedAt ? 'running' : 'scheduled';
      const nextAt = new Date(Math.max(+now, +new Date(campaign.startAtUtc || 0)));

      await Campaign.updateOne(
        { _id: campaign._id, userId, state: 'paused', revision: campaign.revision },
        {
          $set: {
            state: nextState,
            nextAt,
            reason: 'Owner explicitly resumed from dashboard'
          },
          $push: { events: { $each: [{ at: now, action: 'resume_dashboard' }], $slice: -200 } }
        }
      );
      resumedCount++;
    }

    res.json({
      message: `Successfully resumed ${resumedCount} campaign(s).`,
      resumed: resumedCount,
      isPaused: false
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
