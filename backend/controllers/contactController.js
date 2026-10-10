const Contact = require('../models/Contact');
const { GoogleGenAI } = require('@google/genai');

exports.getContacts = async (req, res) => {
  try {
    const { company, status, minPackage, maxPackage, search, isShared } = req.query;
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
    if (search) query.$or = [
      { company: { $regex: new RegExp(search, 'i') } },
      { hrName: { $regex: new RegExp(search, 'i') } },
      { email: { $regex: new RegExp(search, 'i') } },
      { role: { $regex: new RegExp(search, 'i') } }
    ];

    const contacts = await Contact.find(query).sort({ createdAt: -1 });
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

    // Simple deduplication against existing database based on email for this user
    const existingEmails = (await Contact.find({ userId: req.user._id }).select('email')).map(c => c.email);
    const newContacts = uniqueIncoming.filter(c => !existingEmails.includes(c.email));

    if (newContacts.length === 0) {
      return res.status(200).json({ message: 'No new contacts to add (all were duplicates)', added: 0 });
    }

    const inserted = await Contact.insertMany(newContacts);
    res.status(201).json({ message: `Successfully added ${inserted.length} contacts`, added: inserted.length, contacts: inserted });
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
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
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

    res.json({ 
      message: `Marked ${result.modifiedCount} contacts as Replied! 💬`, 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
