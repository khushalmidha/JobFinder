const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Audit = require('../models/AdminRoleMigration');
const Challenge = require('../models/EmailVerificationChallenge');
const Receipt = require('../models/EmailVerificationReceipt');
const { promoteVerifiedAdmin, snapshot } = require('../services/adminRoleMigrationService');
const { parseArgs } = require('../scripts/promoteVerifiedAdmin');
let mongo, server, base, owner;
const secret = 'admin-migration-synthetic-auth-secret';
const now = new Date('2026-11-07T10:00:00Z');
const verifiedAt = new Date('2026-11-06T10:00:00Z');
const verification = email => ({ emailVerified: true, emailVerifiedAt: verifiedAt,
  emailVerificationProof: { method: 'email_code', issuer: 'jobfinder_trusted_server_sender', subject: email, verifiedAt, challengeId:require('node:crypto').randomUUID() } });
async function fixture(email, extra = {}) {
  const user = await User.create({ name: 'Synthetic Migration User', email, passwordHash: 'fixture-not-a-real-password', ...extra });
  if(extra.emailVerified && extra.emailVerificationProof){await Challenge.create({_id:user._id,email,generation:extra.emailVerificationProof.challengeId,state:'consumed',consumedAt:extra.emailVerifiedAt});await Receipt.create({_id:extra.emailVerificationProof.challengeId,userId:user._id,email,consumedAt:extra.emailVerifiedAt});}
  return user;
}
before(async () => {
  process.env.JWT_SECRET = secret;
  process.env.OUTREACH_SENDING_ENABLED = 'false';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Audit.init(), Challenge.init(), Receipt.init()]);
  owner = await fixture('settings-owner@fixture.example');
  const app = express(); app.use(express.json()); app.use('/auth', require('../routes/auth'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}, { timeout: 300000 });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
async function request(path, method, body, authenticated = true) {
  const result = await fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${jwt.sign({ _id: String(owner._id) }, secret)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: result.status, data: await result.json() };
}

test('settings API preserves identity/role/verification and accepts ordinary preferences', async () => {
  const beforeUser = await User.findById(owner._id).lean();
  const result = await request('/auth/settings', 'PATCH', {
    name: 'Updated preference', resumeLink: 'https://fixture.example/resume', dailyEmailLimit: 10,
    blockedCompanies: ['Example Employer'], candidateProfile: { fullName: 'Example Applicant', role: 'admin' },
    role: 'admin', email: 'attacker@fixture.example', emailVerified: true, emailVerifiedAt: verifiedAt,
    emailVerificationProof: verification(owner.email).emailVerificationProof,
    adminRoleMigrationId: 'forged-owner-migration', isSharedContactApproved: true,
    passwordHash: 'overwritten', _id: String(new mongoose.Types.ObjectId()),
    createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z',
    $set: { role: 'admin' }, 'emailVerificationProof.subject': owner.email
  });
  assert.equal(result.status, 200);
  const afterUser = await User.findById(owner._id).lean();
  assert.equal(afterUser.name, 'Updated preference'); assert.equal(afterUser.resumeLink, 'https://fixture.example/resume');
  assert.equal(afterUser.role, 'user'); assert.equal(afterUser.email, beforeUser.email);
  assert.equal(afterUser.emailVerified, false); assert.equal(afterUser.emailVerifiedAt, undefined);
  assert.equal(afterUser.emailVerificationProof, undefined); assert.equal(afterUser.adminRoleMigrationId, undefined);
  assert.equal(afterUser.passwordHash, beforeUser.passwordHash); assert.equal(afterUser.isSharedContactApproved, false);
  assert.equal(afterUser.createdAt.getTime(), beforeUser.createdAt.getTime());
  assert.equal(afterUser.candidateProfile.role, undefined);
  assert.equal(result.data.emailVerificationProof, undefined); assert.equal(result.data.adminRoleMigrationId, undefined);
  assert.equal((await request('/auth/settings', 'PATCH', { role: 'admin' }, false)).status, 401);
});

test('signup ignores admin and verification payload fields', async () => {
  const email = 'signup-admin-attempt@fixture.example';
  const result = await request('/auth/signup', 'POST', { name: 'Signup Fixture', email, password: 'Fixture-password-12345',
    role: 'admin', ...verification(email), adminRoleMigrationId: 'signup-fake-migration' }, false);
  assert.equal(result.status, 200);
  const user = await User.findOne({ email }).lean();
  assert.equal(user.role, 'user'); assert.equal(user.emailVerified, false);
  assert.equal(user.emailVerificationProof, undefined); assert.equal(user.emailVerifiedAt, undefined);
  assert.equal(user.adminRoleMigrationId, undefined);
});

test('admin migration rejects missing/unverified/inconsistent evidence without fabricating identity', async () => {
  await assert.rejects(promoteVerifiedAdmin({ email: 'missing@fixture.example', migrationId: 'missing-account-001', apply: true, now }), /not found/);
  const variants = [ {}, { emailVerified: true },
    { emailVerified: true, emailVerifiedAt: verifiedAt },
    { ...verification('wrong@fixture.example') },
    { ...verification('future@fixture.example'), emailVerifiedAt: new Date('2027-01-01T00:00:00Z') } ];
  for (const [index, extra] of variants.entries()) {
    const email = `unverified-${index}@fixture.example`; const user = await fixture(email, extra);
    const result = await promoteVerifiedAdmin({ email, migrationId: `unverified-case-${index}`, apply: true, now });
    assert.equal(result.eligible, false); assert.equal(result.applied, false);
    const persisted = await User.findById(user._id).lean(); assert.equal(persisted.role, 'user');
    assert.equal(persisted.adminRoleMigrationId, undefined);
  }
});

test('verified migration preview is read-only; apply records preimage and is idempotent', async () => {
  const email = 'verified-promote@fixture.example'; const user = await fixture(email, verification(email));
  const migrationId = 'verified-owner-migration-001';
  const preview = await promoteVerifiedAdmin({ email, migrationId, now });
  assert.equal(preview.eligible, true); assert.equal(preview.applied, false);
  assert.equal(await Audit.countDocuments({ _id: migrationId }), 0);
  assert.equal((await User.findById(user._id)).role, 'user');
  const applied = await promoteVerifiedAdmin({ email, migrationId, apply: true, now });
  assert.equal(applied.applied, true);
  const audit = await Audit.findById(migrationId).lean();
  assert.equal(audit.before.role, 'user'); assert.equal(audit.after.role, 'admin'); assert.equal(audit.status, 'applied');
  assert.equal(audit.before.email, email); assert.equal(audit.before.verificationProofHash.length, 64);
  const repeated = await promoteVerifiedAdmin({ email, migrationId, apply: true, now });
  assert.equal(repeated.idempotent, true); assert.equal(await Audit.countDocuments({ _id: migrationId }), 1);
  const otherEmail = 'other-verified@fixture.example'; await fixture(otherEmail, verification(otherEmail));
  await assert.rejects(promoteVerifiedAdmin({ email: otherEmail, migrationId, apply: true, now }), /different account/);
});

test('expired pending migration recovers an attributable post-CAS crash; active lease blocks another operator', async () => {
  const email = 'crash-recovery@fixture.example'; const user = await fixture(email, verification(email));
  const migrationId = 'crash-recovery-migration-001';
  await Audit.create({ _id: migrationId, userId: user._id, email, actor: 'synthetic_crashed_operator', status: 'pending',
    before: snapshot(user.toObject()), leaseOwner: 'crashed', leaseUntil: new Date(now.getTime() + 1000) });
  await assert.rejects(promoteVerifiedAdmin({ email, migrationId, apply: true, now }), /in progress/);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin', adminRoleMigrationId: migrationId } });
  await Audit.updateOne({ _id: migrationId }, { $set: { leaseUntil: new Date(now.getTime() - 1000) } });
  const recovered = await promoteVerifiedAdmin({ email, migrationId, apply: true, now });
  assert.equal(recovered.recovered, true);
  const audit = await Audit.findById(migrationId).lean(); assert.equal(audit.status, 'applied'); assert.equal(audit.recovered, true);
});

test('pending migration refuses changed verification evidence and records failure', async () => {
  const email = 'changed-evidence@fixture.example'; const user = await fixture(email, verification(email));
  const migrationId = 'changed-evidence-migration-001';
  await Audit.create({ _id: migrationId, userId: user._id, email, actor: 'synthetic_operator', status: 'pending', before: snapshot(user.toObject()), leaseUntil: new Date(now.getTime() - 1000) });
  await User.updateOne({ _id: user._id }, { $set: { 'emailVerificationProof.challengeId': '00000000-0000-4000-8000-000000000002' } });
  await Challenge.updateOne({_id:user._id},{$set:{generation:'00000000-0000-4000-8000-000000000002'}});
  await Receipt.create({_id:'00000000-0000-4000-8000-000000000002',userId:user._id,email,consumedAt:verifiedAt});
  await assert.rejects(promoteVerifiedAdmin({ email, migrationId, apply: true, now }), /changed since/);
  assert.equal((await User.findById(user._id)).role, 'user');
  assert.equal((await Audit.findById(migrationId)).status, 'failed');
});

test('concurrent migration claims cannot create duplicate audit records or re-promote', async () => {
  const email = 'concurrent-promote@fixture.example'; await fixture(email, verification(email));
  const migrationId = 'concurrent-owner-migration-001';
  const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => promoteVerifiedAdmin({ email, migrationId, apply: true, now })));
  assert.ok(outcomes.some(outcome => outcome.status === 'fulfilled' && outcome.value.applied));
  assert.equal(await Audit.countDocuments({ _id: migrationId }), 1);
  assert.equal((await Audit.findById(migrationId)).status, 'applied');
  assert.equal((await User.findOne({ email })).adminRoleMigrationId, migrationId);
});

test('CLI defaults to preview and rejects unsupported arguments', () => {
  assert.deepEqual(parseArgs(['--email', 'owner@fixture.example', '--migration-id', 'fixture-migration']), { apply: false, email: 'owner@fixture.example', migrationId: 'fixture-migration' });
  assert.equal(parseArgs(['--email', 'owner@fixture.example', '--migration-id', 'fixture-migration', '--apply']).apply, true);
  assert.throws(() => parseArgs(['--role', 'admin']), /Use --email/);
});
