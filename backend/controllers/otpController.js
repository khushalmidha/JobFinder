const { createMailbox } = require('../services/secureMailboxService');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');

/**
 * Searches the user's Gmail inbox via IMAP for recent verification codes / OTPs
 */
exports.getLatestOtp = async (req, res) => {
  const userId = req.user._id;
  let client, lock;
  try {
    const user = await User.findById(userId);

    if (!user || !user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      return res.status(400).json({ 
        error: 'Email configuration is missing. Please save your Gmail and App Password in Settings.' 
      });
    }

    client = await createMailbox(user.smtpConfig);

    await client.connect();
    lock = await client.getMailboxLock('INBOX');

    let detectedOtp = null;
    let matchDetails = null;

    try {
      // Search messages received in the last 15 minutes
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      let searchResult = (await client.search({ since: fifteenMinutesAgo })).slice(-20);

      if (!searchResult || searchResult.length === 0) {
        const total = client.mailbox?.exists || 0;
        if (total > 0) {
          const start = Math.max(1, total - 4);
          searchResult = `${start}:${total}`;
        }
      }

      const fetchedMessages = [];
      if (searchResult && (Array.isArray(searchResult) ? searchResult.length > 0 : true)) {
        for await (const msg of client.fetch(searchResult, { source: true, internalDate: true })) {
          fetchedMessages.push(msg);
        }
      }

      // Sort newest first
      fetchedMessages.sort((a, b) => new Date(b.internalDate || 0) - new Date(a.internalDate || 0));

      // Regex patterns for OTP / verification codes
      const otpRegexList = [
        /(?:code|otp|verification code|security code|one-time password|passcode|pin)[:\s-]*<b>?(\d{4,8})<\/b>?/i,
        /(?:code|otp|verification|passcode|pin)[^\d\n\r]{1,20}(\d{4,8})/i,
        /\b(\d{4,8})\b\s*(?:is your|to verify|as your verification code|is the one-time code)/i,
        /\bverification code:\s*(\d{4,8})\b/i,
        /\bOTP:\s*(\d{4,8})\b/i
      ];

      for (const item of fetchedMessages) {
        if (!item.internalDate || new Date(item.internalDate) < fifteenMinutesAgo || new Date(item.internalDate) > new Date()) continue;
        const parsed = await simpleParser(item.source);
        const subject = parsed.subject || '';
        const text = (parsed.text || '') + ' ' + (parsed.html || '');
        const from = parsed.from ? parsed.from.text : '';

        // Check subject first
        for (const rx of otpRegexList) {
          const subMatch = subject.match(rx);
          if (subMatch && subMatch[1]) {
            detectedOtp = subMatch[1];
            matchDetails = { subject, from, date: item.internalDate, source: 'subject' };
            break;
          }
        }

        if (detectedOtp) break;

        // Check body
        for (const rx of otpRegexList) {
          const bodyMatch = text.match(rx);
          if (bodyMatch && bodyMatch[1]) {
            detectedOtp = bodyMatch[1];
            matchDetails = { subject, from, date: item.internalDate, source: 'body' };
            break;
          }
        }

        if (detectedOtp) break;
      }
    } finally {
      lock.release(); lock = null;
    }

    if (detectedOtp) {
      return res.json({
        success: true,
        otp: detectedOtp,
        subject: matchDetails?.subject || '',
        from: matchDetails?.from || '',
        date: matchDetails?.date || new Date().toISOString(),
        message: `Extracted OTP ${detectedOtp} from recent email.`
      });
    }

    return res.status(404).json({
      success: false,
      error: 'No recent OTP or verification code found in your inbox (checked last 15 minutes).'
    });

  } catch (error) {
    console.error('Fetch OTP Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to access inbox. Ensure your Gmail App Password allows IMAP: ' + error.message
    });
  } finally {
    if (lock) lock.release();
    if (client) await client.logout().catch(() => client.close());
  }
};
