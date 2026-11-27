const passportCategories = ['education', 'skills', 'achievement', 'answer', 'document'];

export function renderPassport(target, entries, esc) {
  const form = (entry = {}) => `<form data-passport-form data-id="${esc(entry.id || '')}" class="application-form">
    <label>Category<select name="category">${passportCategories.map(category =>
      `<option value="${category}" ${entry.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label>
    <label>Label<input name="label" maxlength="100" required value="${esc(entry.label)}"></label>
    <label>Value<textarea name="value" maxlength="3000" required>${esc(entry.value)}</textarea></label>
    <button class="button secondary" type="submit">${entry.id ? 'Save entry' : 'Add entry'}</button>
    ${entry.id ? `<button class="text-button" type="button" data-passport-remove="${esc(entry.id)}">Delete entry</button>` : ''}
  </form>`;
  target.innerHTML = `<p class="muted">Save reusable information here. In Backup Signup, choose a passport entry for an individual field and review it before saving the draft. Document entries are references.</p>
    <div class="overview-grid"><article class="card workspace-card"><h3>New entry</h3>${form()}</article>
    <article class="card workspace-card"><h3>Saved entries</h3>${entries.length ? entries.map(entry =>
      `<details><summary>${esc(entry.label)}</summary>${form(entry)}</details>`).join('') : '<p class="muted">No entries saved.</p>'}</article></div>`;
}

export function renderApplication(target, detail, { esc, safeLink }) {
  const workspace = detail.application;
  if (!workspace) return;
  const { checklist, tasks, pages } = workspace;
  const checked = value => value ? ' checked' : '';
  const form = (action, fields, label, id = '') =>
    `<form class="application-form" data-application-action="${action}" data-item-id="${esc(id)}">${fields}
      <button type="submit" class="button secondary">${label}</button></form>`;
  const remove = (action, id) =>
    `<button type="button" class="text-button" data-application-remove="${action}" data-item-id="${esc(id)}">Remove</button>`;
  const taskTitles = new Map(tasks.map(task => [task.id, task]));
  const taskForm = (task = {}) => form(task.id ? 'updateTask' : 'addTask', `
    <label>Task name<input name="label" maxlength="200" required value="${esc(task.label)}"></label>
    <label>Due date<input name="due" type="date" value="${esc(task.due)}"></label>
    <label>Related milestone<select name="milestoneId"><option value="">None</option>${detail.milestones.map(milestone =>
      `<option value="${esc(milestone.id)}"${milestone.id === task.milestoneId ? ' selected' : ''}>${esc(milestone.label)}</option>`).join('')}</select></label>
    ${tasks.some(item => item.id !== task.id) ? `<fieldset><legend>Prerequisites</legend>${tasks.filter(item => item.id !== task.id).map(item =>
      `<label><input type="checkbox" name="dependencies" value="${esc(item.id)}"${checked(task.dependencies?.includes(item.id))}> ${esc(item.label)}</label>`).join('')}</fieldset>` : ''}
    ${task.id ? `<label><input name="done" type="checkbox"${checked(task.done)}> Completed</label>` : ''}
  `, task.id ? 'Save task' : 'Add task', task.id);
  const requirements = (detail.summaries || []).flatMap(source => source.facts
    .filter(fact => fact.category === 'documents' && !checklist.some(item => item.label.toLowerCase() === fact.value.toLowerCase()))
    .map(fact => `<li><div>${esc(fact.value)}<small><a href="${safeLink(source.sourceUrl)}" target="_blank" rel="noreferrer">Source</a></small></div>
      <button type="button" class="button secondary" data-import-evidence="${esc(fact.evidence)}" data-import-url="${esc(source.sourceUrl)}">Add to checklist</button></li>`));
  const impact = (detail.changes || []).flatMap(change => {
    const milestoneId = change.before?.id;
    const affected = tasks.filter(task => task.milestoneId === milestoneId);
    const affectedIds = new Set(affected.map(task => task.id));
    let expanded;
    do {
      expanded = false;
      for (const task of tasks) if (!affectedIds.has(task.id) && task.dependencies.some(id => affectedIds.has(id))) {
        affectedIds.add(task.id); expanded = true;
      }
    } while (expanded);
    const links = detail.linkedRecords?.filter(link => link.milestoneId === milestoneId) || [];
    if (!affectedIds.size && !links.length && !detail.drafts?.length) return [];
    return [`<li><div><strong>${esc(change.label)}</strong><small>${esc(change.before.date)} → ${esc(change.after.date)}</small>
      ${affectedIds.size ? `<p>Review task dates for ${[...affectedIds].map(id => esc(taskTitles.get(id).label)).join(', ')}.</p>` : ''}
      ${links.length ? '<p>Check the linked Google Calendar or Tasks entry and any reminders.</p>' : ''}
      ${detail.drafts?.length ? '<p>Review your Backup Signup plan against the new date.</p>' : ''}</div></li>`];
  }).slice(0, 5);
  target.innerHTML = `
    <div class="section-heading"><h3>Application workspace</h3><div class="opportunity-buttons"><button class="button secondary" type="button" data-workspace-jump="readiness" data-readiness-track="${esc(detail.id)}">Simulate readiness</button><a class="button secondary" href="${safeLink(detail.url)}" target="_blank" rel="noreferrer">Resume application</a></div></div>
    <div class="overview-grid">
      <article class="card workspace-card"><h3>Notes and saved pages</h3>
        ${form('notes', `<label>Notes<textarea name="notes" maxlength="6000">${esc(workspace.notes)}</textarea></label>
        <label>Priority<select name="priority"><option value="normal">Normal</option><option value="high"${workspace.priority === 'high' ? ' selected' : ''}>High</option></select></label>`, 'Save notes')}
        <ul class="workspace-list">${pages.map(page => `<li><a href="${safeLink(page.url)}" target="_blank" rel="noreferrer">${esc(page.url)}</a>${remove('removePage', page.id)}</li>`).join('')}</ul>
        ${form('addPage', '<label>Public page URL<input name="url" type="url" required maxlength="1200"></label>', 'Save page')}
        ${(detail.drafts || []).map(draft => `<p><a href="/backup.html#draft=${encodeURIComponent(draft.id)}">Open signup draft</a> · ${esc(draft.status)}</p>`).join('')}
      </article>
      <article class="card workspace-card"><h3>Document checklist</h3>
        <p>${checklist.filter(item => item.done).length} of ${checklist.length} complete</p>
        ${checklist.map(item => `<details><summary>${item.done ? 'Complete' : item.required ? 'Required' : 'Optional'} · ${esc(item.label)}</summary>
          ${item.source ? `<p><a href="${safeLink(item.source.url)}" target="_blank" rel="noreferrer">Source evidence</a> · ${esc(item.source.evidence)}</p>` : ''}
          ${form('updateRequirement', `<label><input type="checkbox" name="done"${checked(item.done)}> Complete</label>
            <label><input type="checkbox" name="required"${checked(item.required)}> Required</label>
            <label>Notes<textarea name="notes" maxlength="1500">${esc(item.notes)}</textarea></label>
            <label>Document reference<input name="reference" maxlength="200" value="${esc(item.reference)}"></label>`, 'Save checklist item', item.id)}
          ${remove('removeRequirement', item.id)}</details>`).join('')}
        ${requirements.length ? `<h4>Suggested requirements</h4><ul class="workspace-list">${requirements.join('')}</ul>` : ''}
        ${form('addRequirement', '<label>Requirement<input name="label" required maxlength="500"></label><label><input type="checkbox" name="required" checked> Required</label>', 'Add requirement')}
      </article>
      <article class="card workspace-card"><h3>Dependency planner</h3>
        ${tasks.some(task => task.dependencies.length) ? `<div class="dependency-flow" aria-hidden="true">${tasks.filter(task => task.dependencies.length)
          .map(task => `<p><span>${task.dependencies.map(id => esc(taskTitles.get(id).label)).join(' + ')}</span> → <span>${esc(task.label)}</span></p>`).join('')}</div>` : ''}
        ${tasks.map(task => {
          const pending = task.dependencies.filter(id => !taskTitles.get(id).done);
          return `<details><summary>${esc(task.label)} · ${pending.length ? 'Blocked' : task.done ? 'Done' : 'Open'}${task.due ? ' · ' + esc(task.due) : ''}</summary>
            ${pending.length ? `<p>Waiting on ${pending.map(id => esc(taskTitles.get(id).label)).join(', ')}</p>` : ''}
            ${taskForm(task)}${remove('removeTask',task.id)}</details>`;
        }).join('')}
        ${taskForm()}
      </article>
      <article class="card workspace-card"><h3>Deadline change impact</h3>
        ${impact.length ? `<ul class="workspace-list">${impact.join('')}</ul>` : '<p class="muted">Link a task to a milestone to see what may need attention when the date changes.</p>'}
      </article>
    </div>`;
}
