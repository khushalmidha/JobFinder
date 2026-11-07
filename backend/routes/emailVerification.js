const express = require('express');
const auth = require('../middleware/auth');
const {createEmailVerificationService} = require('../services/emailVerificationService');
function createRouter(options = {}) {
  const router = express.Router(), service = createEmailVerificationService(options);
  router.use(auth);
  const wrap = fn => async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:error.message});}};
  router.get('/',wrap(async(req,res)=>res.json(await service.status(req.user._id))));
  router.post('/request',wrap(async(req,res)=>res.json(await service.requestCode(req.user._id,{approved:req.body.approved===true}))));
  router.post('/confirm',wrap(async(req,res)=>res.json(await service.confirmCode(req.user._id,req.body.code))));
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
