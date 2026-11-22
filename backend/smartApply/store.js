// Local CLI storage only. This never opens the production Mongo database.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
class SmartApplyStore {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'smart-apply.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS answers(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY, url TEXT NOT NULL, state TEXT NOT NULL, report TEXT NOT NULL, updatedAt TEXT NOT NULL);`);
  }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, JSON.stringify(value)); }
  get(key) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  answers() { return this.db.prepare('SELECT value FROM answers').all().map(row => JSON.parse(row.value)); }
  saveAnswer(entry) { this.db.prepare('INSERT OR REPLACE INTO answers VALUES (?,?)').run(entry.key, JSON.stringify(entry)); }
  application(id, url, state, report) { this.db.prepare('INSERT OR REPLACE INTO applications VALUES (?,?,?,?,?)').run(id, url, state, JSON.stringify(report), new Date().toISOString()); }
  close() { this.db.close(); }
}
module.exports = { SmartApplyStore };
