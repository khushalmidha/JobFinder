const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const auth = require('../middleware/auth');

router.get('/', auth, contactController.getContacts);
router.get('/companies', auth, contactController.getCompanies);
router.post('/bulk', auth, contactController.bulkCreate);
router.post('/block-emails', auth, require('./recipientBlocks').block);
router.post('/unblock-emails', auth, require('./recipientBlocks').unblock);
router.patch('/:id', auth, contactController.updateContact);
router.delete('/:id', auth, contactController.deleteContact);

router.post('/owner-checked',auth,async(req,res)=>{
  const mongoose=require('mongoose');
  const {ids,checked}=req.body;
  if(typeof checked!=='boolean'||!Array.isArray(ids)||!ids.length||ids.length>2000||ids.some(id=>typeof id!=='string'||!mongoose.isValidObjectId(id)))
    return res.status(400).json({error:'Select owned contacts and confirm the check'});
  try {
    const userId=req.user._id;
    const result=await require('../models/Contact').updateMany({userId,_id:{$in:ids}},
      checked?{$set:{ownerVerifiedAt:new Date()}}:{$unset:{ownerVerifiedAt:1}});
    contactController.invalidateContactCache(userId);
    res.json({updated:result.modifiedCount});
  } catch {
    res.status(500).json({error:'Could not update personal contact checks'});
  }
});
// Manual Share and Reply endpoints
router.put('/:id/toggle-shared', auth, contactController.toggleShared);
router.put('/:id/mark-replied', auth, contactController.markReplied);
router.post('/bulk-toggle-shared', auth, contactController.bulkToggleShared);
router.post('/bulk-mark-replied', auth, contactController.bulkMarkReplied);
router.post('/bulk-delete', auth, contactController.bulkDelete);

// Email Deliverability & Verification endpoints
router.post('/validate-deliverability', auth, contactController.validateDeliverability);
router.post('/bulk-deliverability', auth, contactController.batchMarkDeliverability);
router.put('/:id/deliverability', auth, contactController.markDeliverability);

module.exports = router;
