import { randomUUID } from 'node:crypto';
import { safeUrl } from './security.js';
import { validDate } from '../extension/shared/dates.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, limit) => {
  if (typeof value !== 'string' || value.length > limit) throw fail('Invalid or too long a text field.');
  return value.trim();
};
const required = (value, limit) => {
  const result = text(value, limit);
  if (!result) throw fail('Enter a name or value.');
  return result;
};
function pageUrl(value) {
  const url = safeUrl(required(value, 1200));
  if (url.search) throw fail('Save a public page URL without query parameters or access tokens.');
  return url.href;
}

export function readApplication(store, owner, trackId) {
  return store.get(owner, 'applicationWorkspace', trackId) ||
    { notes: '', priority: 'normal', pages: [], checklist: [], tasks: [] };
}

export function applicationOverview(store, owner, tracks) {
  const pendingTasks = [], requirements = [], progress = [];
  for (const track of tracks) {
    const workspace = store.get(owner, 'applicationWorkspace', track.id);
    if (!workspace) continue;
    const { checklist, tasks } = workspace;
    for (const task of tasks.filter(item => !item.done)) {
      pendingTasks.push({
        trackId: track.id, title: track.title, label: task.label, due: task.due,
        blocked: task.dependencies.some(id => !tasks.find(item => item.id === id)?.done)
      });
    }
    for (const item of checklist) {
      requirements.push({ trackId: track.id, title: track.title, label: item.label, required: item.required, done: item.done });
    }
    const entries = [...tasks, ...checklist];
    if (entries.length) progress.push({ trackId: track.id, title: track.title, total: entries.length, done: entries.filter(item => item.done).length });
  }
  pendingTasks.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || Number(b.blocked) - Number(a.blocked));
  requirements.sort((a, b) => Number(a.done) - Number(b.done) || Number(b.required) - Number(a.required));
  return { pendingTasks: pendingTasks.slice(0, 5), requirements: requirements.slice(0, 5),
    progress: progress.slice(0, 4), openTaskCount: pendingTasks.length,
    openRequirements: requirements.filter(item => item.required && !item.done).length };
}

export function updateApplication(store, owner, track, input) {
  if (!input || typeof input !== 'object') throw fail('Invalid application update.');
  const workspace = readApplication(store, owner, track.id);
  const { action, id } = input;
  if (action === 'notes') {
    workspace.notes = text(input.notes, 6000);
    if (!['normal', 'high'].includes(input.priority)) throw fail('Choose a priority.');
    workspace.priority = input.priority;
  } else if (action === 'addPage') {
    const url = pageUrl(input.url);
    if (workspace.pages.length >= 12) throw fail('Maximum 12 saved pages.');
    if (!workspace.pages.some(page => page.url === url)) workspace.pages.push({ id: randomUUID(), url });
  } else if (action === 'removePage') {
    workspace.pages = workspace.pages.filter(page => page.id !== id);
  } else if (action === 'addRequirement' || action === 'importRequirement') {
    if (workspace.checklist.length >= 50) throw fail('Maximum 50 checklist items.');
    let label, source;
    if (action === 'importRequirement') {
      const record = store.get(owner, 'intelligence', track.id);
      const entry = Object.values(record?.sources || {}).find(item => item.sourceUrl === input.sourceUrl);
      const fact = entry?.facts.find(item => item.category === 'documents' && item.evidence === input.evidence);
      if (!fact) throw fail('That source requirement is no longer available.', 404);
      label = fact.value.slice(0, 500);
      source = { url: entry.sourceUrl, evidence: fact.evidence };
    } else label = required(input.label, 500);
    if (!workspace.checklist.some(item => item.label.toLowerCase() === label.toLowerCase())) {
      workspace.checklist.push({ id: randomUUID(), label, required: action === 'importRequirement' || input.required === true, done: false, notes: '', reference: '', source });
    }
  } else if (action === 'updateRequirement' || action === 'removeRequirement') {
    const item = workspace.checklist.find(item => item.id === id);
    if (!item) throw fail('Checklist item not found.', 404);
    if (action === 'removeRequirement') workspace.checklist = workspace.checklist.filter(candidate => candidate.id !== id);
    else {
      if (typeof input.done !== 'boolean' || typeof input.required !== 'boolean') throw fail('Choose a checklist status.');
      Object.assign(item, { done: input.done, required: input.required, notes: text(input.notes, 1500), reference: text(input.reference, 200) });
    }
  } else if (action === 'addTask' || action === 'updateTask') {
    const task = action === 'addTask' ? { id: randomUUID(), done: false } : workspace.tasks.find(item => item.id === id);
    if (!task) throw fail('Task not found.', 404);
    if (action === 'addTask' && workspace.tasks.length >= 50) throw fail('Maximum 50 application tasks.');
    const label = required(input.label, 200);
    const due = input.due || null;
    if (due && (typeof due !== 'string' || !validDate(due))) throw fail('Enter a valid due date.');
    if (!Array.isArray(input.dependencies) || input.dependencies.some(dep => !workspace.tasks.some(item => item.id === dep))) {
      throw fail('Choose prerequisites from this application.');
    }
    const dependencies = [...new Set(input.dependencies)];
    const milestoneId = input.milestoneId || null;
    if (milestoneId && !track.milestones.some(item => item.id === milestoneId)) throw fail('Choose a milestone in this opportunity.');
    const seen = new Set();
    function reachesTask(dep) {
      if (dep === task.id) return true;
      if (seen.has(dep)) return false;
      seen.add(dep);
      return workspace.tasks.find(item => item.id === dep).dependencies.some(reachesTask);
    }
    if (dependencies.some(reachesTask)) throw fail('This dependency would create a cycle.');
    if (task.done && input.done !== true && workspace.tasks.some(item => item.done && item.dependencies.includes(task.id))) {
      throw fail('Reopen completed dependent tasks first.');
    }
    if (input.done === true && dependencies.some(dep => !workspace.tasks.find(item => item.id === dep).done)) {
      throw fail('Complete the prerequisites first.');
    }
    Object.assign(task, { label, due, dependencies, milestoneId, done: input.done === true });
    if (action === 'addTask') workspace.tasks.push(task);
  } else if (action === 'removeTask') {
    if (workspace.tasks.some(task => task.dependencies.includes(id))) throw fail('Remove this task from dependent tasks first.');
    workspace.tasks = workspace.tasks.filter(task => task.id !== id);
  } else throw fail('Unknown application action.');
  store.put(owner, 'applicationWorkspace', track.id, workspace);
  return workspace;
}

export function readPassport(store, secrets, owner) {
  const saved = store.get(owner, 'applicationPassport', 'me');
  return saved ? secrets.open(saved.sealed) : [];
}

export function updatePassport(store, secrets, owner, input) {
  const entries = readPassport(store, secrets, owner);
  if (input?.action === 'remove') {
    const index = entries.findIndex(entry => entry.id === input.id);
    if (index < 0) throw fail('Passport entry not found.', 404);
    entries.splice(index, 1);
  } else if (input?.action === 'save') {
    if (!['education', 'skills', 'achievement', 'answer', 'document'].includes(input.category)) throw fail('Choose a passport category.');
    const index = input.id ? entries.findIndex(entry => entry.id === input.id) : -1;
    if (input.id && index < 0) throw fail('Passport entry not found.', 404);
    if (index < 0 && entries.length >= 30) throw fail('Maximum 30 passport entries.');
    const entry = { id: input.id || randomUUID(), category: input.category, label: required(input.label, 100), value: required(input.value, 3000) };
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  } else throw fail('Unknown passport action.');
  if (entries.length) store.put(owner, 'applicationPassport', 'me', { sealed: secrets.seal(entries) });
  else store.remove(owner, 'applicationPassport', 'me');
  return entries;
}
