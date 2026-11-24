import { resumeAnswerDraft } from './resumeAnswerDraft.js';

const directionQuestion = /^which direction would you most like to work on first\??\s*\*?$/i;
const perception = 'Perception–memory integration';
const hardware = 'Sensor & hardware integration';
const normal = value => (value || '').replace(/\s+/g, ' ').trim();

export function perceptionApplicationDraft(context, profile, element, requireCommitted = false) {
  const document = element.ownerDocument;
  if (document.location.hostname !== 'binary.so' ||
      !/perception\s*&\s*embodied ai/i.test(document.title) ||
      !/\bMetaCognition\b/i.test(document.body?.textContent || '')) return null;

  const project = profile.projects?.find(entry => entry.name && /rag|retrieval/i.test(entry.one_line || '') &&
    /ranking|ranker/i.test(entry.one_line || ''));
  if (!project) return null;

  const question = normal(context.labelText);
  if (context.inputType === 'combobox' && directionQuestion.test(question))
    return { value: perception, source: 'Proposed research direction based on your retrieval and ranking project' };
  if (context.inputType !== 'textarea') return null;

  if (/^why metacognition, and what draws you to connecting perception with memory\?/i.test(question)) {
    return {
      value: `I want to understand how a system can use earlier observations when its current view is incomplete. Working on retrieval and ranking in ${project.name} made me interested in how systems decide what information to bring back at the right moment. At MetaCognition, I would like to explore that question with visual sequences and measure when memory actually improves the result.`,
      source: `${project.name} and the employer's perception and memory question`
    };
  }
  if (/^what would you try first in that direction, and why\?/i.test(question)) {
    const directions = [...document.querySelectorAll('label')].filter(label => directionQuestion.test(normal(label.textContent)));
    if (directions.length !== 1) return null;
    const wrapper = directions[0].parentElement?.parentElement;
    const controls = wrapper?.querySelectorAll('button[aria-haspopup="menu"]');
    if (controls?.length !== 1) return null;
    const selected = normal(controls[0].textContent);
    const direction = selected === 'Choose' && !requireCommitted ? perception : selected;
    if (direction === perception) return {
      value: 'I would start with short videos where an object disappears behind an occluder and reappears. Using the same frozen image encoder, I would compare a current-frame baseline, a short context window and a small memory that retrieves prior object embeddings. I would measure re-identification accuracy and latency as the occlusion gets longer, and inspect false matches to see when the memory retrieves stale information.',
      source: 'Proposed experiment for the Perception–memory integration choice'
    };
    if (direction === hardware) return {
      value: 'I would start with a reproducible replay of synchronized camera and inertial data, then compare a camera-only baseline with a simple fused estimate. I would inject frame drops and timestamp offsets and measure tracking error and recovery time. Replay gives a controlled way to find which failures come from synchronization before trying the same experiment on hardware.',
      source: 'Proposed experiment for the Sensor & hardware integration choice'
    };
    return null;
  }
  const draft = resumeAnswerDraft(context, profile);
  return draft ? { value: draft.answer, source: draft.sources.join(', ') } : null;
}
