const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { GoogleGenAI } = require('@google/genai');

exports.signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: 'User already registered.' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    user = new User({ name, email, passwordHash });
    await user.save();

    const token = jwt.sign({ _id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.header('Authorization', token).json({ token, user: { _id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) return res.status(400).json({ error: 'Invalid email or password.' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid email or password.' });

    const token = jwt.sign({ _id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { _id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const updates = req.body;
    delete updates.passwordHash; // prevent password change here
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-passwordHash');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.convertTemplate = async (req, res) => {
  try {
    const { rawText } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.geminiApiKey) {
      return res.status(400).json({ error: 'Gemini API key is missing. Please set it in Settings.' });
    }

    const ai = new GoogleGenAI({ apiKey: user.geminiApiKey });
    
    const prompt = `You are an AI assistant that helps convert personalized cold emails into parameterized Handlebars-style templates.
    I will provide you with a raw email text that may include both a subject line and a body.
    Your job is to replace the specific names/roles/details in the text with the following placeholders exactly as they are (do NOT invent new ones):
    {{companyName}}
    {{role}}
    {{jobId}}
    {{userName}}
    {{college}}
    {{cgpa}}
    {{userEmail}}
    {{userPhone}}
    {{resumeLink}}

    Return ONLY a valid JSON object with two keys: "subject" and "body". 
    If the raw text does not explicitly mention a subject, invent a suitable parameterized subject line.
    Do NOT include any markdown formatting like \`\`\`json around your response.

    Here is the raw text to convert:
    ${rawText}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    let convertedText = response.text || '';
    convertedText = convertedText.replace(/^\`\`\`(json|text)?/, '').replace(/\`\`\`$/, '').trim();
    
    let result;
    try {
      result = JSON.parse(convertedText);
    } catch (e) {
      // Fallback if parsing fails
      result = { subject: "Default Subject (AI Parsing Failed)", body: convertedText };
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
