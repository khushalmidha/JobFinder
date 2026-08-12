const mongoose = require('mongoose');
const Contact = require('./models/Contact');
require('dotenv').config();

// Helper to normalize and match companies
const getStandardName = (rawName, existingStandardNames) => {
  if (!rawName) return 'Unknown';
  let name = rawName.trim();
  let lowerName = name.toLowerCase();

  // Try to find an exact case-insensitive match
  let match = existingStandardNames.find(n => n.toLowerCase() === lowerName);
  if (match) return match;

  // Try to find a fuzzy match (e.g., 'Yellow ai' matches 'Yellow')
  // We'll check if one contains the other and they share the first word
  const firstWord = lowerName.split(/[\s-]/)[0];
  match = existingStandardNames.find(n => {
    const nLower = n.toLowerCase();
    const nFirst = nLower.split(/[\s-]/)[0];
    return nFirst === firstWord && (nLower.includes(lowerName) || lowerName.includes(nLower));
  });

  if (match) return match;

  // Manual mappings for common suffixes
  if (lowerName.endsWith('now') || lowerName.endsWith('ai') || lowerName.endsWith(' games')) {
    match = existingStandardNames.find(n => {
      const nLower = n.toLowerCase();
      return lowerName.startsWith(nLower) || nLower.startsWith(lowerName);
    });
    if (match) return match;
  }

  return name; // Keep the original formatted name if no match
};

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/jobfinder')
  .then(async () => {
    console.log('Connected to DB');
    
    const contacts = await Contact.find({});
    
    // Build a frequency map to determine the "standard" casing (the one used most often)
    const companyFreq = {};
    contacts.forEach(c => {
      if (c.company && c.company.toLowerCase() !== 'unknown') {
        companyFreq[c.company] = (companyFreq[c.company] || 0) + 1;
      }
    });

    // Sort by frequency descending
    const sortedCompanies = Object.keys(companyFreq).sort((a, b) => companyFreq[b] - companyFreq[a]);
    
    const standardNames = [];
    const migrations = {}; // maps raw name to standard name

    sortedCompanies.forEach(comp => {
      const standard = getStandardName(comp, standardNames);
      if (standard === comp) {
        // This is a new standard name
        standardNames.push(comp);
      }
      migrations[comp] = standard;
    });

    console.log('Migrations mapping:', migrations);

    let updatedCount = 0;
    for (const contact of contacts) {
      if (contact.company && contact.company.toLowerCase() !== 'unknown') {
        const newComp = migrations[contact.company] || contact.company;
        if (contact.company !== newComp) {
          console.log(`Updating ${contact.company} -> ${newComp}`);
          contact.company = newComp;
          await contact.save();
          updatedCount++;
        }
      } else {
        // standardize 'unknown' 'Unknown ' etc to exactly 'Unknown'
        if (contact.company !== 'Unknown') {
          contact.company = 'Unknown';
          await contact.save();
          updatedCount++;
        }
      }
    }

    console.log(`Finished merging DB. Updated ${updatedCount} contacts.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
