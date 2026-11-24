const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const sentence = value => /[.!?]$/.test(value) ? value : value + '.';
const tokens = value => new Set(clean(value).toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || []);
const generic = new Set('about yourself your tell what share describe most relevant experience project projects one two built working with have role this example where skills explain'.split(' '));

export function resumeAnswerDraft({ labelText, descriptionText }, profile) {
  const question = clean(labelText).toLowerCase();
  if (!question || /why|motivat|goal|prefer|weakness|failure|conflict|leadership|challenge|time when/i.test(question)) return null;
  const introduction = /about yourself|introduce yourself|professional summary/.test(question);
  const experience = /experience|internship/.test(question);
  const project = /project|something you (?:built|developed)/.test(question);
  if (!introduction && !experience && !project) return null;
  const guidance = clean(descriptionText).split(/(?:what you built|your contribution|how you evaluated|what you learned)/i)[0];
  const topics = [...tokens(question + ' ' + guidance)].filter(word => !generic.has(word));
  const examples = [
    ...(project && !experience ? [] : (profile.experience || []).flatMap(entry => {
      const title = clean(entry.title), company = clean(entry.company);
      return title && company ? (entry.bullets || []).map(fact => ({
        prefix: `During my internship at ${company} as ${title}, I`, fact: clean(fact), source: `${company} internship`
      })) : [];
    })),
    ...(experience && !project && !introduction ? [] : (profile.projects || []).flatMap(entry => {
      const name = clean(entry.name);
      return name ? (entry.bullets?.length ? entry.bullets : [entry.one_line]).map(fact => ({
        prefix: `One project I worked on was ${name}`, fact: clean(fact), source: `${name} project`
      })) : [];
    }))
  ].filter(entry => entry.fact && entry.fact.length <= 500).map(entry => {
    const words = tokens(entry.fact + ' ' + entry.source);
    return { ...entry, score: topics.filter(word => words.has(word)).length };
  }).sort((a, b) => b.score - a.score);
  const example = examples[0];
  const degree = clean(profile.degree);
  const major = clean(profile.major);
  const college = clean(profile.college);
  const intro = introduction && degree && major && college ? `I'm pursuing a ${degree} in ${major} at ${college}.` : '';
  if (!introduction && topics.length && !example?.score) return null;
  if (!example) return intro ? { answer: intro, sources: ['Education on reviewed resume'] } : null;
  const action = example.fact.replace(/^(Built|Developed|Designed|Implemented|Created|Worked|Led|Improved|Integrated|Added)\b/, verb => verb.toLowerCase());
  const detail = example.prefix.endsWith(', I') && action !== example.fact
    ? sentence(example.prefix + ' ' + action)
    : `${example.prefix.replace(/, I$/, '')}. ${sentence(example.fact)}`;
  return { answer: [intro, detail].filter(Boolean).join(' '), sources: [example.source + ' on reviewed resume'] };
}
