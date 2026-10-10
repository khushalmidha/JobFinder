const { GoogleGenAI } = require('@google/genai');

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

/**
 * Call generateContent with automatic model fallback for deprecated/404 models
 */
async function generateContentWithFallback(ai, options, preferredModel = null) {
  const primary = preferredModel || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const models = [primary, ...DEFAULT_MODELS.filter(m => m !== primary)];
  let lastError = null;

  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        ...options,
        model
      });
      return res;
    } catch (err) {
      lastError = err;
      const errMsg = err.message || '';
      const is404 = err.status === 404 || err.code === 404 || errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available');
      if (!is404) {
        // If it's a 401/403 (invalid key) or quota issue, don't cycle through models
        throw err;
      }
      console.warn(`[Gemini Fallback] Model ${model} returned 404 / no longer available. Trying next fallback...`);
    }
  }

  throw lastError;
}

/**
 * Call generateContentStream with automatic model fallback for deprecated/404 models
 */
async function generateContentStreamWithFallback(ai, options, preferredModel = null) {
  const primary = preferredModel || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const models = [primary, ...DEFAULT_MODELS.filter(m => m !== primary)];
  let lastError = null;

  for (const model of models) {
    try {
      const stream = await ai.models.generateContentStream({
        ...options,
        model
      });
      return stream;
    } catch (err) {
      lastError = err;
      const errMsg = err.message || '';
      const is404 = err.status === 404 || err.code === 404 || errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available');
      if (!is404) {
        throw err;
      }
      console.warn(`[Gemini Fallback] Model ${model} returned 404 for streaming. Trying next fallback...`);
    }
  }

  throw lastError;
}

module.exports = {
  generateContentWithFallback,
  generateContentStreamWithFallback,
  DEFAULT_MODELS
};
