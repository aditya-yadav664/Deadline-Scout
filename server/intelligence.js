import { randomUUID } from 'node:crypto';
import { evidenceIdentity } from '../extension/shared/milestone-selection.js';
import { instant, scheduleKey } from '../extension/shared/dates.js';

const categories = [
  ['availability', /^(?:registration|applications?|admissions?)\s+(?:status|availability|(?:is |are )?(?:open|closed)\b)/i],
  ['eligibility', /^(?:eligibility(?: criteria)?|who can apply|eligible applicants?|minimum qualifications?)\b/i],
  ['fee', /^(?:(?:application|registration|entry|exam)\s+fees?|fees?)\b/i],
  ['documents', /^(?:required documents?|documents? required|supporting documents?|attachments?)\b/i],
  ['interview', /^(?:interview (?:dates?|schedule|rounds?))\b/i],
  ['exam', /^(?:exam(?:ination)? (?:dates?|schedule|timetable))\b/i],
  ['location', /^(?:(?:event|exam|interview)\s+)?(?:venue|location)\b/i],
  ['instructions', /^(?:application (?:instructions|process|procedure)|how to apply)\b/i],
  ['submission', /^submission (?:instructions|requirements|format)\b/i],
  ['announcement', /^(?:official (?:announcement|notice)|announcement|important update)\b/i],
  ['status', /^(?:application status|admission status)\b/i],
  ['selection', /^(?:selection (?:process|criteria)|shortlisting)\b/i],
  ['restrictions', /^(?:restrictions|terms of participation)\b/i]
];

const normalize = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export function extractFacts(text) {
  const facts = new Map();
  let heading;
  for (const raw of String(text || '').slice(0, 80000).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > 500 || /^(?:advertisement|sponsored|cookie|subscribe)\b/i.test(line)) continue;
    const category = categories.find(([, pattern]) => pattern.test(line));
    if (category) {
      const [label, value] = line.split(/:(.*)/s);
      if (!value?.trim() && category[1].exec(line)?.[0].length === line.replace(/:$/, '').length) {
        heading = { category: category[0], label: label.trim() };
        continue;
      }
      heading = undefined;
      const labelText = value ? label : category[1].exec(line)[0];
      const entry = { category: category[0], label: labelText.trim(), value: value?.trim() || line, evidence: line };
      facts.set(normalize(entry.category + ' ' + entry.value), entry);
    } else if (heading) {
      const entry = { ...heading, value: line, evidence: line };
      facts.set(normalize(entry.category + ' ' + entry.value), entry);
      // A bullet list can contain more than one requirement. Standalone prose ends the section capture.
      if (!/^[-•*]|^\d+[.)]/.test(line)) heading = undefined;
    }
    if (facts.size >= 18) break;
  }
  return [...facts.values()];
}

function diffFacts(before, after) {
  const changes = [];
  const key = fact => normalize(fact.value).replace(/^[-•*]\s*|^\d+[.)]\s*/, '');
  for (const [category] of categories) {
    const old = before.filter(fact => fact.category === category);
    const next = after.filter(fact => fact.category === category);
    const removed = old.filter(fact => !next.some(candidate => key(fact) === key(candidate)));
    const added = next.filter(fact => !old.some(candidate => key(fact) === key(candidate)));
    if (removed.length === 1 && added.length === 1) changes.push({ category, before: removed[0], after: added[0] });
    else {
      for (const fact of removed) changes.push({ category, before: fact, after: null });
      for (const fact of added) changes.push({ category, before: null, after: fact });
    }
  }
  return changes;
}

export function recordIntelligence(store, owner, track, observations, at) {
  const previous = store.get(owner, 'intelligence', track.id);
  const sources = { ...previous?.sources };
  const changes = [...(previous?.changes || [])];
  for (const observation of observations) {
    if (observation.readability === 'requires_browser' || !observation.text?.trim()) continue;
    const url = observation.requestedUrl;
    // A redirect to a different document does not prove the older facts were removed.
    const sourceUrl = observation.url || url;
    const prior = sources[url];
    const facts = extractFacts(observation.text);
    if (prior?.sourceUrl === sourceUrl) {
      for (const change of diffFacts(prior.facts, facts)) {
        changes.unshift({
          id: randomUUID(), at, sourceUrl, title: observation.title || track.title,
          ...change, confidence: change.after && change.before ? 'high' : 'review',
          reviewedAt: null
        });
      }
    }
    sources[url] = { sourceUrl, at, facts };
  }
  if (observations.length) store.put(owner, 'intelligence', track.id, {
    version: 1, trackId: track.id, sources, changes: changes.slice(0, 40)
  });
}

export function verificationFor(track, sources) {
  return track.milestones.filter(milestone => !milestone.manual).map(milestone => {
    const duplicates = track.milestones.filter(item => item.kind === milestone.kind && !item.manual).length > 1;
    const label = entry => normalize(String(entry.sourceLabel || entry.label || ''));
    const evidence = sources.flatMap(source => (source.history[0]?.evidence || [])
      .filter(item => item.kind === milestone.kind &&
        (item.kind !== 'custom' || label(item) === label(milestone)) &&
        (!duplicates || evidenceIdentity(item) === evidenceIdentity(milestone)))
      .map(item => ({ ...item, requestedUrl: source.url, at: source.checkedAt })));
    const normalized = item => { try { return item.time ? instant(item) : item.date; } catch { return scheduleKey(item); } };
    const values = new Set(evidence.map(normalized));
    const domains = new Set(evidence.map(item => new URL(item.sourceUrl).hostname.replace(/^www\./i, '')));
    const unavailable = sources.some(source => !source.history?.length || source.history[0].status === 'unavailable');
    const status = values.size > 1 ? 'conflict'
      : evidence.some(item => item.uncertain) || values.size && !values.has(normalized(milestone)) ? 'uncertain'
      : domains.size > 1 && !unavailable ? 'corroborated' : 'unverified';
    return { id: milestone.id, label: milestone.label, status, evidence };
  });
}

export function riskFor(track, verification, content, { now = Date.now(), signups = [], workspace } = {}) {
  const days = 86400000;
  const confirmed = track.milestones.flatMap(milestone => {
    try {
      const deadline = milestone.time ? Date.parse(instant(milestone)) : Date.parse(milestone.date + 'T23:59:59+05:30');
      return Number.isFinite(deadline) && deadline >= now ? [{ milestone, deadline }] : [];
    } catch { return []; }
  }).sort((a, b) => a.deadline - b.deadline)[0];
  const remainingHours = confirmed ? Math.ceil((confirmed.deadline - now) / 3600000) : null;
  const blocked = verification.some(item => item.status === 'conflict' || item.status === 'uncertain') ||
    ['conflict', 'check_failed', 'date_missing', 'needs_review'].includes(track.status);
  const recent = content?.changes?.some(change => !change.reviewedAt && Date.parse(change.at) > now - 7 * days);
  const pendingSignup = signups.some(item => ['Draft','Waiting for browser','Needs review','Submission requested'].includes(item.status)) &&
    !signups.some(item => ['Confirmed','Already registered'].includes(item.status));
  const documents = workspace?.checklist.filter(item => item.required && !item.done).length || 0;
  const tasks = workspace?.tasks.filter(task => !task.done).length || 0;
  const highPriority = workspace?.priority === 'high';
  const level = remainingHours !== null && remainingHours <= 24 ? 'Critical'
    : blocked || remainingHours !== null && (remainingHours <= 72 || remainingHours <= 168 && (documents || tasks)) ? 'High'
    : recent || pendingSignup || documents || tasks || highPriority || remainingHours !== null && remainingHours <= 168 ? 'Moderate' : confirmed ? 'Low' : 'Unknown';
  const reasons = [
    confirmed ? confirmed.milestone.label + ' is due in ' + remainingHours + ' hours.' : 'No upcoming confirmed milestone.',
    ...(blocked ? ['Check the latest source evidence before acting.'] : []),
    ...(recent ? ['A recent source change is waiting for review.'] : []),
    ...(pendingSignup ? ['A saved signup still needs completion or organizer confirmation.'] : []),
    ...(documents ? [documents + ' required checklist item(s) still open.'] : []),
    ...(tasks ? [tasks + ' application task(s) still open.'] : []),
    ...(highPriority ? ['Marked high priority in your workspace.'] : []),
    ...(verification.length && verification.every(item => item.status === 'unverified') ? ['Dates have no cross-domain corroboration.'] : [])
  ];
  return { level, remainingHours, reasons, next: blocked ? 'Review the source evidence' : documents ? 'Review the document checklist' : tasks ? 'Open the dependency planner' : pendingSignup ? 'Open Backup Signup and review the draft' : recent ? 'Review the source change' : 'Review your next deadline' };
}
