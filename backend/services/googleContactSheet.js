const crypto = require('node:crypto');
const mongoose = require('mongoose');
const headers = ['contact_key', 'company', 'name', 'title', 'email', 'source_url', 'verification'];
const receiptSchema = new mongoose.Schema({
  _id: String, digest: String, operation: String, state: String, rows: [[String]], range: String
}, { timestamps: true });
const Receipt = mongoose.model('GoogleContactSheetReceipt', receiptSchema);

function createClient({ spreadsheetId, tab, accessToken }) {
  if (!/^[\w-]+$/.test(spreadsheetId || '') || !tab || !accessToken) throw Error('Configure the exact spreadsheet ID, tab and a Google access token');
  const range = encodeURIComponent("'" + tab.replaceAll("'", "''") + "'!A:G");
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + range;
  async function request(target, body) {
    const result = await fetch(target, {
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
    });
    if (!result.ok) throw Error('Sheets returned HTTP ' + result.status);
    return result.json();
  }
  return {
    read: async () => (await request(url + '?valueRenderOption=FORMULA')).values || [],
    append: async rows => (await request(url + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: rows })).updates
  };
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function syncContacts({ destination, leads, client, approvedDigest, reconcile = false }) {
  const current = await client.read();
  if (JSON.stringify(current[0]) !== JSON.stringify(headers)) throw Error('The configured tab must have the exact contact headers in columns A:G');
  const existing = new Map();
  for (const row of current.slice(1)) {
    if (!row[0]) continue;
    if (existing.has(row[0])) throw Error('Duplicate contact key in configured tab');
    existing.set(row[0], row);
  }
  const id = hash(destination);
  const pending = await Receipt.findById(id).lean();
  if (pending) {
    if (!reconcile) return { status: 'needs_reconciliation' };
    const present = pending.rows.every(row => JSON.stringify(existing.get(row[0])) === JSON.stringify(row));
    if (!present) return { status: 'needs_reconciliation' };
    await Receipt.updateOne({ _id: id + ':' + pending.operation }, { digest: pending.digest, state: 'reconciled' }, { upsert: true });
    await Receipt.deleteOne({ _id: id, operation: pending.operation });
    return { status: 'reconciled', count: pending.rows.length };
  }
  if (reconcile) return { status: 'clear' };

  const emails = new Set(current.slice(1).map(row => String(row[4] || '').trim().toLowerCase()));
  const rows = [];
  for (const lead of leads) {
    const email = lead.email?.trim().toLowerCase();
    if (!email || lead.inferenceFlag || !lead.sourceUrl || emails.has(email)) continue;
    emails.add(email);
    rows.push([hash(email), lead.company, lead.name || '', lead.title || '', email, lead.sourceUrl, 'Publicly sourced, mailbox unverified']);
  }
  const digest = hash([destination, rows]);
  if (!approvedDigest) return { status: 'preview', rows, digest };
  if (!rows.length) return { status: 'already_present', count: 0 };
  if (approvedDigest !== digest) throw Error('Contact rows changed. Preview again.');
  const operation = crypto.randomUUID();
  try {
    await Receipt.create({ _id: id, digest, operation, state: 'pending', rows });
  } catch (error) {
    if (error.code === 11000) return { status: 'needs_reconciliation' };
    throw error;
  }
  try {
    // Refresh under the durable lock so a completed concurrent operation cannot cause another append.
    if (JSON.stringify(await client.read()) !== JSON.stringify(current)) {
      await Receipt.deleteOne({ _id: id, operation });
      return { status: 'preview_changed' };
    }
  } catch (error) {
    await Receipt.deleteOne({ _id: id, operation });
    throw error;
  }
  try {
    const result = await client.append(rows);
    if (result?.updatedRows !== rows.length || !result.updatedRange) return { status: 'needs_reconciliation' };
    // Keep a durable receipt per approved digest, separate from the destination lock.
    await Receipt.updateOne({ _id: id + ':' + operation }, { digest, state: 'synced', range: result.updatedRange }, { upsert: true });
    await Receipt.deleteOne({ _id: id, operation });
    return { status: 'synced', count: rows.length, range: result.updatedRange };
  } catch {
    return { status: 'needs_reconciliation' };
  }
}
module.exports = { createClient, syncContacts, headers };
