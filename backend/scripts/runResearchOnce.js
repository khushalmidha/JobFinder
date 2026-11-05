// Explicit local execution. No cloud resources, email send, or paid providers.
require('dotenv').config();
const mongoose=require('mongoose');
const {runResearchOnce}=require('../services/researchQueueService');
async function main(){
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jobfinder');
  try{console.log(JSON.stringify(await runResearchOnce(),null,2));}
  finally{await mongoose.disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
