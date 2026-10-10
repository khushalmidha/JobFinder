const crypto = require('crypto');
const Contact = require('../models/Contact');
const User = require('../models/User');
const AccessRequest = require('../models/AccessRequest');
const { 
  CURATED_RECRUITERS, 
  importCuratedRecruiters, 
  ingestRecruiterSheet, 
  generateRecruiterSpreadsheet 
} = require('../services/recruiterScoutService');
const { 
  ADMIN_EMAIL, 
  sendAccessRequestEmail, 
  sendApprovalGrantedEmail 
} = require('../utils/approvalMailer');

/**
 * Helper to verify if user has access to Shared Contacts
 * Khushal Midha (admin) always has unrestricted access.
 * Other users must be approved by Khushal.
 */
function hasSharedAccess(user) {
  if (!user) return false;
  const email = (user.email || '').toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase() || email === 'midhakhushal5@gmail.com') {
    return true;
  }
  return user.role === 'admin' || user.isSharedContactApproved === true;
}

/**
 * Check current user's access status
 */
exports.getAccessStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isOwner = (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase() || (user.email || '').toLowerCase() === 'midhakhushal5@gmail.com';
    const access = hasSharedAccess(user);

    // Check if there is a pending request
    const pendingReq = await AccessRequest.findOne({ 
      requesterEmail: user.email.toLowerCase(), 
      status: 'pending' 
    });

    res.json({
      hasAccess: access,
      isOwner,
      status: access ? 'approved' : (pendingReq ? 'pending' : 'none'),
      adminEmail: ADMIN_EMAIL
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Submit an Access Request for the Shared Contacts
 */
exports.requestAccess = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { reason = '' } = req.body;
    const name = user?.name || req.body.name || 'Job Seeker';
    const email = user?.email?.toLowerCase() || req.body.email?.toLowerCase();

    if (!email) return res.status(400).json({ error: 'Email is required' });

    if (hasSharedAccess(user)) {
      return res.json({ message: 'You already have approved access to the shared contacts!', hasAccess: true });
    }

    // Check if pending request exists
    let existing = await AccessRequest.findOne({ requesterEmail: email, status: 'pending' });
    const token = crypto.randomBytes(24).toString('hex');

    if (existing) {
      existing.requesterReason = reason || existing.requesterReason;
      existing.approvalToken = token;
      await existing.save();
    } else {
      existing = new AccessRequest({
        requesterName: name,
        requesterEmail: email,
        requesterReason: reason,
        requesterUserId: user?._id,
        approvalToken: token
      });
      await existing.save();
    }

    // Base URL for email callback
    const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    
    // Send email to khushalmidha24@gmail.com
    await sendAccessRequestEmail({
      requesterName: name,
      requesterEmail: email,
      requesterReason: reason,
      token,
      baseUrl
    });

    res.json({
      message: `Access request submitted! An approval email has been sent to Khushal Midha (${ADMIN_EMAIL}). Once approved, you will be able to access the contacts.`,
      status: 'pending',
      requestId: existing._id
    });
  } catch (err) {
    console.error('Request Access Error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 1-Click Approve Access Request (Triggered from Khushal's Email)
 */
exports.approveAccessRequest = async (req, res) => {
  try {
    const { token } = req.params;
    const request = await AccessRequest.findOne({ approvalToken: token });

    if (!request) {
      return res.status(404).send(`
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #09090b; color: #fff; min-height: 100vh;">
          <h2 style="color: #ef4444;">⚠️ Invalid or Expired Token</h2>
          <p>This approval link is invalid or has already been used.</p>
        </div>
      `);
    }

    request.status = 'approved';
    request.approvedAt = new Date();
    await request.save();

    // Update user in DB
    await User.updateOne(
      { email: request.requesterEmail.toLowerCase() },
      { $set: { isSharedContactApproved: true } }
    );

    // Notify the requester
    const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173/jobs';
    sendApprovalGrantedEmail({
      requesterEmail: request.requesterEmail,
      requesterName: request.requesterName,
      portalUrl
    });

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Access Approved | JobFinder</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;">
          <div style="background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); color: #10b981; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 16px;">
              ✓
            </div>
            <h2 style="color: #fafafa; font-size: 22px; margin: 0 0 8px;">Access Request Approved!</h2>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5; margin: 0 0 20px;">
              You have successfully granted access to <strong>${request.requesterName}</strong> (<span style="color: #eab308;">${request.requesterEmail}</span>).
            </p>
            <div style="background: #27272a; border-radius: 8px; padding: 12px; font-size: 12px; color: #34d399; margin-bottom: 24px;">
              ✓ Requester has been notified via confirmation email.<br>
              ✓ Database access permission activated immediately.
            </div>
            <p style="color: #71717a; font-size: 11px;">You may safely close this window.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
};

/**
 * 1-Click Reject Access Request (Triggered from Khushal's Email)
 */
exports.rejectAccessRequest = async (req, res) => {
  try {
    const { token } = req.params;
    const request = await AccessRequest.findOne({ approvalToken: token });

    if (!request) {
      return res.status(404).send('Invalid or expired request token.');
    }

    request.status = 'rejected';
    request.rejectedAt = new Date();
    await request.save();

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Access Rejected | JobFinder</title>
        </head>
        <body style="font-family: sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
          <div style="background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 36px; max-width: 440px; text-align: center;">
            <div style="font-size: 32px; margin-bottom: 12px;">🚫</div>
            <h2 style="color: #ef4444; margin: 0 0 8px;">Request Rejected</h2>
            <p style="color: #a1a1aa; font-size: 14px;">Access for <strong>${request.requesterEmail}</strong> was rejected.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
};

/**
 * Admin view of all requests (Khushal only)
 */
exports.getAdminRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || ((user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase() && (user.email || '').toLowerCase() !== 'midhakhushal5@gmail.com')) {
      return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
    }

    const requests = await AccessRequest.find().sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Admin direct approve/reject from UI
 */
exports.adminReviewRequest = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || ((user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase() && (user.email || '').toLowerCase() !== 'midhakhushal5@gmail.com')) {
      return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
    }

    const { requestId, action } = req.body;
    const request = await AccessRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (action === 'approve') {
      request.status = 'approved';
      request.approvedAt = new Date();
      await request.save();

      await User.updateOne(
        { email: request.requesterEmail.toLowerCase() },
        { $set: { isSharedContactApproved: true } }
      );

      const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173/jobs';
      sendApprovalGrantedEmail({
        requesterEmail: request.requesterEmail,
        requesterName: request.requesterName,
        portalUrl
      });

      return res.json({ message: 'Request approved successfully! Requester notified.', request });
    } else {
      request.status = 'rejected';
      request.rejectedAt = new Date();
      await request.save();
      return res.json({ message: 'Request rejected.', request });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get curated list of Indian Tech Recruiters
 * Protected: Requires Khushal's explicit approval
 */
exports.getCurated = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!hasSharedAccess(user)) {
      return res.status(403).json({
        error: 'ACCESS_RESTRICTED',
        requiresApproval: true,
        message: 'Master Recruiter & Shared Contact Directory is private. Please submit an access request to khushalmidha24@gmail.com to view.'
      });
    }

    const userId = req.user._id;
    const userContacts = await Contact.find({ userId }).select('email').lean();
    const existingEmails = new Set(userContacts.map(c => c.email.toLowerCase()));

    const enriched = CURATED_RECRUITERS.map(r => ({
      ...r,
      isImported: existingEmails.has(r.email.toLowerCase())
    }));

    res.json({
      recruiters: enriched,
      totalCount: enriched.length,
      importedCount: enriched.filter(r => r.isImported).length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Bulk import curated recruiters into the user's ColdMail contact database
 */
exports.importCurated = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!hasSharedAccess(user)) {
      return res.status(403).json({
        error: 'ACCESS_RESTRICTED',
        requiresApproval: true,
        message: 'Access restricted. Please request approval from Khushal Midha.'
      });
    }

    const userId = req.user._id;
    const result = await importCuratedRecruiters(userId);
    res.json({
      message: `Successfully imported ${result.addedCount} new Indian Tech recruiters into your contacts.`,
      result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Upload a custom Excel or CSV sheet of recruiters and import them
 */
exports.uploadSheet = async (req, res) => {
  try {
    const userId = req.user._id;
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Please upload an Excel (.xlsx/.xls) or CSV file.' });
    }

    const result = await ingestRecruiterSheet(userId, req.file.buffer);
    res.json({
      message: `Processed sheet. Added ${result.addedCount} new recruiters, skipped ${result.skippedCount} duplicates.`,
      result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Download Excel (.xlsx) sheet of Indian Tech recruiters
 * Protected: Requires Khushal's explicit approval
 */
exports.exportSheet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!hasSharedAccess(user)) {
      return res.status(403).json({
        error: 'ACCESS_RESTRICTED',
        requiresApproval: true,
        message: 'Access restricted. Please request approval from Khushal Midha.'
      });
    }

    const userId = req.user._id;
    const buffer = await generateRecruiterSpreadsheet(userId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Indian_Tech_Recruiters_Sheet_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('Export Recruiters Error:', err);
    res.status(500).json({ error: 'Failed to generate recruiter sheet' });
  }
};

/**
 * Harvest and import recruiter leads directly from Apollo.io and/or Hunter.io
 */
exports.harvestAgencies = async (req, res) => {
  try {
    const userId = req.user._id;
    const { domains, targetAgency = 'both', customTitles, limit = 20 } = req.body;
    const { harvestRecruiterLeads } = require('../services/leadAgencyService');

    const result = await harvestRecruiterLeads({
      userId,
      domains,
      targetAgency,
      customTitles,
      limit: Number(limit)
    });

    res.json({
      message: `Harvester completed! Added ${result.addedCount} new recruiter emails, skipped ${result.skippedCount} existing.`,
      result
    });
  } catch (err) {
    console.error('Harvest Agencies Error:', err);
    res.status(400).json({ error: err.message });
  }
};
