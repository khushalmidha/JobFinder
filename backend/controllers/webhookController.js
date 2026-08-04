const MailLog = require('../models/MailLog');
const Contact = require('../models/Contact');

exports.handleBounceWebhook = async (req, res) => {
  try {
    // This is a generic example (e.g. Resend payload structure might vary slightly)
    const payload = req.body;
    
    // Assuming the webhook provider sends messageId and status
    // For Resend: payload.data.email_id
    // For SendGrid: payload[0].sg_message_id
    
    // Let's implement a simplified generic handler that expects { messageId, status, bounceReason }
    // In a real scenario, you parse specific provider's payload structure
    const messageId = payload.messageId || (payload.data && payload.data.email_id);
    const eventType = payload.type || payload.event; // 'email.bounced' or 'bounce'

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID missing' });
    }

    if (eventType && eventType.includes('bounce')) {
      const log = await MailLog.findOneAndUpdate(
        { providerMessageId: messageId },
        { status: 'bounced', bounceReason: payload.reason || 'Bounced via webhook' },
        { new: true }
      );
      
      if (log) {
        await Contact.findByIdAndUpdate(log.contactId, { status: 'bounced' });
      }
    }

    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal server error');
  }
};
