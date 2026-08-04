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

    let fileContent = '';
    const ext = req.file.originalname.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      fileContent = data.map(row => row.join(', ')).join('\n');
    } else {
      // For MVP, just handling excel/csv
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Unsupported file type. Please upload Excel or CSV.' });
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Call Gemini API
    const ai = new GoogleGenAI({ apiKey: user.geminiApiKey });

    const prompt = `
    Extract contact and job information from the following raw data.
    The data is in a comma-separated format where each line represents a row from a spreadsheet.
    Extract company, HR/recruiter name (if present), email, package/CTC (if mentioned), and role (if mentioned).
    Return a strict JSON array of objects. Do not include markdown formatting or any other text.
    Each object must have these keys: "company" (string), "hrName" (string), "email" (string), "package" (string), "role" (string).
    If a value is not found, leave it as an empty string. Only include rows that have at least an email and a company.

    Raw Data:
    ${fileContent.substring(0, 10000)} // truncate to avoid huge payload
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    let contactsData = JSON.parse(response.text);

    res.json({ contacts: contactsData });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
};
