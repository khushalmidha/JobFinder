const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  identity: { type: String, required: true },
  company: String,
  domain: String,
  name: String,
  title: String,
  kind: String,
  sourceUrl: String,
  observedAt: Date
});
schema.index({ userId: 1, identity: 1 }, { unique: true });
module.exports = mongoose.model('ProfessionalResearchPerson', schema);
