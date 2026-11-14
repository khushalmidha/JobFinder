function renderTemplateText(templateText, { user = {}, contact = {}, jobLinkOverride = '', roleOverride = '' } = {}) {
  if (!templateText || typeof templateText !== 'string') return '';
  const company = contact.company || '';
  const hrName = contact.hrName || 'recruiting team';
  const role = roleOverride || contact.role || 'Software Engineering';
  const jobLink = jobLinkOverride || contact.jobLink || '';
  const userName = user.name || user.candidateProfile?.fullName || '';
  const college = user.candidateProfile?.college || user.college || '';
  const cgpa = user.candidateProfile?.cgpa || user.cgpa || '';
  const userEmail = user.email || user.candidateProfile?.email || '';
  const userPhone = user.candidateProfile?.phone || user.phone || '';
  const resumeLink = user.resumeLink || user.candidateProfile?.resumeUrl || '';

  return templateText
    .replace(/\{\{\s*(?:companyName|company)\s*\}\}/gi, company)
    .replace(/\{\{\s*(?:hrName|name)\s*\}\}/gi, hrName)
    .replace(/\{\{\s*role\s*\}\}/gi, role)
    .replace(/\{\{\s*jobLink\s*\}\}/gi, jobLink)
    .replace(/\{\{\s*userName\s*\}\}/gi, userName)
    .replace(/\{\{\s*college\s*\}\}/gi, college)
    .replace(/\{\{\s*cgpa\s*\}\}/gi, cgpa)
    .replace(/\{\{\s*userEmail\s*\}\}/gi, userEmail)
    .replace(/\{\{\s*userPhone\s*\}\}/gi, userPhone)
    .replace(/\{\{\s*resumeLink\s*\}\}/gi, resumeLink);
}

module.exports = { renderTemplateText };
