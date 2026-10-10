const { GoogleGenAI } = require('@google/genai');
const { generateContentStreamWithFallback } = require('../utils/geminiHelper');
const xlsx = require('xlsx');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const User = require('../models/User');

const parseWithGeminiStream = async (text, user, companyOverride, res) => {
  console.log('Starting Gemini API request with text length:', text.length);
  const ai = new GoogleGenAI({ apiKey: user.geminiApiKey });
  const prompt = `Extract a list of contacts from the following raw text. Return the result strictly as a JSON array of objects. Each object must have these string fields: 'company', 'email', 'hrName', 'role', 'package'. If a field is not found, leave it as an empty string, except for 'company' which should default to 'Unknown' if not found.

  Raw text:
  ${text}`;

  const responseStream = await generateContentStreamWithFallback(ai, {
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  });

  res.setHeader('Content-Type', 'application/json');
  res.write('{"contacts":');
  
  for await (const chunk of responseStream) {
    if (chunk.text) {
      // Remove any markdown codeblocks if Gemini still hallucinates them in stream
      let cleanText = chunk.text.replace(/```json/gi, '').replace(/```/g, '');
      res.write(cleanText);
    }
  }
  
  res.write('}');
  res.end();
};

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
          company: headers.find(h => /^company$/i.test(h.trim())) || headers.find(h => /company|org|employer/i.test(h)),
          email: headers.find(h => /^email$/i.test(h.trim())) || headers.find(h => /email|e-mail/i.test(h) && !/extracted|who|by/i.test(h)) || headers.find(h => /mail/i.test(h)),
          hrName: headers.find(h => /^name$/i.test(h.trim())) || headers.find(h => /name|hr|recruiter|contact/i.test(h) && !/company|org|volunteer/i.test(h)),
          role: headers.find(h => /^role$/i.test(h.trim())) || headers.find(h => /role|position|job|title/i.test(h)),
          package: headers.find(h => /^package$/i.test(h.trim())) || headers.find(h => /package|ctc|salary|pay/i.test(h))
        };

        let lastCompany = 'Unknown';
        const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com'];

        contactsData = data.map(row => {
          let comp = headerMap.company ? String(row[headerMap.company]).trim() : '';
          const originalEmail = headerMap.email ? String(row[headerMap.email]).trim() : '';
          const emailLower = originalEmail.toLowerCase();
          
          if ((!comp || comp.toLowerCase() === 'unknown') && emailLower.includes('@')) {
            const emails = emailLower.split(/[\s,]+/).filter(e => e.trim() !== '');
            for (const e of emails) {
              if (e.includes('@')) {
                const domain = e.split('@')[1];
                if (domain && !genericDomains.includes(domain)) {
                  const domainName = domain.split('.')[0];
                  comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
                  break; // Found the corporate domain
                }
              }
            }
          }

          if (comp && comp.toLowerCase() !== 'unknown') {
            lastCompany = comp;
          } else {
            comp = lastCompany;
          }
          
          return {
            company: comp,
            email: originalEmail,
            hrName: headerMap.hrName ? String(row[headerMap.hrName]).trim() : '',
            role: headerMap.role ? String(row[headerMap.role]).trim() : '',
            package: headerMap.package ? String(row[headerMap.package]).trim() : ''
          };
        }).filter(c => c.email && /.+@.+\..+/.test(c.email)); // only keep rows with a valid email format
      }
    } else if (ext === 'pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      fs.unlinkSync(req.file.path);
      await parseWithGeminiStream(pdfData.text.substring(0, 50000), user, '', res);
      return; // Stream handled response
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Unsupported file type. Please upload Excel, CSV, or PDF.' });
    }

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({ contacts: contactsData });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`], "error": ${JSON.stringify(error.message)}}`);
      res.end();
    }
  }
};

exports.parseText = async (req, res) => {
  try {
    const { text, companyOverride } = req.body;
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'No text provided.' });
    }

    const user = await User.findById(req.user._id);
    if (!user.geminiApiKey) {
      return res.status(400).json({ error: 'Gemini API key is missing. Please update your settings.' });
    }

    await parseWithGeminiStream(text, user, companyOverride, res);
  } catch (error) {
    console.error('Gemini Parsing Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`], "error": ${JSON.stringify(error.message)}}`);
      res.end();
    }
  }
};
