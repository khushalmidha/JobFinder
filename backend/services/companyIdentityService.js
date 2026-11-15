// Reviewed contact-directory aliases only. Never fuzzy-merge unrelated employers
// or combine salary evidence, recruiting inboxes or contact history records.
const groups = {
  'Graviton Research Capital': ['Graviton', 'Graviton Trading', 'Gravitontrading', 'Graviton Traiding', 'Graviton Research', 'Graviton Research Capital'],
  Samsung: ['Samsung', 'Samasung', 'Sumsung', 'Samsung Bangalore', 'Samsung Bengaluru', 'Samsung Noida/Delhi', 'Samsung Delhi NCR', 'Sumsung Delhi NCR', 'Samasung Delhi NCR', 'Samsung Delhi', 'Samsung R&D (SRI-B / SRI-D)'],
  Atlassian: ['Atlassian']
};
const clean = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const aliasKey = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map(Object.entries(groups).flatMap(([name, values]) => values.map(value => [aliasKey(value), name])));
const canonicalCompany = value => aliases.get(aliasKey(value)) || clean(value);
const companyKey = value => canonicalCompany(value).toLowerCase();
function canonicalBlocks(values = []) { return [...new Map(values.filter(value=>typeof value==='string'&&clean(value)).map(value=>[companyKey(value),canonicalCompany(value)])).values()]; }
function normalizeUpdate(update) {
  if (!update || Array.isArray(update)) return;
  for (const target of [update, update.$set, update.$setOnInsert]) if (target && typeof target.company === 'string') {const original=target.company;target.company=canonicalCompany(original);if(original!==target.company&&!target.companyOriginalName)target.companyOriginalName=original;}
}
module.exports = { canonicalCompany, companyKey, canonicalBlocks, normalizeUpdate };
