import { api, storage, connectGoogle } from './api.js';

const fragment = new URLSearchParams(location.hash.slice(1));
if (['capture','inspect','alerts-setup','opportunity'].some(key => fragment.has(key)) ||
    ['#settings','#timeline','#watchlist'].includes(location.hash)) location.replace('/dashboard' + location.hash);

const buttons = [...document.querySelectorAll('[data-auth]')];
const status = document.querySelector('#auth-status');
const config = api('/api/config').catch(() => null);
let signedIn = false;
if (await storage.get('token')) {
  try {
    await api('/api/me');
    signedIn = true;
    for (const button of buttons) button.textContent = 'Go to Dashboard';
    document.querySelector('.site-header .quiet').hidden = true;
  } catch (error) {
    if (error.status === 401) await storage.set('token', null);
  }
}
for (const button of buttons) button.onclick = async () => {
  if (signedIn || (await config)?.auth === 'local') {
    location.assign('/dashboard');
    return;
  }
  buttons.forEach(item => { item.disabled = true; });
  try { await connectGoogle(); }
  catch (error) {
    status.textContent = error.message;
    status.hidden = false;
    buttons.forEach(item => { item.disabled = false; });
    status.scrollIntoView({ block: 'nearest' });
  }
};

const steps = [
  ['Scanning the source', 'Deadline Scout reads the sample announcement.', 'Find the deadline'],
  ['Application closes December 12', 'Evidence · “Applications close on 12 December.”', 'Start tracking'],
  ['Added to the sample watchlist', 'The next source check will compare against December 12.', 'Run another check'],
  ['The deadline moved to December 9', 'The announcement now says “Applications close on 9 December.”', 'Show the alert'],
  ['Deadline moved 3 days earlier', 'Sample notification · Northstar Fellowship now closes December 9.', 'Replay demo']
];
let step = 0;
const next = document.querySelector('#demo-next');
next.onclick = () => {
  const [title, copy, label] = steps[step];
  for (const item of document.querySelectorAll('[data-demo-step]')) {
    item.classList.toggle('complete', +item.dataset.demoStep < step);
    if (+item.dataset.demoStep === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  document.querySelector('#demo-title').textContent = title;
  document.querySelector('#demo-copy').textContent = copy;
  next.textContent = label;
  step = (step + 1) % steps.length;
};
