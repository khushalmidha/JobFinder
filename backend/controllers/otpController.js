const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const User = require('../models/User');

/**
 * Searches the user's Gmail inbox via IMAP for recent verification codes / OTPs
 */
exports.getLatestOtp = async (req, res) => {
  const userId = req.user._id;
  try {
    const user = await User.findById(userId);

    if (!user || !user.smtpConfig || !user.smtpConfig.user || !user.smtpConfig.pass) {
      return res.status(400).json({ 
        error: 'Email configuration is missing. Please save your Gmail and App Password in Settings.' 
      });
    }

    const config = {
      imap: {
        user: user.smtpConfig.user,
        password: user.smtpConfig.pass,
        host: user.smtpConfig.host || 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 7000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    // Search messages received in the last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const searchCriteria = [
      ['SINCE', fifteenMinutesAgo.toISOString()]
    ];

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT'],
      markSeen: false,
      struct: true
    };

    let messages = await connection.search(searchCriteria, fetchOptions);

    // If no recent message in 15 min, look at last 5 messages in inbox
    if (!messages || messages.length === 0) {
      const allSearch = ['ALL'];
      const lastMessages = await connection.search(allSearch, { bodies: ['HEADER', 'TEXT'], markSeen: false });
      messages = lastMessages.slice(-5);
    }

    // Sort newest first
    messages.sort((a, b) => {
      const dateA = new Date(a.attributes?.date || 0);
      const dateB = new Date(b.attributes?.date || 0);
      return dateB - dateA;
    });

    let detectedOtp = null;
    let matchDetails = null;

    // Regex patterns for OTP / verification codes
    const otpRegexList = [
      /(?:code|otp|verification code|security code|one-time password|passcode|pin)[:\s-]*<b>?(\d{4,8})<\/b>?/i,
      /(?:code|otp|verification|passcode|pin)[^\d\n\r]{1,20}(\d{4,8})/i,
      /\b(\d{4,8})\b\s*(?:is your|to verify|as your verification code|is the one-time code)/i,
      /\bverification code:\s*(\d{4,8})\b/i,
      /\bOTP:\s*(\d{4,8})\b/i
    ];

    for (const item of messages) {
      const part = item.parts.find(p => p.which === 'TEXT');
      if (!part) continue;

      const id = item.attributes.uid;
      const parsed = await simpleParser("Imap-Id: " + id + "\r\n" + part.body);
      const subject = parsed.subject || '';
      const text = (parsed.text || '') + ' ' + (parsed.html || '');
      const from = parsed.from ? parsed.from.text : '';

      // Check subject first
      for (const rx of otpRegexList) {
        const subMatch = subject.match(rx);
        if (subMatch && subMatch[1]) {
          detectedOtp = subMatch[1];
          matchDetails = { subject, from, date: item.attributes.date, source: 'subject' };
          break;
        }
      }

      if (detectedOtp) break;

      // Check body
      for (const rx of otpRegexList) {
        const bodyMatch = text.match(rx);
        if (bodyMatch && bodyMatch[1]) {
          detectedOtp = bodyMatch[1];
          matchDetails = { subject, from, date: item.attributes.date, source: 'body' };
          break;
        }
      }

      if (detectedOtp) break;
    }

    connection.end();

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
  }
};
