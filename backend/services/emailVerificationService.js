const crypto = require('node:crypto');
const User = require('../models/User');
const Challenge = require('../models/EmailVerificationChallenge');
const Budget = require('../models/EmailVerificationBudget');
const Receipt = require('../models/EmailVerificationReceipt');
const { validEmail } = require('./campaignService');

function verificationConfig() {
  const config = {
    enabled: process.env.EMAIL_VERIFICATION_ENABLED === 'true',
    host: process.env.EMAIL_VERIFICATION_SMTP_HOST || '',
    port: Number(process.env.EMAIL_VERIFICATION_SMTP_PORT || 465),
    username: process.env.EMAIL_VERIFICATION_SMTP_USER || '',
    password: process.env.EMAIL_VERIFICATION_SMTP_PASS || '',
    from: process.env.EMAIL_VERIFICATION_FROM || '',
    secret: process.env.EMAIL_VERIFICATION_TOKEN_SECRET || '',
    dailyLimit: Math.min(50,Math.max(1,Number(process.env.EMAIL_VERIFICATION_MAX_DAILY)||10))
  };
  config.configured = Boolean(config.host && [465,587].includes(config.port) && config.username && config.password && validEmail(config.from) && config.secret.length >= 32);
  return config;
}
function codeHash(config, user, code) {
  return crypto.createHmac('sha256', config.secret).update(JSON.stringify([String(user._id),user.email,code])).digest('hex');
}
async function reserveBudget(key,limit) {
  try {await Budget.updateOne({_id:key},{$setOnInsert:{used:0}},{upsert:true});} catch(error){if(error.code!==11000)throw error;}
  const reserved=await Budget.updateOne({_id:key,used:{$lt:limit}},{$inc:{used:1}});
  if(!reserved.matchedCount)throw new Error('Shared verification delivery budget reached; retry on the next UTC day');
}
function createEmailVerificationService({ config = verificationConfig, sendCode, clock = () => new Date() } = {}) {
  async function getUser(userId) {
    const user = await User.findById(userId).select('email emailVerified emailVerifiedAt').lean();
    if (!user) throw new Error('Account not found');
    if (!validEmail(user.email)) throw new Error('Stored account email is invalid');
    return user;
  }
  function requireEnabled() {
    const settings = config();
    if (!settings.enabled || !settings.configured) throw new Error('Email verification is unavailable until an operator configures and enables a trusted server sender');
    return settings;
  }
  async function status(userId) {
    const user = await getUser(userId), settings = config();
    const row = await Challenge.findById(userId).lean();
    return { email:user.email, verified:user.emailVerified === true, verifiedAt:user.emailVerifiedAt || null,
      available:settings.enabled && settings.configured, pending:row?.state === 'sent' && row.email === user.email && row.expiresAt > clock(),
      expiresAt:row?.state === 'sent' ? row.expiresAt : null,
      message:settings.enabled && settings.configured ? 'Request a code only when you are ready to open your registered inbox.' : 'Operator setup of a trusted verification sender is required. Outreach sender settings cannot verify account ownership.' };
  }
  async function requestCode(userId, { approved = false } = {}) {
    if (approved !== true) throw new Error('Explicitly request delivery of a verification code to your registered email');
    const settings = requireEnabled(), user = await getUser(userId), now = clock();
    if (user.emailVerified) throw new Error('Account email is already verified');
    try { await Challenge.updateOne({_id:userId}, {$setOnInsert:{email:user.email,state:'idle',requestsToday:0,attempts:0,createdAt:now,updatedAt:now}}, {upsert:true,timestamps:false}); }
    catch(error) { if(error.code !== 11000) throw error; }
    // A process interruption never leaves a code usable without recorded send
    // acceptance. Resend still consumes the existing daily request allowance.
    await Challenge.updateOne({_id:userId,state:{$in:['sending','consuming']},operationStartedAt:{$lte:new Date(+now-120000)}}, {$set:{state:'failed',outcome:'Interrupted verification operation; request a new code'},$unset:{codeHash:1}});
    const day = now.toISOString().slice(0,10);
    await Challenge.updateOne({_id:userId,day:{$ne:day},state:{$nin:['sending','consuming','consumed']}}, {$set:{day,requestsToday:0}});
    const code = crypto.randomBytes(8).toString('hex'), generation = crypto.randomUUID();
    const row = await Challenge.findOneAndUpdate({_id:userId,day,requestsToday:{$lt:3},state:{$nin:['sending','consuming','consumed']},$or:[{requestedAt:{$exists:false}},{requestedAt:{$lte:new Date(+now-60000)}}]},
      {$set:{email:user.email,generation,codeHash:codeHash(settings,user,code),state:'sending',requestedAt:now,operationStartedAt:now,expiresAt:new Date(+now+600000),attempts:0,outcome:''},$inc:{requestsToday:1},$unset:{consumedAt:1}}, {returnDocument:'after'});
    if (!row) throw new Error('Verification request limit reached: wait at least 60 seconds; maximum 3 requests per UTC day');
    try {
      // Shared normalized-recipient and server caps prevent case-variant signup
      // accounts from multiplying delivery to the same mailbox or provider.
      const mailboxKey=crypto.createHash('sha256').update(user.email.trim().toLowerCase()).digest('hex');
      await reserveBudget(`mailbox:${day}:${mailboxKey}`,3);
      await reserveBudget(`server:${day}`,Number.isInteger(settings.dailyLimit)?Math.min(50,Math.max(1,settings.dailyLimit)):10);
    }catch(error){
      await Challenge.updateOne({_id:userId,generation,state:'sending'},{$set:{state:'failed',outcome:'Shared verification budget reached'},$unset:{codeHash:1}});
      throw error;
    }
    try {
      // The sender is server-owned configuration, never a user-controlled SMTP
      // account. A malicious user cannot capture their own verification code by
      // pointing their outreach sender at a server they control.
      await (sendCode || require('./emailVerificationTransport').sendVerificationCode)(settings, {recipient:user.email,code});
      const recorded = await Challenge.updateOne({_id:userId,generation,state:'sending'}, {$set:{state:'sent',outcome:'Verification message accepted by trusted sender'}});
      if (!recorded.matchedCount) throw new Error('Verification attempt interrupted');
      return { requested:true, email:user.email, expiresAt:new Date(+now+600000), message:'Open your registered inbox and enter its 16-character verification code. No recruiter was emailed.' };
    } catch(error) {
      await Challenge.updateOne({_id:userId,generation,state:'sending'}, {$set:{state:'failed',outcome:'Delivery could not be confirmed; code invalidated'},$unset:{codeHash:1}});
      throw new Error('Verification delivery could not be confirmed. Wait before requesting a new code.');
    }
  }
  async function confirmCode(userId, input) {
    const settings = requireEnabled(), user = await getUser(userId), now = clock();
    if (user.emailVerified) throw new Error('Account email is already verified');
    const code = typeof input === 'string' ? input.trim().toLowerCase() : '';
    const row = await Challenge.findById(userId).select('+codeHash').lean();
    const valid = row && row.email === user.email && row.state === 'sent' && row.expiresAt > now && row.attempts < 5;
    const hash = /^[a-f0-9]{16}$/.test(code) ? codeHash(settings,user,code) : '';
    const equal = valid && hash && typeof row.codeHash === 'string' && row.codeHash.length === hash.length && crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(row.codeHash));
    if (!equal) {
      if(valid)await Challenge.updateOne({_id:userId,generation:row.generation,state:'sent',attempts:{$lt:5}}, {$inc:{attempts:1}});
      throw new Error('Invalid, expired or exhausted verification code');
    }
    const consumed = await Challenge.findOneAndUpdate({_id:userId,generation:row.generation,email:user.email,state:'sent',codeHash:hash,attempts:{$lt:5},expiresAt:{$gt:now}}, {$set:{state:'consuming',operationStartedAt:now,consumedAt:now},$unset:{codeHash:1}}, {returnDocument:'after'});
    if (!consumed) throw new Error('Verification code already consumed or changed');
    // A durable receipt precedes the User proof. An interrupted old confirmation
    // may finish after challenge recovery/resend; its genuine consumption must
    // remain auditable instead of relying on the mutable current challenge row.
    await Receipt.create({_id:row.generation,userId,email:user.email,consumedAt:now});
    const verified = await User.updateOne({_id:userId,email:user.email,emailVerified:{$ne:true}}, {$set:{emailVerified:true,emailVerifiedAt:now,emailVerificationProof:{method:'email_code',issuer:'jobfinder_trusted_server_sender',subject:user.email,verifiedAt:now,challengeId:row.generation}}});
    if (!verified.matchedCount) {
      await Challenge.updateOne({_id:userId,generation:row.generation,state:'consuming'}, {$set:{state:'failed',outcome:'Account changed before verification'}});
      throw new Error('Account changed before verification; request a new code');
    }
    await Challenge.updateOne({_id:userId,generation:row.generation,state:'consuming'}, {$set:{state:'consumed',outcome:'Registered email ownership verified'}});
    return {verified:true,verifiedAt:now,message:'Account email verified. Administrator promotion and company import remain separate controlled actions.'};
  }
  return {status,requestCode,confirmCode};
}
module.exports = {verificationConfig,createEmailVerificationService};
