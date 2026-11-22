const fs = require('node:fs');
const path = require('node:path');
const { normalizeProfile, profileGaps, rememberAnswer } = require('../../extension/src/utils/candidateProfile.js');
const { SmartApplyStore } = require('../smartApply/store');
const args = process.argv.slice(2);
const command = args.shift();
const home = path.resolve(process.env.SMART_APPLY_HOME || path.join(__dirname, '../../.smart-apply'));
const store = new SmartApplyStore(home);
try {
  if (command === 'import-profile') {
    const profile = normalizeProfile(JSON.parse(fs.readFileSync(args[0], 'utf8')));
    store.set('profile', profile); store.set('reviewed', false);
    fs.writeFileSync(path.join(home, 'profile.json'), JSON.stringify(profile, null, 2), { mode: 0o600 });
    console.log('Imported locally; not approved. Review profile.json, then run approve-profile. Missing:', profileGaps(profile).join(', '));
  } else if (command === 'approve-profile') {
    if (!args.includes('--reviewed')) throw Error('Read/edit profile.json, then pass --reviewed to approve those exact facts.');
    const profile = normalizeProfile(JSON.parse(fs.readFileSync(path.join(home, 'profile.json'), 'utf8')));
    store.set('profile', profile); store.set('reviewed', true);
    console.log('Profile approved locally. Unknown facts still require manual answers.');
  } else if (command === 'remember') {
    const input = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const entries = rememberAnswer(store.answers(), input);
    store.saveAnswer(entries.at(-1)); console.log('Reviewed answer saved locally.');
  } else if (command === 'status') {
    console.log(JSON.stringify({ home, reviewed: store.get('reviewed') === true, missing: profileGaps(store.get('profile') || {}), savedAnswers: store.answers().length, stopped: store.get('stopped') === true }, null, 2));
  } else if (command === 'rank-jobs') {
    const { rankJob } = require('../smartApply/ranking');
    const jobs = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    if (!Array.isArray(jobs)) throw Error('Provide a JSON array of sourced job records.');
    if (store.get('reviewed') !== true) throw Error('Review and approve the local resume profile first.');
    const ranked = jobs.map(job => rankJob(job, store.get('profile'))).sort((a, b) => b.matchScore - a.matchScore);
    const target = path.join(home, 'ranked-jobs.json'); fs.writeFileSync(target, JSON.stringify(ranked, null, 2), { mode: 0o600 });
    console.log(`Ranked ${ranked.length} jobs locally: ${target}`);
  } else if (command === 'stop' || command === 'resume') {
    store.set('stopped', command === 'stop'); console.log(command === 'stop' ? 'Local apply engine stopped.' : 'Local apply engine enabled; manual submission only.');
  } else throw Error('Usage: node scripts/smartApply.js import-profile FILE | approve-profile --reviewed | remember FILE | rank-jobs FILE | status | stop | resume');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store.close(); }
