import { normalizeProfile } from './candidateProfile.js';
import { normalizeProfileLink } from './formFillerCore.js';

export const defaultResumeKey = 'smartApplyDefaultResume';
const linkKinds = ['scholar', 'orcid', 'researchgate', 'research', 'linkedin', 'github'];
export const linkMemoryKeys = linkKinds.map(linkStorageKey);
export const rememberLinkPreference = 'smartApplyRememberLinks';

export function profileOwner(profile) {
  return String(profile?.identity?.email || profile?.email || '').trim().toLowerCase();
}
function linkStorageKey(kind) { return `smartApplyLearnedLink:${kind}`; }

export async function readSmartApplyPreferences(withResume = false) {
  const keys = ['candidateProfile', 'candidateProfileReviewed', 'candidateProfileVersion', rememberLinkPreference, ...linkMemoryKeys];
  if (withResume) keys.push(defaultResumeKey);
  const data = await chrome.storage.local.get(keys);
  const owner = profileOwner(data.candidateProfile);
  const learnedLinks = {};
  if (owner) {
    for (const kind of linkKinds) {
      const saved = data[linkStorageKey(kind)];
      if (saved?.owner !== owner) continue;
      const url = normalizeProfileLink(kind, saved.url);
      if (url) learnedLinks[kind] = url;
    }
  }
  const profile = data.candidateProfile && normalizeProfile(data.candidateProfile);
  if (profile) profile.links = { ...profile.links, ...learnedLinks };
  return {
    ...data,
    owner,
    profile,
    learnedLinks,
    defaultResume: data[defaultResumeKey]?.owner === owner && owner ? data[defaultResumeKey] : null,
    rememberLinks: data[rememberLinkPreference] !== false
  };
}

export async function rememberProfileLink(kind, value, expectedOwner) {
  if (!linkKinds.includes(kind)) return false;
  const url = normalizeProfileLink(kind, value);
  if (!url) return false;
  const data = await chrome.storage.local.get(['candidateProfile', 'candidateProfileReviewed', rememberLinkPreference, linkStorageKey(kind)]);
  const owner = profileOwner(data.candidateProfile);
  if (!owner || owner !== expectedOwner || !data.candidateProfileReviewed || data[rememberLinkPreference] === false) return false;
  if (data[linkStorageKey(kind)]?.owner === owner && data[linkStorageKey(kind)]?.url === url) return false;
  await chrome.storage.local.set({ [linkStorageKey(kind)]: { owner, url } });
  return true;
}

export async function forgetProfileLink(kind, expectedOwner) {
  if (!linkKinds.includes(kind) || !expectedOwner) return;
  const key = linkStorageKey(kind);
  const saved = (await chrome.storage.local.get(key))[key];
  if (saved?.owner === expectedOwner) await chrome.storage.local.remove(key);
}
