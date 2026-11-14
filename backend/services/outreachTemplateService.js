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

  const values = {
    companyname: company,
    company: company,
    hrname: hrName,
    name: hrName,
    role: role,
    joblink: jobLink,
    username: userName,
    college: college,
    cgpa: cgpa,
    useremail: userEmail,
    userphone: userPhone,
    resumelink: resumeLink
  };

  // Single-pass replacement with callback function:
  // In JavaScript, a replacement function NEVER interprets $, $&, $`, $', $$!
  // And a single pass guarantees that values containing {{otherPlaceholder}} are never re-evaluated.
  // Unknown placeholders remain literal as typed by user.
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, tag) => {
    const key = tag.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key] ?? '');
    }
    return match;
  });
}

module.exports = { renderTemplateText };
