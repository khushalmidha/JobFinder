// Local operator CLI only. Preview is read-only; no email verification is fabricated.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { promoteVerifiedAdmin } = require('../services/adminRoleMigrationService');

function parseArgs(argv) {
  const options = { apply: false };
  const names = { '--email': 'email', '--migration-id': 'migrationId', '--env-file': 'envFile' };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--apply') options.apply = true;
    else if (names[key] && argv[index + 1] && !argv[index + 1].startsWith('--')) options[names[key]] = argv[++index];
    else throw new Error('Use --email, --migration-id, optional --env-file and explicit --apply');
  }
  if (!options.email || !options.migrationId) throw new Error('--email and --migration-id are required');
  return options;
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const config = options.envFile ? dotenv.parse(fs.readFileSync(path.resolve(options.envFile))) : process.env;
  if (!config.MONGODB_URI) throw new Error('Database URI is not configured');
  await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoCreate: false, autoIndex: false });
  try {
    const result = await promoteVerifiedAdmin(options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.eligible) process.exitCode = 2;
    return result;
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, main };
