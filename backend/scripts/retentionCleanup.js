#!/usr/bin/env node
/**
 * Scoped CLI tooling for 48-hour email history retention and compact ledger archiving.
 * Default is strictly --dry-run. Explicit --apply and scope (--user <id> or --global) are required.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { pruneOldMailLogs } = require('../services/retentionService');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: true,
    apply: false,
    hours: 48,
    batchSize: 200,
    maxBatches: 50,
    userId: null,
    allowGlobal: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.apply = false;
    } else if (arg === '--global') {
      options.allowGlobal = true;
    } else if (arg === '--user' || arg === '--userId') {
      options.userId = args[++i];
    } else if (arg === '--hours') {
      options.hours = parseInt(args[++i], 10);
    } else if (arg === '--batch-size') {
      options.batchSize = parseInt(args[++i], 10);
    } else if (arg === '--max-batches') {
      options.maxBatches = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/retentionCleanup.js [options]

Options:
  --dry-run             Default. Count eligible records without making changes.
  --apply               Perform actual archiving and CAS deletion.
  --user <userId>       Scope cleanup to a specific owner.
  --global              Explicitly permit cleanup across all owners.
  --hours <n>           Retention window in hours (default: 48).
  --batch-size <n>      Batch size for bounded processing (default: 200, max: 1000).
  --max-batches <n>     Maximum batches per run (default: 50, max: 1000).
      `);
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  if (options.apply && !options.userId && !options.allowGlobal) {
    console.error('ERROR: Explicit owner scope (--user <id>) or --global is required when applying destructive retention cleanup.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/jobfinder';
  await mongoose.connect(mongoUri);

  try {
    console.log(`Running retention ${options.dryRun ? 'DRY RUN' : 'APPLY'} (hours: ${options.hours}, scope: ${options.userId ? options.userId : 'global'})...`);
    const result = await pruneOldMailLogs({
      now: new Date(),
      retentionHours: options.hours,
      batchSize: options.batchSize,
      maxBatches: options.maxBatches,
      userId: options.userId,
      allowGlobal: options.allowGlobal,
      dryRun: options.dryRun
    });

    console.log('Result:', JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Retention execution failed:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };
