import { validDate } from './shared/dates.js';

const day = 86400000;
const applicationKinds = new Set(['registration_closes', 'submissions']);
export const applicationCutoff = (milestones, today) => milestones
  .filter(item => applicationKinds.has(item.kind) && item.date >= today)
  .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '23:59').localeCompare(b.time || '23:59'))[0];

export function simulateReadiness({ tasks, checklist }, { today, deadline, delay, estimates }) {
  const required = checklist.filter(item => item.required);
  const completed = required.filter(item => item.done).length;
  const remaining = [...tasks.filter(item => !item.done).map(item => ({ ...item, type: 'task' })),
    ...required.filter(item => !item.done).map(item => ({ ...item, type: 'requirement' }))];
  const next = remaining.filter(item => !item.dependencies?.some(id => tasks.some(task => task.id === id && !task.done)))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))[0];
  const result = { completed, total: required.length, remaining, next };
  if (!validDate(today) || !validDate(deadline) || !Number.isInteger(delay) || delay < 0 || delay > 365 ||
      remaining.some(item => !Number.isInteger(estimates.get(item.type + ':' + item.id)) ||
        estimates.get(item.type + ':' + item.id) < 0 || estimates.get(item.type + ':' + item.id) > 365)) return result;

  const taskById = new Map(tasks.map(task => [task.id, task]));
  const offsets = new Map();
  const visiting = new Set();
  function finish(item) {
    if (item.done) return 0;
    if (offsets.has(item.id)) return offsets.get(item.id);
    if (visiting.has(item.id)) throw new Error('Task prerequisites form a cycle.');
    visiting.add(item.id);
    const dependencies = item.dependencies.map(id => taskById.get(id)).filter(Boolean);
    const offset = Math.max(0, ...dependencies.map(finish)) + estimates.get('task:' + item.id);
    visiting.delete(item.id);
    offsets.set(item.id, offset);
    return offset;
  }

  const start = Date.parse(today) + delay * day;
  const duration = Math.max(0, ...remaining.map(item => item.type === 'task'
    ? finish(item) : estimates.get('requirement:' + item.id)));
  const end = start + duration * day;
  return { ...result, finish: new Date(end).toISOString().slice(0, 10), slack: (Date.parse(deadline) - end) / day };
}

export function renderReadiness(target, detail, today, { esc, formatDate }) {
  const workspace = detail.application;
  const baseline = simulateReadiness(workspace, { today, estimates: new Map() });
  const { completed, total, remaining, next } = baseline;
  const state = remaining.length ? 'Needs attention' : total || workspace.tasks.length ? 'Saved plan complete' : 'No plan yet';
  const suggested = applicationCutoff(detail.milestones, today);
  const dates = detail.milestones.filter(item => validDate(item.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const defaultDate = suggested || dates.find(item=>item.date>=today);
  target.innerHTML = `<div class="readiness-grid">
    <article class="card workspace-card plan-card"><div class="plan-card-heading"><h3>Checklist progress</h3><span class="plan-tag" data-tone="${remaining.length ? 'attention' : 'neutral'}">${state}</span></div>
      <p class="readiness-number">${total ? completed + ' of ' + total : '—'}</p>
      ${total ? `<progress aria-label="Required checklist items complete" value="${completed}" max="${total}"></progress><p class="muted">Required checklist items complete</p>` : '<p class="muted">Add required items to measure checklist progress.</p>'}
      ${workspace.checklist.length ? `<ul class="plan-list">${workspace.checklist.map(item => `<li><span>${esc(item.label)}</span><span class="plan-tag" data-tone="${item.done ? 'done' : item.required ? 'attention' : 'neutral'}">${item.done ? 'Complete' : item.required ? 'Required' : 'Optional'}</span></li>`).join('')}</ul>` : ''}
      <p>${workspace.tasks.filter(task => !task.done).length} open tasks</p>
      <h4>Suggested next move</h4><p>${next ? 'Work on ' + esc(next.label) + '.' : remaining.length ? 'Review blocked prerequisites in the application workspace.' : total || workspace.tasks.length ? 'Review your application and the official requirements.' : 'Add tasks or checklist items to your application workspace.'}</p>
      <a href="#opportunity=${encodeURIComponent(detail.id)}" data-opportunity="${esc(detail.id)}">Open application workspace</a>
    </article>
    <article class="card workspace-card plan-card"><h3>Estimate your finish date</h3>
      ${remaining.length && dates.length ? `<form class="application-form" data-readiness-form>
        <label>Deadline to compare<select name="deadline" required aria-label="Deadline to compare"><option value="">Choose a milestone</option>${dates.map((item, index) => `<option value="${index}"${item === defaultDate ? ' selected' : ''}>${esc(item.label)} · ${esc(formatDate(item.date))}${item.time ? ' · ' + esc(item.time + ' ' + (item.zone || '')) : ''}</option>`).join('')}</select></label>
        <label>Start in (days)<input name="delay" type="number" value="0" min="0" max="365" required></label>
        <div class="opportunity-buttons"><button type="button" class="button secondary" data-start-days="0">Start today</button><button type="button" class="button secondary" data-start-days="3">Start in 3 days</button></div>
        <fieldset class="readiness-estimates"><legend>Estimated calendar days</legend>${remaining.map((item, index) => `<label><span>${esc(item.label)}<small>${item.type === 'task' ? 'Task' : 'Required item'}</small></span><input name="estimate-${index}" type="number" min="0" max="365" value="1" required></label>`).join('')}</fieldset>
        <p class="muted">Adjust the days for each item. The estimate assumes independent work can happen at the same time.</p>
        <button class="button primary" type="submit">Run scenario</button><output data-readiness-result aria-live="polite"></output>
      </form>` : `<p class="muted">${dates.length ? 'Add an open task or required item to run a scenario.' : 'Save a milestone to compare a scenario against it.'}</p>`}
    </article></div>`;
  const form = target.querySelector('[data-readiness-form]');
  if (!form) return;
  const output = form.querySelector('[data-readiness-result]');
  function calculate() {
    const fields = new FormData(form);
    const deadline = dates[Number(fields.get('deadline'))];
    const estimates = new Map(remaining.map((item, index) => [item.type + ':' + item.id, Number(fields.get('estimate-' + index))]));
    const scenario = simulateReadiness(workspace, { today, deadline: deadline.date, delay: Number(fields.get('delay')), estimates });
    const days = Math.abs(scenario.slack);
    const dayLabel = days === 1 ? ' day' : ' days';
    const result = scenario.slack > 0 ? days + dayLabel + ' before the deadline' : scenario.slack < 0
      ? days + dayLabel + ' past the deadline' : 'On the deadline day. Check the closing time';
    output.textContent = 'Estimated finish: ' + formatDate(scenario.finish) + '. ' + result + '.';
    output.dataset.tone = scenario.slack <= 0 ? 'attention' : 'done';
  }
  function refreshEstimate(){
    if(form.checkValidity())calculate();
    else output.textContent='';
  }
  form.addEventListener('input',refreshEstimate);
  form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
  form.querySelectorAll('[data-start-days]').forEach(button => button.addEventListener('click', () => {
    form.elements.delay.value = button.dataset.startDays;
    refreshEstimate();
  }));
  refreshEstimate();
}
