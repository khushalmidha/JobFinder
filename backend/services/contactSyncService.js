const User = require('../models/User');
const Contact = require('../models/Contact');

/**
 * One-way syncs contacts imported by sourceUserId to all accounts specified in sourceUser.syncedAccountEmails.
 * This is strictly one-way and will never sync contacts back from target accounts to source.
 * 
 * @param {string|ObjectId} sourceUserId - The user who imported the contacts
 * @param {Array<Object>} contactsToSync - The contacts that were newly inserted
 */
async function syncContactsToTargetAccounts(sourceUserId, contactsToSync) {
  try {
    if (!contactsToSync || contactsToSync.length === 0) {
      return { syncedAccounts: 0, totalSynced: 0 };
    }

    const sourceUser = await User.findById(sourceUserId).select('syncedAccountEmails email');
    if (!sourceUser || !sourceUser.syncedAccountEmails || sourceUser.syncedAccountEmails.length === 0) {
      return { syncedAccounts: 0, totalSynced: 0 };
    }

    // Exclude the source user's own email
    const targetEmails = sourceUser.syncedAccountEmails
      .map(e => (e || '').trim())
      .filter(e => e && e.toLowerCase() !== (sourceUser.email || '').toLowerCase());

    if (targetEmails.length === 0) {
      return { syncedAccounts: 0, totalSynced: 0 };
    }

    // Find all matching registered target users
    const regexList = targetEmails.map(e => new RegExp(`^${e.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i'));
    // A source account cannot copy contacts into an arbitrary user's account.
    const targetUsers = await User.find({ email: { $in: regexList }, syncedAccountEmails: sourceUser.email });

    if (targetUsers.length === 0) {
      console.log(`[ContactSync] No registered target users found for emails:`, targetEmails);
      return { syncedAccounts: 0, totalSynced: 0 };
    }

    let totalSynced = 0;
    let syncedAccountsCount = 0;

    for (const targetUser of targetUsers) {
      // Fetch target user's existing contacts to ensure 0 duplicates
      const targetExisting = await Contact.find({ userId: targetUser._id }).select('email').lean();
      const existingEmailSet = new Set(targetExisting.map(c => (c.email || '').toLowerCase().trim()));

      const toInsertForTarget = [];
      for (const contact of contactsToSync) {
        const contactEmail = (contact.email || '').toLowerCase().trim();
        if (contactEmail && !existingEmailSet.has(contactEmail)) {
          existingEmailSet.add(contactEmail); // avoid duplicates within the incoming batch
          toInsertForTarget.push({
            userId: targetUser._id,
            company: contact.company || 'Unknown',
            hrName: contact.hrName || '',
            email: contact.email,
            package: contact.package || '',
            role: contact.role || '',
            source: contact.source || 'excel_upload',
            linkedinUrl: contact.linkedinUrl || '',
            status: 'pending',
            deliverabilityStatus: contact.deliverabilityStatus || 'unverified',
            companyId: contact.companyId,
            provenance: contact.provenance || [],
            verificationStatus: contact.verificationStatus || 'unknown',
            inferenceFlag: !!contact.inferenceFlag,
            suppressedAt: contact.suppressedAt,
            suppressionReason: contact.suppressionReason,
            optOutAt: contact.optOutAt,
            validationReason: contact.validationReason || '',
            validatedAt: contact.validatedAt || new Date(),
            notes: contact.notes || ''
          });
        }
      }

      if (toInsertForTarget.length > 0) {
        await Contact.insertMany(toInsertForTarget, { ordered: false });
        totalSynced += toInsertForTarget.length;
        syncedAccountsCount++;
        console.log(`[ContactSync] Successfully one-way synced ${toInsertForTarget.length} contacts from ${sourceUser.email} to ${targetUser.email}`);
      }
    }

    return { syncedAccounts: syncedAccountsCount, totalSynced };
  } catch (err) {
    console.error('[ContactSync Error]:', err.message);
    return { error: err.message };
  }
}

module.exports = { syncContactsToTargetAccounts };
