const { GoogleGenAI } = require('@google/genai');

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest'
];

/**
 * Check if the error is transient, capacity-related, network timeout, or model-specific
 * so we can fallback to another Gemini model.
 */
function isFallbackEligible(err) {
  if (!err) return false;
  const errMsg = (err.message || '').toLowerCase();
  const causeMsg = (err.cause?.message || err.cause?.code || String(err.cause || '')).toLowerCase();
  const status = Number(err.status || err.code || 0);

  // 1. Model Not Found / Deprecated
  const is404 = status === 404 || 
    errMsg.includes('404') || 
    errMsg.includes('not_found') || 
    errMsg.includes('no longer available') || 
    errMsg.includes('not supported') ||
    errMsg.includes('please update your code');

  // 2. High Demand / Service Unavailable (503)
  const is503 = status === 503 || 
    errMsg.includes('503') || 
    errMsg.includes('unavailable') || 
    errMsg.includes('high demand') || 
    errMsg.includes('spikes in demand');

  // 3. Rate Limit / Resource Exhausted (429)
  const is429 = status === 429 || 
    errMsg.includes('429') || 
    errMsg.includes('resource_exhausted') || 
    errMsg.includes('rate limit');

  // 4. Server internal error / Bad Gateway / Gateway timeout (500, 502, 504)
  const isServer = [500, 502, 503, 504].includes(status) || 
    errMsg.includes('internal') || 
    errMsg.includes('bad gateway') || 
    errMsg.includes('gateway timeout');

  // 5. Network / Socket / Fetch / Connect timeouts
  const isNetwork = errMsg.includes('econnreset') || 
    errMsg.includes('etimedout') || 
    errMsg.includes('socket hang up') ||
    errMsg.includes('fetch failed') ||
    errMsg.includes('timeout') ||
    errMsg.includes('connect') ||
    causeMsg.includes('timeout') ||
    causeMsg.includes('und_err_connect_timeout') ||
    causeMsg.includes('econnrefused');

  return is404 || is503 || is429 || isServer || isNetwork;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Call generateContent with automatic model fallback for 503 high demand, timeouts, 429, etc.
 */
async function generateContentWithFallback(ai, options, preferredModel = null) {
  const primary = preferredModel || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const modelList = [primary, ...DEFAULT_MODELS.filter(m => m !== primary)];
  const models = [...new Set(modelList)];
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
      if (!isFallbackEligible(err)) {
        // If it's an invalid API key (400/401/403), throw immediately
        throw err;
      }
      console.warn(`[Gemini Fallback] Model ${model} returned error (${err.status || err.code || err.message}). Trying fallback model...`);
      await sleep(200);
    }
  }

  throw lastError;
}

/**
 * Call generateContentStream with automatic model fallback for 503 high demand, timeouts, 429, etc.
 */
async function generateContentStreamWithFallback(ai, options, preferredModel = null) {
  const primary = preferredModel || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const modelList = [primary, ...DEFAULT_MODELS.filter(m => m !== primary)];
  const models = [...new Set(modelList)];
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
      if (!isFallbackEligible(err)) {
        throw err;
      }
      console.warn(`[Gemini Fallback] Model ${model} returned stream error (${err.status || err.code || err.message}). Trying fallback model...`);
      await sleep(200);
    }
  }

  throw lastError;
}

module.exports = {
  generateContentWithFallback,
  generateContentStreamWithFallback,
  DEFAULT_MODELS,
  isFallbackEligible
};
