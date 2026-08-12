const Contact = require('../models/Contact');
const { GoogleGenAI } = require('@google/genai');

exports.getContacts = async (req, res) => {
  try {
    const { company, status, minPackage, maxPackage, search } = req.query;
    let query = { userId: req.user._id };

    if (company) query.company = { $regex: new RegExp(company, 'i') };
    if (status) query.status = status;
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
    // Format contacts with userId
    const toInsert = contacts.map(c => ({
      ...c,
      company: (c.company && c.company.trim()) ? c.company.trim() : 'Unknown',
      userId: req.user._id,
      source: c.source || 'extension'
    }));
    
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
