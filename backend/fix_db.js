const mongoose = require('mongoose');
const Contact = require('./models/Contact');
require('dotenv').config();

const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com'];

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khushalmidha:7H5qXGxJ03vfYt9A@cluster0.qyi5j.mongodb.net/jobfinder')
  .then(async () => {
    console.log('Connected to DB');
    
    // Get all contacts sorted by creation time to maintain original row order
    const contacts = await Contact.find({}).sort({ createdAt: 1 });
    
    let lastCompany = 'Unknown';
    let updatedCount = 0;

    for (const contact of contacts) {
      let comp = (contact.company || 'Unknown').trim();
      let originalEmailStr = contact.email || '';
      let newEmail = originalEmailStr;
      
      // If company is Unknown, try to extract from email
      if (comp.toLowerCase() === 'unknown' && originalEmailStr) {
        // Split multiple emails by comma or space
        const emails = originalEmailStr.split(/[\s,]+/).filter(e => e.trim() !== '');
        let foundCorporateDomain = null;
        let corporateEmail = null;

        for (const e of emails) {
          const emailLower = e.trim().toLowerCase();
          if (emailLower.includes('@')) {
            const domain = emailLower.split('@')[1];
            if (domain && !genericDomains.includes(domain)) {
              foundCorporateDomain = domain;
              corporateEmail = emailLower;
              break; // Found the corporate one!
            }
          }
        }

        if (foundCorporateDomain) {
          const domainName = foundCorporateDomain.split('.')[0];
          comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
          // Keep the corporate email as the primary one
          newEmail = corporateEmail;
        } else {
          // If all emails are generic (e.g. gmail), inherit last known company
          if (lastCompany.toLowerCase() !== 'unknown') {
            comp = lastCompany;
            // Keep the first email since they are all generic
            if (emails.length > 0) newEmail = emails[0].trim();
          }
        }
      }

      // Update last known company if valid
      if (comp && comp.toLowerCase() !== 'unknown') {
        lastCompany = comp;
      }

      // If we made a change, save it
      if (comp !== contact.company || newEmail !== contact.email) {
        contact.company = comp;
        contact.email = newEmail;
        await contact.save();
        updatedCount++;
        console.log(`Updated: ${originalEmailStr} -> Company: ${comp}, Email: ${newEmail}`);
      }
    }

    console.log(`Finished fixing DB. Updated ${updatedCount} contacts.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
