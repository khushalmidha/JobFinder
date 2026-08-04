const { GoogleGenAI } = require('@google/genai');
const Contact = require('../models/Contact');
const User = require('../models/User');

exports.analyzeResponse = async (req, res) => {
  try {
    const { emailText, senderEmail } = req.body;
    const userId = req.user._id;

    if (!emailText || !senderEmail) {
      return res.status(400).json({ error: 'Missing email text or sender email.' });
    }

    const user = await User.findById(userId);
    if (!user.geminiApiKey) {
      return res.status(400).json({ error: 'Gemini API key is missing. Please update your settings.' });
    }

    const contact = await Contact.findOne({ userId, email: senderEmail });
    if (!contact) {
      return res.status(404).json({ error: 'No associated contact found in your dashboard.' });
    }

    const ai = new GoogleGenAI({ apiKey: user.geminiApiKey });

    const prompt = `
    Analyze the following email response from a recruiter or HR person.
    Classify the response intent into exactly one of these statuses:
    - "positive_response": The recruiter is interested, wants an interview, or wants to move forward.
    - "negative_response": A rejection or letting you know they are not moving forward.
    - "auto_reply": An automated out-of-office or generic no-reply acknowledgment.
    - "follow_up_later": They said they will get back to you later, or asked you to apply again in a few months.
    - "sent": (Default) if it is none of the above or too ambiguous to tell.

    Also, generate a very brief 1-2 sentence summary of what they said.

    Respond in strict JSON format:
    {
      "status": "...",
      "summary": "..."
    }

    Email Text:
    "${emailText}"
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const aiData = JSON.parse(response.text);

    contact.status = aiData.status || contact.status;
    contact.notes = aiData.summary || '';
    await contact.save();

    res.json({ message: 'Analysis complete', contact });
  } catch (error) {
    console.error('Analyze Error:', error);
    res.status(500).json({ error: error.message });
  }
};
