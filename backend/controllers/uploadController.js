const { GoogleGenAI } = require('@google/genai');
const xlsx = require('xlsx');
const fs = require('fs');
const User = require('../models/User');

exports.parseFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const user = await User.findById(req.user._id);
    if (!user.geminiApiKey) {
      // Clean up file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Gemini API key is missing. Please update your settings.' });
    }

    let contactsData = [];
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
      
      if (data.length > 0) {
        // Map common headers to our schema keys
        const headers = Object.keys(data[0]);
        const headerMap = {
          company: headers.find(h => /company|org|organization|employer/i.test(h)),
          email: headers.find(h => /email|e-mail|mail/i.test(h)),
          hrName: headers.find(h => /name|hr|recruiter|contact/i.test(h) && !/company|org/i.test(h)),
          role: headers.find(h => /role|position|job|title/i.test(h)),
          package: headers.find(h => /package|ctc|salary|pay/i.test(h))
        };

        contactsData = data.map(row => {
          const comp = headerMap.company ? String(row[headerMap.company]).trim() : '';
          return {
            company: comp || 'Unknown',
            email: headerMap.email ? String(row[headerMap.email]).trim() : '',
            hrName: headerMap.hrName ? String(row[headerMap.hrName]).trim() : '',
            role: headerMap.role ? String(row[headerMap.role]).trim() : '',
            package: headerMap.package ? String(row[headerMap.package]).trim() : ''
          };
        }).filter(c => c.email && /.+@.+\..+/.test(c.email)); // only keep rows with a valid email format
      }
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Unsupported file type. Please upload Excel or CSV.' });
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({ contacts: contactsData });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
};
