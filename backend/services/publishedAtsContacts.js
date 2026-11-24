const recruitingContext = /\b(?:apply|applications?|candidates?|recruit(?:ment|er|ing)?|hiring|talent acquisition)\b/i;
const restrictedContext = /\b(?:scam|fraud|agency|vendor|accessibility|accommodations?|privacy|press|support)\b/i;

function boardScope(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const endpoint = require('./careerWatchService').atsEndpoint(url.href);
    if (!endpoint) return null;
    return { endpoint, host: url.hostname, token: url.pathname.split('/').filter(Boolean)[0].toLowerCase() };
  } catch { return null; }
}

function linkedBoards(html, employerPage) {
  const boards = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const link = new URL(match[1].replace(/&amp;/g, '&'), employerPage);
      const board = boardScope(link.href);
      if (board && !boards.has(board.endpoint.url)) boards.set(board.endpoint.url, { ...board, employerPage, link: link.href });
    } catch { /* Ignore malformed links. */ }
  }
  return [...boards.values()];
}

function sameBoard(value, expected) {
  const actual = boardScope(value);
  return !!actual && actual.endpoint.type === expected.endpoint.type &&
    actual.token === expected.token &&
    (actual.host === expected.host || expected.endpoint.type === 'greenhouse');
}
function isEmployerPage(host, domain) {
  if (host === domain || host === 'www.' + domain) return true;
  return host.endsWith('.' + domain) &&
    /^(?:careers|jobs|talent|people|recruit(?:ing|ment)?|campus)$/.test(host.slice(0, -(domain.length + 1)));
}

function verifyAtsEvidence(row, domain) {
  try {
    const { board, employerPage } = row.atsEvidence || {};
    const employer = new URL(employerPage);
    const scope = boardScope(board);
    return !!scope && employer.protocol === 'https:' && !employer.username && !employer.password && !employer.port &&
      isEmployerPage(employer.hostname, domain) && sameBoard(row.sourceUrl, scope);
  } catch { return false; }
}

function extractPostingContacts(response, board, domain, extract) {
  let json;
  try { json = JSON.parse(response.text); } catch { return []; }
  const jobs = Array.isArray(json) ? json : json?.jobs;
  if (!Array.isArray(jobs)) return [];
  const contacts = new Map();
  for (const job of jobs.slice(0, 500)) {
    const sourceUrl = job?.absolute_url || job?.hostedUrl || job?.jobUrl;
    if (!sameBoard(sourceUrl, board)) continue;
    const description = String(job.content || job.descriptionHtml || job.descriptionPlain || job.description || '').slice(0, 25000)
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
    const blocks = description.match(/<(?:p|li)\b[^>]*>[\s\S]*?<\/(?:p|li)>/gi) || description.split(/\r?\n/);
    for (const block of blocks) {
      const words = block.replace(/<[^>]*>/g, ' ');
      if (!recruitingContext.test(words) || restrictedContext.test(words)) continue;
      for (const row of extract(block, sourceUrl, domain)) {
        if (!['role_inbox', 'recruiter', 'hiring_manager'].includes(row.kind)) continue;
        contacts.set(row.email, { ...row, atsEvidence: { employerPage: board.employerPage, board: board.link } });
      }
    }
  }
  return [...contacts.values()];
}

module.exports = { linkedBoards, verifyAtsEvidence, extractPostingContacts, isEmployerPage };
