"""Local resume + supplied seed -> private canonical JSON. Requires PyMuPDF.
Never infers location, authorisation, marks, or claims missing from the seed.
Review generated JSON against resume before approving in Smart Apply.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import pymupdf

parser = argparse.ArgumentParser()
parser.add_argument('resume')
parser.add_argument('seed')
parser.add_argument('output')
args = parser.parse_args()
resume = Path(args.resume)
doc = pymupdf.open(resume)
text = '\n'.join(page.get_text() for page in doc)
links = [link['uri'] for page in doc for link in page.get_links() if link.get('uri')]
profile = json.loads(Path(args.seed).read_text(encoding='utf-8-sig'))
identity = profile.setdefault('identity', {})
sources = {}
for section in ('identity', 'links', 'education', 'experience', 'projects', 'skills', 'achievements', 'preferences'):
    values = profile.get(section, {})
    keys = values.keys() if isinstance(values, dict) else range(len(values)) if isinstance(values, list) else []
    for key in keys:
        if values[key] is not None:
            sources[f'{section}.{key}'] = 'supplied_profile_seed'

emails = sorted(set(re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', text)))
if len(emails) == 1:
    identity['email'] = emails[0]
    sources['identity.email'] = 'resume_pdf_text'
phones = sorted(set(re.findall(r'\+\d{1,3}[\s-]*\d[\d\s-]{8,15}\d', text)))
if len(phones) == 1:
    sources['identity.phone'] = 'resume_pdf_text'
    identity['phone'] = re.sub(r'[\s-]+', '', phones[0])
patterns = {'linkedin': r'^https://(?:www\.)?linkedin\.com/in/', 'github': r'^https://github\.com/[^/]+/?$', 'leetcode': r'^https://leetcode\.com/(?:u/)?[^/]+/?$', 'codeforces': r'^https://codeforces\.com/profile/', 'codechef': r'^https://www\.codechef\.com/users/', 'cses': r'^https://cses\.fi/user/'}
for key, pattern in patterns.items():
    candidates = sorted(set(url for url in links if re.search(pattern, url)))
    if len(candidates) == 1:
        profile.setdefault('links', {})[key] = candidates[0]
        sources[f'links.{key}'] = 'resume_pdf_link'
# Portfolio must be selected from an actual PDF link, never constructed from name.
provided_portfolio = profile.get('links', {}).get('portfolio')
if provided_portfolio not in links:
    profile.setdefault('links', {})['portfolio'] = None
elif provided_portfolio:
    sources['links.portfolio'] = 'resume_pdf_link'
profile['_fieldSources'] = sources
profile['_resume'] = {'filename': resume.name, 'sha256': hashlib.sha256(resume.read_bytes()).hexdigest(), 'reviewed': False, 'links': links}
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Wrote local profile: {output}. Resume review required; no data uploaded.')
