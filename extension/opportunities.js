export function renderOverview(target, tracks, changes, today, { esc, formatDate }) {
  const upcoming = tracks.flatMap(track => track.milestones
    .filter(milestone => milestone.date >= today)
    .map(milestone => ({ track, milestone })))
    .sort((a, b) => a.milestone.date.localeCompare(b.milestone.date)).slice(0, 5);
  const recent = changes.slice(0, 4);
  const details = (id, title) =>
    `<a href="#opportunity=${encodeURIComponent(id)}" data-opportunity="${esc(id)}">${esc(title)}</a>`;
  const deadlines = upcoming.map(({ track, milestone }) => `<li>
    <div>${details(track.id, track.title)}<small>${esc(milestone.label)}</small></div>
    <time datetime="${esc(milestone.date)}">${esc(formatDate(milestone.date))}</time>
  </li>`);
  const updates = recent.map(change => `<li>
    <div>${details(change.trackId, change.title)}<small>${esc(change.label || change.kind)}</small></div>
    <span>${esc(formatDate(change.before.date))} → ${esc(formatDate(change.after.date))}</span>
  </li>`);
  target.innerHTML = `<div class="overview-grid">
    <article class="card workspace-card">
      <h3>Upcoming deadlines</h3>
      ${deadlines.length ? `<ul class="workspace-list">${deadlines.join('')}</ul>` : '<p class="muted">No upcoming dates. Scan a page or enter a date above.</p>'}
    </article>
    <article class="card workspace-card">
      <h3>Recent date changes</h3>
      ${updates.length ? `<ul class="workspace-list">${updates.join('')}</ul>` : '<p class="muted">Updates will appear here when a tracked date changes.</p>'}
    </article>
  </div>`;
  target.setAttribute('aria-busy', 'false');
}

export function renderOpportunity(target, detail, { esc, safeLink, formatDate }) {
  const formatSchedule = ({ date, time, zone }) =>
    esc([formatDate(date), time, zone].filter(Boolean).join(' · '));
  const sourceLink = url => `<a href="${safeLink(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
  const milestones = detail.milestones.map(milestone => `<li>
    <span>${esc(milestone.label)}${milestone.manual ? '<small>Manual reminder</small>' : ''}</span>
    <span>${formatSchedule(milestone)}</span>
  </li>`);
  const sources = detail.sources.map(source => `<li>
    <div>${sourceLink(source.url)}
      <small>${source.checkedAt ? 'Last checked ' + esc(new Date(source.checkedAt).toLocaleString()) : 'No checks recorded yet'}</small>
      ${source.history.length ? `<details><summary>Source evidence</summary>${source.history.map(entry =>
        `<div class="source-observation"><small>${esc(new Date(entry.at).toLocaleString())} · ${esc({
          observed: 'Milestones found', unavailable: 'Source unavailable', no_evidence: 'No milestone evidence found'
        }[entry.status] || entry.status)}</small>
        ${entry.evidence.map(evidence => `<p>${esc(evidence.label || evidence.kind)} · ${formatSchedule(evidence)}${evidence.uncertain ? ' · Needs review' : ''}</p>
          <blockquote class="evidence">${esc(evidence.quote)}</blockquote>
          ${evidence.sourceUrl !== source.url ? sourceLink(evidence.sourceUrl) : ''}`).join('')}</div>`).join('')}</details>` : ''}
    </div>
  </li>`);
  const changes = detail.changes.map(change => `<li><div>
    <strong>${esc(change.label)}</strong><small>${esc(new Date(change.detectedAt).toLocaleString())}</small>
    <p>${formatSchedule(change.before)} → ${formatSchedule(change.after)}</p>
    ${change.after.quote ? `<blockquote class="evidence">${esc(change.after.quote)}</blockquote>` : ''}
    ${change.sourceUrl ? sourceLink(change.sourceUrl) : ''}
  </div></li>`);
  target.innerHTML = `
    <div class="opportunity-actions">${sourceLink(detail.url)}
      ${detail.local || detail.cached ? '' : `<a class="button secondary" href="/backup.html#event=${encodeURIComponent(detail.id)}">Prepare a Signup</a>`}
    </div>
    <div class="overview-grid">
      <article class="card workspace-card"><h3>Milestones</h3><ul class="workspace-list">${milestones.join('')}</ul></article>
      <article class="card workspace-card"><h3>Sources</h3><ul class="workspace-list">${sources.join('')}</ul></article>
      <article class="card workspace-card"><h3>Date change history</h3>${changes.length ?
        `<ul class="workspace-list">${changes.join('')}</ul>` : '<p class="muted">No date changes recorded.</p>'}</article>
    </div>`;
}
