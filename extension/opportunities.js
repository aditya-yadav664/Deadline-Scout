export function renderOverview(target, tracks, priorities, today, { esc, formatDate, overview, timeline }) {
  const upcoming = tracks.flatMap(track => track.milestones
    .filter(milestone => milestone.date >= today)
    .map(milestone => ({ track, milestone })))
    .sort((a, b) => a.milestone.date.localeCompare(b.milestone.date)).slice(0, 4);
  const details = (id, title) =>
    `<a href="#opportunity=${encodeURIComponent(id)}" data-opportunity="${esc(id)}">${esc(title)}</a>`;
  const card = (title, items, empty) => `<article class="card workspace-card overview-card">
    <h3>${title}</h3>${items.length ? `<ul class="workspace-list">${items.join('')}</ul>` : `<p class="muted">${empty}</p>`}
  </article>`;
  const row = (name, label, value='') => `<li><div>${name}${label ? `<small>${esc(label)}</small>` : ''}</div>${value ? `<span>${esc(value)}</span>` : ''}</li>`;
  const deadlines = upcoming.map(({ track, milestone }) => row(details(track.id,track.title),milestone.label,formatDate(milestone.date)));
  const tracked = tracks.slice(0,4).map(track=>row(details(track.id,track.title),track.milestones.length+' milestone(s)'));
  const tasks = (overview.pendingTasks || []).map(task=>row(details(task.trackId,task.label),task.title + (task.blocked?' · Blocked':''),task.due?formatDate(task.due):''));
  const updates = (overview.websiteChanges || []).map(change=>row(details(change.trackId,change.title),changeLabels[change.category]||change.category,formatDate(change.at.slice(0,10))));
  const risk = priorities.map(item=>row(details(item.id,item.title),item.next,item.level));
  const changes = timeline.map(change=>row(details(change.trackId,change.title),change.label,formatDate(change.after.date)));
  const progress = (overview.progress || []).map(item=>row(details(item.trackId,item.title),'Checklist and tasks',item.done+' / '+item.total));
  target.innerHTML = `<div class="overview-row overview-row-three">
    ${card('Upcoming deadlines',deadlines,'No upcoming dates.')}
    ${card('Tracked opportunities',tracked,'Save an opportunity to start your watchlist.')}
    ${card('Important pending tasks',tasks,'No open application tasks.')}
  </div><div class="overview-row">
    ${card('Recent website changes',updates,'No website changes detected.')}
    ${card('Deadline risk overview',risk,'No high-risk opportunities.')}
  </div><div class="overview-row">
    ${card('Timeline preview',changes,'No date updates yet.')}
    ${card('Application progress',progress,'Add tasks or requirements to see your progress.')}
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
  const verification = (detail.verification || []).map(item => `<li><div>
    <strong>${esc(item.label)}</strong><small>${esc({
      corroborated: 'Cross-domain agreement', conflict: 'Conflicting dates',
      uncertain: 'Needs review', unverified: 'No independent corroboration'
    }[item.status])}</small>
    ${item.evidence.map(evidence => `<div class="source-observation">
      ${sourceLink(evidence.sourceUrl)}<p>${formatSchedule(evidence)}</p>
      <blockquote class="evidence">${esc(evidence.quote)}</blockquote>
    </div>`).join('')}
  </div></li>`);
  const summaries = (detail.summaries || []).filter(source => source.facts.length).map(source => `<details>
    <summary>${esc(new URL(source.sourceUrl).hostname)} · ${source.facts.length} facts</summary>
    <p>${sourceLink(source.sourceUrl)}</p>
    <dl class="summary-facts">${source.facts.map(fact => `<dt>${esc(fact.label)}</dt>
      <dd>${esc(fact.value)}<blockquote class="evidence">${esc(fact.evidence)}</blockquote></dd>`).join('')}</dl>
  </details>`);
  target.innerHTML = `
    <div class="opportunity-actions">${sourceLink(detail.url)}
      ${detail.local || detail.cached ? '' : `<div class="opportunity-buttons">
        <button type="button" class="button secondary" data-check-opportunity="${esc(detail.id)}">Check sources</button>
        <a class="button secondary" href="/backup.html#event=${encodeURIComponent(detail.id)}">Prepare a Signup</a>
      </div>`}
    </div>
    <div class="overview-grid">
      <article class="card workspace-card"><h3>Milestones</h3><ul class="workspace-list">${milestones.join('')}</ul></article>
      <article class="card workspace-card"><h3>Source verification</h3>
        ${verification.length ? `<ul class="workspace-list">${verification.join('')}</ul>` : '<p class="muted">No monitored milestones to verify.</p>'}
        ${detail.local || detail.cached || detail.manualOnly ? '' : `<form data-add-verification-source data-track-id="${esc(detail.id)}">
          <label>Public source URL<input name="url" type="url" maxlength="2048" required placeholder="https://…"></label>
          <button class="button secondary" type="submit">Add source and check</button>
        </form>`}
        ${detail.verificationSources?.length ? `<ul class="workspace-list">${detail.verificationSources.map(url => `<li>
          ${sourceLink(url)}<button class="text-button" type="button" aria-label="Remove verification source ${esc(url)}"
            data-remove-verification-source="${esc(url)}" data-track-id="${esc(detail.id)}">Remove</button></li>`).join('')}</ul>` : ''}
        <details class="source-history"><summary>Source check history</summary><ul class="workspace-list">${sources.join('')}</ul></details>
      </article>
      <article class="card workspace-card"><h3>Opportunity summary</h3>
        ${summaries.length ? `<p class="muted">Extracted from the latest readable sources</p>${summaries.join('')}` : '<p class="muted">Run a source check to look for eligibility, fees, documents, and instructions.</p>'}
      </article>
      <article class="card workspace-card"><h3>Risk assessment</h3>
        ${detail.risk ? riskDetails(detail.risk, esc) : '<p class="muted">Risk is available for monitored accounts.</p>'}
      </article>
      <article class="card workspace-card"><h3>Date change history</h3>${changes.length ?
        `<ul class="workspace-list">${changes.join('')}</ul>` : '<p class="muted">No date changes recorded.</p>'}</article>
    </div>`;
}

const changeLabels = {
  availability: 'Registration availability', eligibility: 'Eligibility', fee: 'Fees', documents: 'Required documents',
  interview: 'Interview', exam: 'Exam schedule', location: 'Location', instructions: 'Application instructions',
  submission: 'Submission requirements', announcement: 'Announcement', status: 'Application status',
  selection: 'Selection process', restrictions: 'Restrictions'
};

function riskDetails(risk, esc) {
  return `<span class="risk-badge" data-level="${esc(risk.level)}">${esc(risk.level)}</span>
    <ul>${risk.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>
    <p><strong>Next step</strong> · ${esc(risk.next)}</p>`;
}

export function renderRisk(target, items, { esc }) {
  const ranking = { Critical: 0, High: 1, Moderate: 2, Low: 3, Unknown: 4 };
  target.innerHTML = items.length ? `<div class="overview-grid">${[...items]
    .sort((a, b) => ranking[a.level] - ranking[b.level] || (a.remainingHours ?? Infinity) - (b.remainingHours ?? Infinity))
    .map(item => `<article class="card workspace-card">
      <h3><a class="opportunity-title-link" href="#opportunity=${encodeURIComponent(item.id)}" data-opportunity="${esc(item.id)}">${esc(item.title)}</a></h3>
      ${riskDetails(item, esc)}
    </article>`).join('')}</div>` : '<p class="muted">Save a tracked opportunity to see its risk assessment.</p>';
}

export function renderIntelligence(target, items, { esc, safeLink }) {
  if (!items.length) {
    target.innerHTML = '<p class="muted">No website changes detected. The first readable check establishes a baseline.</p>';
    return;
  }
  const categories = [...new Set(items.map(change => change.category))];
  const side = (fact, fallback) => fact
    ? `<p>${esc(fact.value)}</p><blockquote class="evidence">${esc(fact.evidence)}</blockquote>`
    : `<p class="muted">${fallback}</p>`;
  target.innerHTML = `<div class="intelligence-filter">
    <label>Category <select data-change-filter><option value="">All changes</option>
      ${categories.map(category => `<option value="${esc(category)}">${esc(changeLabels[category] || category)}</option>`).join('')}
    </select></label>
    <label>Detected since <input type="date" data-change-since></label>
    <label>Jump to change <select data-change-jump><option value="">Choose a change</option>
      ${items.map(change => `<option value="${esc(change.id)}">${esc(change.title)} · ${esc(changeLabels[change.category] || change.category)}</option>`).join('')}
    </select></label>
  </div><p data-change-empty class="muted" hidden>No changes match these filters.</p>
  ${items.map(change => `<article class="card workspace-card content-change" id="change-${esc(change.id)}" data-category="${esc(change.category)}" data-detected="${esc(change.at.slice(0, 10))}" tabindex="-1">
    <div class="content-change-heading"><div><h3>${esc(changeLabels[change.category] || change.category)}</h3>
      <a data-opportunity="${esc(change.trackId)}" href="#opportunity=${encodeURIComponent(change.trackId)}">${esc(change.title)}</a>
    </div><time datetime="${esc(change.at)}">${esc(new Date(change.at).toLocaleString())}</time></div>
    <p>${change.before && change.after ? 'Source text changed' : change.after ? 'New text detected' : 'Previously observed text is missing'} · ${change.confidence === 'high' ? 'Matched category' : 'Review recommended'}</p>
    <div class="content-comparison">
      <section class="previous-text"><h4>Previous</h4>${side(change.before, 'No earlier text in this category.')}</section>
      <section class="current-text"><h4>Current</h4>${side(change.after, 'The latest check did not find this text.')}</section>
    </div>
    <div class="opportunity-actions">
      <a href="${safeLink(change.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open original page</a>
      ${change.reviewedAt ? '<span class="badge">Reviewed</span>' : `<button type="button" class="button secondary" data-review-change="${esc(change.id)}" data-track-id="${esc(change.trackId)}">Mark as reviewed</button>`}
    </div>
  </article>`).join('')}`;
  const filter = target.querySelector('[data-change-filter]');
  const since = target.querySelector('[data-change-since]');
  const jump = target.querySelector('[data-change-jump]');
  function applyFilters() {
    let visible = 0;
    for (const card of target.querySelectorAll('[data-category]')) {
      card.hidden = !!(filter.value && filter.value !== card.dataset.category || since.value && since.value > card.dataset.detected);
      jump.querySelector(`option[value="${CSS.escape(card.id.slice(7))}"]`).hidden = card.hidden;
      if (!card.hidden) visible++;
    }
    target.querySelector('[data-change-empty]').hidden = visible > 0;
    jump.value = '';
  }
  filter.onchange = since.onchange = applyFilters;
  jump.onchange = () => {
    if (!jump.value) return;
    const card = document.getElementById('change-' + jump.value);
    card.focus();
    card.scrollIntoView({ block: 'start' });
  };
}
