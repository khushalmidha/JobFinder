const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { GoogleGenAI } = require('@google/genai');
const { generateContentWithFallback } = require('../utils/geminiHelper');

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

    let changed = false;

    // Auto-migrate legacy mailTemplate into emailTemplates array if empty
    if (!user.emailTemplates || user.emailTemplates.length === 0) {
      user.emailTemplates = [{
        name: 'Default Template',
        subject: user.mailTemplate?.subject || 'Application for Software Engineering Intern (6-Month Internship)',
        body: user.mailTemplate?.body || `Greetings,\n\nI hope you're doing well.\n\nI am {{userName}}, a final-year B.Tech student in Computer Science & AI at {{college}} with a CGPA of {{cgpa}}. I am writing to express my interest in the Software Engineering Intern (6-Month Internship) opportunity at {{companyName}}.\n\nBest regards,\n{{userName}}\n{{college}}\n{{userEmail}} | {{userPhone}}\n\nResume: {{resumeLink}}`,
        isDefault: true
      }];
      user.selectedTemplateId = user.emailTemplates[0]._id.toString();
      changed = true;
    }

    // Auto-migrate legacy smtpConfig into smtpConfigs array if empty
    if (!user.smtpConfigs || user.smtpConfigs.length === 0) {
      if (user.smtpConfig && (user.smtpConfig.user || user.smtpConfig.host)) {
        user.smtpConfigs = [{
          name: user.smtpConfig.user ? `${user.smtpConfig.user}` : 'Primary Account',
          host: user.smtpConfig.host || 'smtp.gmail.com',
          port: user.smtpConfig.port || 465,
          user: user.smtpConfig.user || '',
          pass: user.smtpConfig.pass || '',
          isDefault: true
        }];
        user.selectedSmtpId = user.smtpConfigs[0]._id.toString();
        changed = true;
      }
    }

    if (changed) {
      await user.save();
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.passwordHash;
    delete updates._id;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Apply fields
    Object.keys(updates).forEach(key => {
      user[key] = updates[key];
    });

    // Sync legacy mailTemplate with active/default emailTemplate
    if (user.emailTemplates && user.emailTemplates.length > 0) {
      const activeTemplate = user.emailTemplates.find(t => t._id?.toString() === user.selectedTemplateId?.toString())
        || user.emailTemplates.find(t => t.isDefault)
        || user.emailTemplates[0];

      if (activeTemplate) {
        user.selectedTemplateId = activeTemplate._id.toString();
        user.mailTemplate = {
          subject: activeTemplate.subject,
          body: activeTemplate.body
        };
      }
    }

    // Sync legacy smtpConfig with active/default smtpConfig
    if (user.smtpConfigs && user.smtpConfigs.length > 0) {
      const activeSmtp = user.smtpConfigs.find(s => s._id?.toString() === user.selectedSmtpId?.toString())
        || user.smtpConfigs.find(s => s.isDefault)
        || user.smtpConfigs[0];

      if (activeSmtp) {
        user.selectedSmtpId = activeSmtp._id.toString();
        user.smtpConfig = {
          host: activeSmtp.host,
          port: activeSmtp.port,
          user: activeSmtp.user,
          pass: activeSmtp.pass
        };
      }
    } else {
      user.selectedSmtpId = '';
    }

    await user.save();

    const updatedUser = await User.findById(user._id).select('-passwordHash');
    res.json(updatedUser);
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

    const response = await generateContentWithFallback(ai, {
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

exports.blockCompany = async (req, res) => {
  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });
    
    const user = await User.findById(req.user._id);
    if (!user.blockedCompanies.includes(company)) {
      user.blockedCompanies.push(company);
      await user.save();
    }
    
    res.json({ message: 'Company blocked successfully', blockedCompanies: user.blockedCompanies });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.unblockCompany = async (req, res) => {
  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });
    
    const user = await User.findById(req.user._id);
    user.blockedCompanies = user.blockedCompanies.filter(c => c !== company);
    await user.save();
    
    res.json({ message: 'Company unblocked successfully', blockedCompanies: user.blockedCompanies });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAvailableSyncAccounts = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('name email')
      .sort({ name: 1 })
      .lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (!user.candidateProfile || !user.candidateProfile.fullName) {
      user.candidateProfile = {};
      await user.save();
    }
    res.json(user.candidateProfile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const currentProfile = user.candidateProfile ? user.candidateProfile.toObject() : {};
    const updatedProfile = {
      ...currentProfile,
      ...req.body,
      skills: {
        ...(currentProfile.skills || {}),
        ...(req.body.skills || {})
      },
      links: {
        ...(currentProfile.links || {}),
        ...(req.body.links || {})
      }
    };

    user.candidateProfile = updatedProfile;
    await user.save();
    res.json({ message: 'Profile updated successfully', candidateProfile: user.candidateProfile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


