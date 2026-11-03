const Contact = require('../models/Contact');
const { GoogleGenAI } = require('@google/genai');
const { syncContactsToTargetAccounts } = require('../services/contactSyncService');

const contactCache = new Map();
const CACHE_TTL_MS = 25000; // 25 seconds cache

function invalidateContactCache(userId) {
  if (userId) {
    contactCache.delete(userId.toString());
  } else {
    contactCache.clear();
  }
}
exports.invalidateContactCache = invalidateContactCache;

exports.getContacts = async (req, res) => {
  try {
    const { company, status, minPackage, maxPackage, search, isShared, deliverabilityStatus } = req.query;
    const isUnfiltered = !company && !status && !minPackage && !maxPackage && !search && isShared === undefined && !deliverabilityStatus;
    const cacheKey = req.user._id.toString();

    // Serve from in-memory cache instantly (< 5ms) if available
    if (isUnfiltered) {
      const cached = contactCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return res.json(cached.data);
      }
    }

    let query = { userId: req.user._id };

    if (company) query.company = { $regex: new RegExp(company, 'i') };
    if (status) {
      if (status === 'replied') {
        query.status = { $in: ['replied', 'reply_received', 'positive_response', 'negative_response'] };
      } else {
        query.status = status;
      }
    }
    if (isShared !== undefined) {
      query.isShared = isShared === 'true';
    }
    if (deliverabilityStatus) {
      if (deliverabilityStatus === 'valid') {
        query.deliverabilityStatus = { $ne: 'invalid' };
      } else if (deliverabilityStatus === 'invalid') {
        query.deliverabilityStatus = 'invalid';
      } else {
        query.deliverabilityStatus = deliverabilityStatus;
      }
    }
    if (search) query.$or = [
      { company: { $regex: new RegExp(search, 'i') } },
      { hrName: { $regex: new RegExp(search, 'i') } },
      { email: { $regex: new RegExp(search, 'i') } },
      { role: { $regex: new RegExp(search, 'i') } }
    ];

    const contacts = await Contact.find(query)
      .select('company hrName email package role source linkedinUrl status isShared deliverabilityStatus validationReason replySnippet lastMailedAt repliedAt notes createdAt')
      .sort({ createdAt: -1 })
      .lean();

    if (isUnfiltered) {
      contactCache.set(cacheKey, { data: contacts, timestamp: Date.now() });
    }

    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCompanies = async (req, res) => {
  try {
    const companies = await Contact.distinct('company', { userId: req.user._id });
    // Filter out empty and Unknown, then sort
    const validCompanies = companies
      .filter(c => c && c.trim() && c.toLowerCase() !== 'unknown')
      .sort((a, b) => a.localeCompare(b));
    res.json(validCompanies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bulkCreate = async (req, res) => {
  try {
    const { contacts } = req.body;
    const existingCompanies = await Contact.distinct('company', { userId: req.user._id });

    // Split multiple emails into separate contacts
    let flattenedContacts = [];
    for (const c of contacts) {
      if (c.email && c.email.match(/[\s,;]/)) {
        const emails = c.email.split(/[\s,;]+/).filter(e => e.trim());
        for (const e of emails) {
          flattenedContacts.push({ ...c, email: e.trim() });
        }
      } else {
        flattenedContacts.push(c);
      }
    }
    
    // Format contacts with userId and enforce consistent company casing
    const toInsert = flattenedContacts.map(c => {
      let comp = (c.company && c.company.trim()) ? c.company.trim() : 'Unknown';
      
      if (comp.toLowerCase() !== 'unknown') {
        const lowerComp = comp.toLowerCase();
        // 1. Exact case-insensitive match
        let match = existingCompanies.find(n => n.toLowerCase() === lowerComp);
        
        // 2. Suffix removal match (e.g. "Zeptonow" -> "Zepto", "Yellow ai" -> "Yellow")
        if (!match && (lowerComp.endsWith('now') || lowerComp.endsWith('ai') || lowerComp.endsWith(' games'))) {
           match = existingCompanies.find(n => {
             const nLower = n.toLowerCase();
             return lowerComp.startsWith(nLower) || nLower.startsWith(lowerComp);
           });
        }
        
        if (match) comp = match;
      }

      return {
        ...c,
        company: comp,
        userId: req.user._id,
        source: c.source || 'extension'
      };
    });
    
    // Deduplicate the incoming payload itself (keep first occurrence)
    const uniqueIncoming = [];
    const seenIncomingEmails = new Set();
    for (const c of toInsert) {
      if (!seenIncomingEmails.has(c.email)) {
        seenIncomingEmails.add(c.email);
        uniqueIncoming.push(c);
      }
    }

    // O(1) deduplication against existing database based on email for this user
    const existingEmailDocs = await Contact.find({ userId: req.user._id }).select('email').lean();
    const existingEmailSet = new Set(existingEmailDocs.map(c => (c.email || '').toLowerCase().trim()));
    const newContacts = uniqueIncoming.filter(c => !existingEmailSet.has(c.email.toLowerCase().trim()));

    if (newContacts.length === 0) {
      return res.status(200).json({ message: 'No new contacts to add (all were duplicates)', added: 0 });
    }

    // Fast syntax validation (instant 0ms check, no blocking network delays)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const c of newContacts) {
      if (!emailRegex.test(c.email)) {
        c.deliverabilityStatus = 'invalid';
        c.validationReason = 'Invalid email syntax';
        c.validatedAt = new Date();
      } else {
        c.deliverabilityStatus = 'unverified';
      }
    }

    // Insert all contacts with ordered: false so individual errors don't abort the entire sheet
    let inserted = [];
    try {
      inserted = await Contact.insertMany(newContacts, { ordered: false });
    } catch (insertError) {
      if (insertError.insertedDocs && insertError.insertedDocs.length > 0) {
        inserted = insertError.insertedDocs;
      } else {
        throw insertError;
      }
    }

    // Automatically one-way sync newly imported contacts to configured target accounts
    syncContactsToTargetAccounts(req.user._id, inserted).catch(syncErr => {
      console.error('Contact one-way sync error:', syncErr);
    });

    invalidateContactCache(req.user._id);

    // Respond IMMEDIATELY so the client NEVER times out!
    res.status(201).json({ 
      message: `Successfully added ${inserted.length} contacts`, 
      added: inserted.length, 
      contacts: inserted 
    });

    // Run deep DNS MX & deliverability verification asynchronously in the background
    setImmediate(async () => {
      try {
        const { validateEmail } = require('../services/emailDeliverabilityService');
        const BATCH_SIZE = 10;
        for (let i = 0; i < inserted.length; i += BATCH_SIZE) {
          const slice = inserted.slice(i, i + BATCH_SIZE);
          await Promise.all(slice.map(async (doc) => {
            if (doc.deliverabilityStatus === 'unverified') {
              try {
                const val = await validateEmail(doc.email);
                if (!val.isValid) {
                  await Contact.updateOne(
                    { _id: doc._id }, 
                    { 
                      deliverabilityStatus: 'invalid', 
                      validationReason: val.reason || 'Failed DNS MX check', 
                      validatedAt: new Date() 
                    }
                  );
                } else {
                  await Contact.updateOne(
                    { _id: doc._id }, 
                    { 
                      deliverabilityStatus: 'valid', 
                      validatedAt: new Date() 
                    }
                  );
                }
              } catch (e) {
                // Ignore transient background error
              }
            }
          }));
        }
      } catch (bgErr) {
        console.error('Background deliverability verification error:', bgErr.message);
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    invalidateContactCache(req.user._id);
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    invalidateContactCache(req.user._id);
    res.json({ message: 'Contact deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Toggle manual shared status for a contact
 */
exports.toggleShared = async (req, res) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, userId: req.user._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    
    contact.isShared = !contact.isShared;
    await contact.save();
    invalidateContactCache(req.user._id);

    res.json({ 
      message: contact.isShared ? 'Contact marked as Shared' : 'Contact removed from Shared', 
      contact 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Mark contact as Replied
 */
exports.markReplied = async (req, res) => {
  try {
    const { replySnippet } = req.body;
    const contact = await Contact.findOne({ _id: req.params.id, userId: req.user._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });

    contact.status = 'replied';
    contact.repliedAt = new Date();
    if (replySnippet) contact.replySnippet = replySnippet;
    await contact.save();
    invalidateContactCache(req.user._id);

    res.json({ message: 'Contact marked as Replied! 💬', contact });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Bulk toggle shared status
 */
exports.bulkToggleShared = async (req, res) => {
  try {
    const { contactIds, setShared = true } = req.body;
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'contactIds array required.' });
    }

    const result = await Contact.updateMany(
      { _id: { $in: contactIds }, userId: req.user._id },
      { $set: { isShared: Boolean(setShared) } }
    );

    invalidateContactCache(req.user._id);

    res.json({ 
      message: `Updated ${result.modifiedCount} contacts as ${setShared ? 'Shared' : 'Private'}`, 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Bulk mark contacts as Replied
 */
exports.bulkMarkReplied = async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'contactIds array required.' });
    }

    const result = await Contact.updateMany(
      { _id: { $in: contactIds }, userId: req.user._id },
      { $set: { status: 'replied', repliedAt: new Date() } }
    );

    invalidateContactCache(req.user._id);

    res.json({ 
      message: `Marked ${result.modifiedCount} contacts as Replied! 💬`, 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Bulk delete contacts
 */
exports.bulkDelete = async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'contactIds array required.' });
    }

    const result = await Contact.deleteMany({
      _id: { $in: contactIds },
      userId: req.user._id
    });

    res.json({
      message: `Successfully removed ${result.deletedCount} contacts.`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Validate deliverability of all contacts for the current user
 * Flags invalid emails into deliverabilityStatus: 'invalid' without deleting!
 */
exports.validateDeliverability = async (req, res) => {
  try {
    const { validateEmail } = require('../services/emailDeliverabilityService');
    const userId = req.user._id;
    const contacts = await Contact.find({ userId });

    let validCount = 0;
    let invalidCount = 0;

    for (const c of contacts) {
      try {
        const val = await validateEmail(c.email);
        c.deliverabilityStatus = val.isValid ? 'valid' : 'invalid';
        c.validationReason = val.reason || '';
        c.validatedAt = new Date();
        await c.save();

        if (val.isValid) validCount++;
        else invalidCount++;
      } catch (err) {
        c.deliverabilityStatus = 'valid';
        await c.save();
        validCount++;
      }
    }

    res.json({
      message: `Email check finished! Verified ${validCount} deliverable contacts. Separated ${invalidCount} invalid emails into the Invalid Emails tab (none deleted).`,
      total: contacts.length,
      validCount,
      invalidCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Manually update contact deliverability status (e.g. Move to Valid or Move to Invalid)
 */
exports.markDeliverability = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const contact = await Contact.findOne({ _id: id, userId: req.user._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    contact.deliverabilityStatus = status || 'valid';
    if (reason) contact.validationReason = reason;
    contact.validatedAt = new Date();
    await contact.save();

    res.json({ message: `Contact marked as ${contact.deliverabilityStatus}`, contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Batch update deliverability status for a list of contacts or all invalid contacts in a company
 */
exports.batchMarkDeliverability = async (req, res) => {
  try {
    const { contactIds, company, status = 'valid', reason = 'Manually verified as deliverable' } = req.body;
    const query = { userId: req.user._id };

    if (contactIds && Array.isArray(contactIds) && contactIds.length > 0) {
      query._id = { $in: contactIds };
    } else if (company) {
      query.company = new RegExp(`^${company.trim()}$`, 'i');
      query.deliverabilityStatus = 'invalid';
    } else {
      return res.status(400).json({ error: 'Provide contactIds or company name' });
    }

    const result = await Contact.updateMany(query, {
      $set: {
        deliverabilityStatus: status,
        validationReason: reason,
        validatedAt: new Date()
      }
    });

    res.json({ 
      message: `Successfully moved ${result.modifiedCount} contact(s) to ${status}`, 
      modifiedCount: result.modifiedCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
