const Contact = require('../models/Contact');
exports.scanBounces = async (req,res) => {
  try{
    const report=await require('../services/providerDsnService').scanProviderBounces(req.user._id,{apply:true,maxMessages:200,cursors:req.body?.cursors||{}});
    res.json({...report,message:'Verified provider 5.1.1 failures suppressed; uncertain or unmatched notices preserved for review.'});
  }catch{res.status(502).json({error:'Mailbox scan incomplete. Check TLS mailbox settings; no unverified failure was treated as invalid.'});}
};
exports.deleteBounced = async (req, res) => {
  try {
    // Legacy bounce labels can be untrusted. Quarantine without asserting that
    // a mailbox is invalid, and retain stronger existing suppression reasons.
    const result = await Contact.updateMany({ userId: req.user._id, status: 'bounced', suppressedAt: null }, { $set: { suppressedAt: new Date(), suppressionReason: 'Legacy bounce quarantine; mailbox existence inconclusive' } });
    res.json({ message: 'Bounced contacts quarantined; history preserved.', suppressedCount: result.modifiedCount, deletedCount: 0 });
  } catch (_) { res.status(500).json({ error: 'Bounce quarantine failed' }); }
};
