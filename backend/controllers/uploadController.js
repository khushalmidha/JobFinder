const { GoogleGenAI } = require('@google/genai');
const { generateContentStreamWithFallback, generateContentWithFallback } = require('../utils/geminiHelper');
const ExcelJS = require('exceljs');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const User = require('../models/User');

function extractErrorMessage(error) {
  if (!error) return 'An unexpected error occurred.';
  let msg = error.message || String(error);
  try {
    const parsed = JSON.parse(msg);
    if (parsed.error?.message) {
      return parsed.error.message;
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch (e) {
    // not JSON
  }
  return msg;
}

/**
 * Intelligent local regex & heuristic extractor
 * Works 100% offline with zero network latency or external API dependencies
 */
function extractContactsLocally(text, companyOverride = '') {
  if (!text || typeof text !== 'string') return [];
  const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com', 'zoho.com', 'yandex.com', 'mail.com'];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  
  const allEmails = text.match(emailRegex) || [];
  if (allEmails.length === 0) return [];

  const lines = text.split(/[\r\n]+/);
  const contacts = [];
  const seenEmails = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lineEmails = trimmed.match(emailRegex);
    if (!lineEmails) continue;

    for (const email of lineEmails) {
      const lowerEmail = email.toLowerCase();
      if (seenEmails.has(lowerEmail)) continue;
      seenEmails.add(lowerEmail);

      let comp = companyOverride?.trim() || '';
      const domain = lowerEmail.split('@')[1];
      if (!comp) {
        if (domain && !genericDomains.includes(domain)) {
          const domainName = domain.split('.')[0];
          comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
        } else {
          comp = 'Unknown';
        }
      }

      let hrName = '';
      const cleanLine = trimmed
        .replace(email, '')
        .replace(/[,|:;\t\-]+/g, ' ')
        .replace(/["'{}]/g, '')
        .trim();
        
      if (cleanLine && cleanLine.length < 50 && !cleanLine.includes('http') && !cleanLine.includes('@')) {
        hrName = cleanLine;
      } else {
        const username = lowerEmail.split('@')[0];
        if (username.includes('.') || username.includes('_')) {
          const parts = username.split(/[._]+/).filter(p => p.length > 1 && !/\d/.test(p));
          if (parts.length >= 2) {
            hrName = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          }
        }
      }

      contacts.push({
        company: comp,
        email: lowerEmail,
        hrName: hrName,
        role: '',
        package: ''
      });
    }
  }

  // Any remaining emails in text that didn't match line by line
  for (const email of allEmails) {
    const lowerEmail = email.toLowerCase();
    if (!seenEmails.has(lowerEmail)) {
      seenEmails.add(lowerEmail);
      let comp = companyOverride?.trim() || '';
      const domain = lowerEmail.split('@')[1];
      if (!comp) {
        if (domain && !genericDomains.includes(domain)) {
          const domainName = domain.split('.')[0];
          comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
        } else {
          comp = 'Unknown';
        }
      }
      contacts.push({
        company: comp,
        email: lowerEmail,
        hrName: '',
        role: '',
        package: ''
      });
    }
  }

  return contacts;
}

const parseWithGeminiStream = async (text, user, companyOverride, res) => {
  console.log('Starting Gemini API request with text length:', text.length);
  const ai = new GoogleGenAI({ apiKey: user.geminiApiKey });
  const prompt = `Extract a list of contacts from the following raw text. Return the result strictly as a JSON array of objects. Each object must have these string fields: 'company', 'email', 'hrName', 'role', 'package'. If a field is not found, leave it as an empty string, except for 'company' which should default to 'Unknown' if not found.

  Raw text:
  ${text}`;

  try {
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
  } catch (streamErr) {
    console.warn('[Gemini Stream Error] Streaming failed, falling back to direct generateContent:', streamErr.message);
    if (!res.headersSent) {
      const resData = await generateContentWithFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });
      let cleanText = (resData.text || '[]').replace(/```json/gi, '').replace(/```/g, '').trim();
      let contacts = [];
      try {
        contacts = JSON.parse(cleanText);
      } catch (e) {
        console.error('Failed to parse fallback JSON:', e);
      }
      return res.json({ contacts });
    } else {
      throw streamErr;
    }
  }
};

exports.parseFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const user = await User.findById(req.user._id);
    let contactsData = [];
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const workbook = new ExcelJS.Workbook();
      if (ext === 'csv') {
        await workbook.csv.readFile(req.file.path);
      } else {
        await workbook.xlsx.readFile(req.file.path);
      }
      let data = [];
      
      // Select the sheet with the most records (in case file has cover/info sheets)
      workbook.eachSheet((sheet) => {
        const sheetRows = [];
        let headers = [];
        sheet.eachRow((row, rowNumber) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          if (rowNumber === 1 || headers.length === 0) {
            headers = values.map(v => v !== null && v !== undefined ? (typeof v === 'object' && v.text ? v.text : String(v).trim()) : '');
          } else {
            const rowObj = {};
            headers.forEach((h, idx) => {
              if (!h) return;
              const val = values[idx];
              rowObj[h] = val !== null && val !== undefined ? (typeof val === 'object' && val.text ? val.text : String(val).trim()) : '';
            });
            sheetRows.push(rowObj);
          }
        });
        if (sheetRows.length > data.length) {
          data = sheetRows;
        }
      });
      
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        const headerMap = {
          company: headers.find(h => /^company$/i.test(h.trim())) || headers.find(h => /company|org|employer|firm|startup/i.test(h)),
          email: headers.find(h => /^email$/i.test(h.trim())) || headers.find(h => /email|e-mail/i.test(h) && !/extracted|who|by/i.test(h)) || headers.find(h => /mail/i.test(h)),
          hrName: headers.find(h => /^name$/i.test(h.trim())) || headers.find(h => /name|hr|recruiter|contact|person/i.test(h) && !/company|org|volunteer/i.test(h)),
          role: headers.find(h => /^role$/i.test(h.trim())) || headers.find(h => /role|position|job|title|designation/i.test(h)),
          package: headers.find(h => /^package$/i.test(h.trim())) || headers.find(h => /package|ctc|salary|pay/i.test(h))
        };

        if (!headerMap.email) {
          for (const h of headers) {
            if (data.slice(0, 30).some(r => typeof r[h] === 'string' && /@.+\..+/.test(r[h]))) {
              headerMap.email = h;
              break;
            }
          }
        }

        let lastCompany = 'Unknown';
        const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com'];

        contactsData = data.map(row => {
          let comp = headerMap.company ? String(row[headerMap.company]).trim() : '';
          let rawEmail = headerMap.email ? String(row[headerMap.email]).trim() : '';
          
          const emailMatch = rawEmail.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
          const originalEmail = emailMatch ? emailMatch[0].trim() : rawEmail;
          const emailLower = originalEmail.toLowerCase();
          
          if ((!comp || comp.toLowerCase() === 'unknown') && emailLower.includes('@')) {
            const emails = emailLower.split(/[\s,]+/).filter(e => e.trim() !== '');
            for (const e of emails) {
              if (e.includes('@')) {
                const domain = e.split('@')[1];
                if (domain && !genericDomains.includes(domain)) {
                  const domainName = domain.split('.')[0];
                  comp = domainName.charAt(0).toUpperCase() + domainName.slice(1);
                  break;
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
        }).filter(c => c.email && /.+@.+\..+/.test(c.email));
      }
    } else if (ext === 'pdf') {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      fs.unlinkSync(req.file.path);

      if (!user || !user.geminiApiKey) {
        const local = extractContactsLocally(pdfData.text);
        return res.json({ contacts: local });
      }

      try {
        await parseWithGeminiStream(pdfData.text.substring(0, 50000), user, '', res);
        return;
      } catch (pdfErr) {
        console.warn('PDF Gemini parse failed, falling back to local extractor:', pdfErr.message);
        const local = extractContactsLocally(pdfData.text);
        if (local.length > 0 && !res.headersSent) {
          return res.json({ contacts: local });
        }
        throw pdfErr;
      }
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Unsupported file type. Please upload Excel, CSV, or PDF.' });
    }

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.json({ contacts: contactsData });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    const cleanMsg = extractErrorMessage(error);
    if (!res.headersSent) {
      res.status(500).json({ error: cleanMsg });
    } else {
      res.write(`], "error": ${JSON.stringify(cleanMsg)}}`);
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

    const localContacts = extractContactsLocally(text, companyOverride);

    const user = await User.findById(req.user._id);
    if (!user || !user.geminiApiKey) {
      if (localContacts.length > 0) {
        return res.json({ contacts: localContacts });
      }
      return res.status(400).json({ error: 'Gemini API key is missing. Please update your settings.' });
    }

    try {
      await parseWithGeminiStream(text, user, companyOverride, res);
    } catch (geminiError) {
      console.warn('Gemini stream parse failed, attempting local extraction fallback:', geminiError.message);
      if (localContacts.length > 0 && !res.headersSent) {
        return res.json({ contacts: localContacts });
      }
      throw geminiError;
    }
  } catch (error) {
    console.error('Gemini Parsing Error:', error);
    const localContacts = extractContactsLocally(req.body?.text, req.body?.companyOverride);
    if (localContacts.length > 0 && !res.headersSent) {
      return res.json({ contacts: localContacts });
    }

    const cleanMsg = extractErrorMessage(error);
    if (!res.headersSent) {
      res.status(500).json({ error: cleanMsg });
    } else {
      res.write(`], "error": ${JSON.stringify(cleanMsg)}}`);
      res.end();
    }
  }
};
