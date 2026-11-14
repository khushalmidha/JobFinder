const nodemailer = require('nodemailer');
const dns = require('dns');
const User = require('../models/User');
const Contact = require('../models/Contact');
const MailLog = require('../models/MailLog');
const DeliveryLedger = require('../models/DeliveryLedger');
const Campaign = require('../models/OutreachCampaign');
const Dispatch = require('../models/OutreachDispatch');

exports.sendBatch = async (req, res) => {
  // Preserve the endpoint and history, but retire its process-memory delivery
  // path. All new sends must use the durable, exact-approved campaign worker.
  if (process.env.OUTREACH_SENDING_ENABLED !== 'true') return res.status(403).json({ error: 'Sending is disabled. Review a scheduled campaign first.' });
  return res.status(409).json({ error: 'Use Scheduled Campaigns to preview and approve the exact durable queue.', campaignsPath: '/campaigns' });
};

exports.getLogs = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id, sentAt: { $gte: cutoff } };
    const [totalInWindow, logs] = await Promise.all([
      MailLog.countDocuments(filter),
      MailLog.find(filter)
        .populate('contactId', 'company email hrName')
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    if (req.query.format === 'array') {
      return res.json(logs);
    }

    res.json({
      logs,
      totalInWindow,
      retentionHours: 48,
      page,
      limit,
      totalPages: Math.ceil(totalInWindow / limit) || 1
    });
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
    const [campaigns,pending,sending,sentTodayLogs,sentTodayLedger,limitFailedCount]=await Promise.all([
      Campaign.find({userId,state:{$in:['scheduled','running','paused','needs_review']}}).select('state reason snapshot').lean(),
      Dispatch.countDocuments({userId,status:'queued'}),Dispatch.countDocuments({userId,status:'sending'}),
      MailLog.countDocuments({userId,status:{$in:['sent','delivered']},sentAt:{$gte:start}}),
      DeliveryLedger.countDocuments({userId,status:{$in:['sent','delivered']},sentAt:{$gte:start}}),
      Contact.countDocuments({userId,status:'failed'})
    ]);
    const isPaused=campaigns.some(c=>['paused','needs_review'].includes(c.state));
    const activeCampaign = campaigns.find(c => ['running', 'scheduled'].includes(c.state)) || campaigns[0];
    const intervalSeconds = activeCampaign?.snapshot?.intervalSeconds || 180;
    const sentToday = sentTodayLogs + sentTodayLedger;
    const accounts=await Promise.all(senders.map(async s=>{
      const [countLogs, countLedger] = await Promise.all([
        MailLog.countDocuments({userId,senderEmail:s.email,status:{$in:['sent','delivered']},sentAt:{$gte:start}}),
        DeliveryLedger.countDocuments({userId,senderEmail:s.email,status:{$in:['sent','delivered']},sentAt:{$gte:start}})
      ]);
      const count = countLogs + countLedger;
      return {_id:s.id,name:s.name,user:s.email,host:s.host,port:s.port,sentToday:count,dailyLimit,remaining:Math.max(0,dailyLimit-count),isActive:s.id===user.selectedSmtpId};
    }));
    res.json({
      pending:pending+sending,
      size:pending,
      isPaused,
      pauseReason:isPaused?'CAMPAIGN_REVIEW':null,
      limitType:null,
      limitMessage:campaigns.find(c=>c.reason)?.reason||null,
      limitFailedCount,
      sentToday,
      dailyLimit,
      remaining:Math.max(0,dailyLimit-sentToday),
      activeSender:senders.find(s=>s.id===user.selectedSmtpId)?.email||senders[0]?.email||'',
      accounts,
      campaignsPath:'/campaigns',
      quotaDay:'UTC',
      intervalSeconds
    });
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

exports.pauseQueue = async (req,res) => {
  try {
    const result=await Campaign.updateMany({userId:req.user._id,state:{$in:['scheduled','running']}},{$set:{state:'paused',reason:'Owner paused all campaigns'},$push:{events:{$each:[{at:new Date(),action:'pause_all'}],$slice:-200}}});
    res.json({message:'Owned campaigns paused; an in-flight provider request may finish.',paused:result.modifiedCount});
  }catch(error){res.status(500).json({error:error.message});}
};

exports.resumeQueue = async (req, res) => {
  return res.status(409).json({ error: 'Use Scheduled Campaigns to resume an approved durable queue.', campaignsPath: '/campaigns' });
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
