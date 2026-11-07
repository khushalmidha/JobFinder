const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const service = require('../services/companyImportService');
async function main(args = process.argv.slice(2)) {
  const flags = {}; const booleans = new Set(['--apply', '--rollback', '--recover', '--acknowledge-workers-stopped']);
  const allowed = new Set(['--apply', '--rollback', '--env-file', '--source', '--user-id', '--preview-id', '--digest', '--output', '--recover', '--acknowledge-workers-stopped', '--reason']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]; if (!allowed.has(arg)) throw new Error(`Unknown option ${arg}`);
    flags[arg] = booleans.has(arg) ? true : args[++index];
    if (!flags[arg] || String(flags[arg]).startsWith('--')) throw new Error(`Value required for ${arg}`);
  }
  if (['--apply','--rollback','--recover'].filter(k=>flags[k]).length>1) throw new Error('Choose apply, rollback or recovery');
  if (flags['--env-file']) require('dotenv').config({ path: path.resolve(flags['--env-file']), quiet: true });
  if (!process.env.MONGODB_URI || !mongoose.isValidObjectId(flags['--user-id'])) throw new Error('MONGODB_URI and --user-id of an existing administrator are required');
  if ((flags['--apply'] || flags['--rollback'] || flags['--recover']) && !mongoose.isValidObjectId(flags['--preview-id'])) throw new Error('--preview-id required for apply or rollback');
  if (flags['--apply'] && !/^[a-f0-9]{64}$/.test(flags['--digest'] || '')) throw new Error('--digest from the reviewed preview is required');
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await Promise.all([require('../models/Company').init(), require('../models/CompanyImportRun').init(), require('../models/CompanyProspect').init(), require('../models/PublicRecruitmentLead').init()]);
    const result = flags['--recover'] ? await service.recoverImport(flags['--user-id'], flags['--preview-id'], {acknowledgeStopped: flags['--acknowledge-workers-stopped'] === true, reason: flags['--reason']}) : flags['--apply'] ? await service.applyImport(flags['--user-id'], flags['--preview-id'], flags['--digest']) : flags['--rollback'] ? await service.rollbackImport(flags['--user-id'], flags['--preview-id']) : await service.previewImport(flags['--user-id'], flags['--source'] ? JSON.parse(fs.readFileSync(path.resolve(flags['--source']), 'utf8').replace(/^\uFEFF/, '')) : undefined);
    if (flags['--output']) fs.writeFileSync(path.resolve(flags['--output']), JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...result, changes: undefined }, null, 2));
    return result;
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
