const crypto = require('node:crypto');
const Task = require('../models/ResearchTask');
const Company = require('../models/Company');
const { qualifyCompany } = require('./salaryEvidenceService');
const { policyFor } = require('./researchBudgetService');
const { scoutRecruiters } = require('./ghostScoutService');
async function enqueueCompanies(userId, companyIds) {
  if (!Array.isArray(companyIds) || !companyIds.length || companyIds.length > 10) throw new Error('Select one to ten qualified companies');
  const companies = await Company.find({ _id: { $in: companyIds } }).lean();
  if (companies.length !== new Set(companyIds.map(String)).size || companies.some(c => qualifyCompany(c).qualificationStatus !== 'qualified')) throw new Error('Every queued company needs current qualifying evidence');
  const tasks = [];
  for (const c of companies) {
    try {
      tasks.push(await Task.findOneAndUpdate({userId,companyId:c._id},{$setOnInsert:{status:'queued',availableAt:new Date()}},{upsert:true,returnDocument:'after'}));
    } catch(error) { if(error.code!==11000)throw error; }
  }
  return tasks;
}
async function runResearchOnce({ userId, scout = scoutRecruiters, now = new Date() } = {}) {
  if(process.env.RESEARCH_STOP==='true')return {status:'stopped'};
  await Task.updateMany({...(userId?{userId}:{}),status:'running',attempts:{$gte:3},leaseUntil:{$lt:now}},{$set:{status:'failed',lastError:'Worker lease expired after maximum attempts'},$unset:{leaseUntil:1,leaseToken:1}});
  const leaseToken=crypto.randomUUID();
  const task=await Task.findOneAndUpdate({ ...(userId?{userId}:{}), attempts:{$lt:3}, $or:[{status:'queued',availableAt:{$lte:now}},{status:'running',leaseUntil:{$lt:now}}]},
    {$set:{status:'running',leaseUntil:new Date(now.getTime()+300000),leaseToken},$inc:{attempts:1}},{sort:{availableAt:1},returnDocument:'after'});
  if(!task)return {status:'idle'};
  const ownership={_id:task._id,leaseToken};
  try {
    const policy=await policyFor(task.userId);
    if(policy.stopped){
      await Task.updateOne(ownership,{$set:{status:'queued',availableAt:new Date(Date.now()+3600000)},$inc:{attempts:-1},$unset:{leaseToken:1,leaseUntil:1}});
      return {status:'stopped'};
    }
    const company=await Company.findById(task.companyId).lean();
    if(!company || qualifyCompany(company).qualificationStatus!=='qualified')throw new Error('Company evidence no longer qualifies');
    const result=await scout({userId:task.userId,domain:company.domain,companyQuery:company.name});
    const report={sourcedContacts:result.totalFound,addedContacts:result.addedCount,requestsUsed:result.requestsUsed,reason:result.reason};
    await Task.updateOne(ownership,{$set:{status:'complete',completedAt:new Date(),result:report},$unset:{leaseToken:1,leaseUntil:1,lastError:1}});
    return {status:'complete',taskId:task._id,...report};
  } catch(error) {
    const exhausted=task.attempts>=3;
    await Task.updateOne(ownership,{$set:{status:exhausted?'failed':'queued',lastError:error.message,availableAt:new Date(Date.now()+Math.min(86400000,60000*2**task.attempts)+Math.floor(Math.random()*10000))},$unset:{leaseToken:1,leaseUntil:1}});
    return {status:exhausted?'failed':'retry_scheduled',error:error.message};
  }
}
function initResearchScheduler() {
  if(process.env.RESEARCH_SCHEDULER_ENABLED!=='true')return;
  require('node-cron').schedule('*/15 * * * *',()=>runResearchOnce().catch(error=>console.error('Research worker error:',error.message)),{timezone:'Asia/Kolkata'});
}
module.exports={enqueueCompanies,runResearchOnce,initResearchScheduler};
