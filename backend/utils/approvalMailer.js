const nodemailer = require('nodemailer');
const User = require('../models/User');

const ADMIN_EMAIL = 'khushalmidha24@gmail.com';

/**
 * Sends access request notification email to Khushal Midha with 1-click Approve / Reject links
 */
async function sendAccessRequestEmail({ requesterName, requesterEmail, requesterReason, token, baseUrl }) {
  try {
    const adminUser = await User.findOne({ 
      $or: [{ email: ADMIN_EMAIL }, { email: 'midhakhushal5@gmail.com' }] 
    });

    const approveUrl = `${baseUrl}/api/recruiters/access-requests/${token}/approve`;
    const rejectUrl = `${baseUrl}/api/recruiters/access-requests/${token}/reject`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #f4f4f5; border: 1px solid #27272a; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #eab308, #ca8a04); padding: 20px; color: #09090b;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 800;">🚨 [JobFinder] New Shared Contacts Access Request</h2>
          <p style="margin: 4px 0 0; font-size: 13px; font-weight: 600;">Someone wants access to your Master Recruiter & HR Directory</p>
        </div>
        
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #d4d4d8; margin-top: 0;">
            A user has requested permission to access and download your <strong>Master Tech Recruiters & Shared Contacts Sheet</strong>:
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
            <tr>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #a1a1aa; width: 30%;">Requester Name:</td>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #fafafa; font-weight: 700;">${requesterName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #a1a1aa;">Requester Email:</td>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #eab308; font-weight: 700; font-family: monospace;">${requesterEmail}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #a1a1aa;">Reason:</td>
              <td style="padding: 8px 12px; background: #18181b; border: 1px solid #27272a; color: #e4e4e7;">${requesterReason || 'Looking for verified recruiter contacts.'}</td>
            </tr>
          </table>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${approveUrl}" style="background: #10b981; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; margin-right: 12px; box-shadow: 0 4px 12px rgba(16,185,129,0.3);">
              ✅ Approve Access (1-Click)
            </a>
            <a href="${rejectUrl}" style="background: #ef4444; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(239,68,68,0.3);">
              ❌ Reject Request
            </a>
          </div>

          <p style="font-size: 11px; color: #71717a; text-align: center; border-top: 1px solid #27272a; padding-top: 16px;">
            This email was sent to ${ADMIN_EMAIL}. Non-approved users cannot view or download your verified recruiter database.
          </p>
        </div>
      </div>
    `;

    // Attempt sending via admin's configured SMTP / Brevo if present
    if (adminUser?.brevoApiKey) {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': adminUser.brevoApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'JobFinder Security', email: adminUser.email || 'noreply@jobfinder.com' },
          to: [{ email: ADMIN_EMAIL }],
          subject: `🚨 [JobFinder Access Request] ${requesterName} requested access to Shared Contacts`,
          htmlContent,
        }),
      });
      return { success: response.ok };
    }

    if (adminUser?.smtpConfig?.user && adminUser?.smtpConfig?.pass) {
      const transporter = nodemailer.createTransport({
        host: adminUser.smtpConfig.host || 'smtp.gmail.com',
        port: adminUser.smtpConfig.port || 465,
        secure: adminUser.smtpConfig.port === 465,
        auth: {
          user: adminUser.smtpConfig.user,
          pass: adminUser.smtpConfig.pass,
        },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: `"JobFinder Security" <${adminUser.smtpConfig.user}>`,
        to: ADMIN_EMAIL,
        subject: `🚨 [JobFinder Access Request] ${requesterName} requested access to Shared Contacts`,
        html: htmlContent
      });
      return { success: true };
    }

    console.log(`[Approval Email Mock] Access request generated for ${requesterEmail}. Approve link: ${approveUrl}`);
    return { success: true, simulated: true, approveUrl };
  } catch (err) {
    console.error('Failed to send approval email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Sends confirmation email to requester once Khushal approves
 */
async function sendApprovalGrantedEmail({ requesterEmail, requesterName, portalUrl }) {
  try {
    const adminUser = await User.findOne({ 
      $or: [{ email: ADMIN_EMAIL }, { email: 'midhakhushal5@gmail.com' }] 
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #09090b; color: #f4f4f5; border: 1px solid #27272a; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 800;">🎉 Access Granted!</h2>
          <p style="margin: 4px 0 0; font-size: 13px;">Khushal Midha has approved your access to JobFinder Shared Contacts</p>
        </div>
        
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #d4d4d8; margin-top: 0;">
            Hi <strong>${requesterName}</strong>,
          </p>
          <p style="font-size: 13px; color: #d4d4d8; line-height: 1.5;">
            Your request to access the verified Indian Tech Recruiters & HR Contact Database has been <strong>approved</strong>. You can now view and download recruiter spreadsheets on the portal.
          </p>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${portalUrl || 'http://localhost:5173/jobs'}" style="background: #eab308; color: #09090b; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 800; font-size: 14px; display: inline-block;">
              🚀 Open Recruiter Sheet & Job Portal
            </a>
          </div>
        </div>
      </div>
    `;

    if (adminUser?.smtpConfig?.user && adminUser?.smtpConfig?.pass) {
      const transporter = nodemailer.createTransport({
        host: adminUser.smtpConfig.host || 'smtp.gmail.com',
        port: adminUser.smtpConfig.port || 465,
        secure: adminUser.smtpConfig.port === 465,
        auth: {
          user: adminUser.smtpConfig.user,
          pass: adminUser.smtpConfig.pass,
        },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: `"Khushal Midha (JobFinder)" <${adminUser.smtpConfig.user}>`,
        to: requesterEmail,
        subject: `🎉 [JobFinder] Your Shared Contacts Access Request has been Approved!`,
        html: htmlContent
      });
    }
  } catch (err) {
    console.error('Failed to send approval granted email:', err);
  }
}

module.exports = {
  ADMIN_EMAIL,
  sendAccessRequestEmail,
  sendApprovalGrantedEmail
};
