import { randomUUID } from 'node:crypto';
import { riskFor, verificationFor } from './intelligence.js';
import { readApplication } from './applications.js';

const sourceLimit = 5;
const evidencePerSource = 12;

export function opportunityRiskList(store, owner, tracks) {
  const signups = Map.groupBy(store.list(owner, 'signup'), draft => draft.trackId);
  return tracks.map(track => {
    const content = store.get(owner, 'intelligence', track.id);
    const sources = store.get(owner, 'sourceHistory', track.id)?.sources || [];
    return {
      id: track.id,
      title: track.title,
      ...riskFor(track, verificationFor(track, sources), content, { signups: signups.get(track.id), workspace:readApplication(store,owner,track.id) })
    };
  });
}

export function recordSourceCheck(store, owner, track, observations, errors, checkedAt) {
  const previous = store.get(owner, 'sourceHistory', track.id)?.sources || [];
  const byUrl = new Map(observations.map(observation => [observation.requestedUrl, observation]));
  const failed = new Set(errors.map(error => error.url));
  const sources = (track.sources || [track.url]).slice(0, sourceLimit).map(url => {
    const history = previous.find(source => source.url === url)?.history || [];
    const observation = byUrl.get(url);
    const evidence = (observation?.milestones || [])
      .filter(milestone => milestone.quote)
      .slice(0, evidencePerSource)
      .map(({ kind, label, sourceLabel, date, time, zone, quote, sourceUrl, uncertain }) => ({
        kind, label, sourceLabel, date, time, zone, quote: String(quote).slice(0, 500),
        sourceUrl: sourceUrl || url, uncertain: !!uncertain
      }));
    const status = failed.has(url) ? 'unavailable' : evidence.length ? 'observed' : 'no_evidence';
    const latest = history[0];
    if (latest?.status === status && JSON.stringify(latest.evidence) === JSON.stringify(evidence)) {
      return { url, checkedAt, history };
    }
    return { url, checkedAt, history: [{ id: randomUUID(), at: checkedAt, status, evidence }, ...history].slice(0, 4) };
  });
  store.put(owner, 'sourceHistory', track.id, { version: 1, sources });
}

export function opportunityDetail(store, owner, id) {
  const track = store.get(owner, 'track', id);
  if (!track) return null;
  const history = store.get(owner, 'sourceHistory', id)?.sources || [];
  const sources = [...new Set([track.url, ...(track.sources || [])])].map(url =>
    history.find(source => source.url === url) || { url, checkedAt: null, history: [] });
  const content = store.get(owner, 'intelligence', id);
  const verification = verificationFor(track, sources);
  return {
    id: track.id,
    title: track.title,
    url: track.url,
    status: track.status,
    milestones: track.milestones,
    sources,
    verificationSources: track.verificationSources || [],
    manualOnly: track.milestones.every(milestone => milestone.manual),
    verification,
    risk: riskFor(track, verification, content, {signups:store.list(owner,'signup').filter(item=>item.trackId===id), workspace:readApplication(store,owner,id)}),
    summaries: Object.values(content?.sources || {}).map(({ sourceUrl, at, facts }) => ({ sourceUrl, at, facts })),
    changes: store.list(owner, 'change').filter(change => change.trackId === id)
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50).map(change => ({
        version: 1,
        id: change.id,
        category: 'milestone_date',
        label: change.label || change.kind,
        detectedAt: change.at,
        before: change.before,
        after: change.after,
        sourceUrl: change.after?.sourceUrl || null
      }))
  };
}
