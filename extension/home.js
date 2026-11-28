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

const stageDescriptions = [
  'Open an opportunity in your browser or paste its public link.',
  'Review extracted milestones alongside the text that supports each date.',
  'Scout compares the next source check with your saved milestone.',
  'Review your saved answers and choose when to run a backup signup.'
];
const scenes = [
  '<small>Next milestone</small><b><span data-count>12</span> days left</b><meter min="0" max="30" value="18">18 of 30 days</meter>',
  '<small>Source comparison</small><b><del>12 Dec</del> → <ins>09 Dec</ins></b><span>Applications close three days earlier.</span>',
  '<small>Draft preview</small><label>Applicant <input value="Alex Morgan"></label><label>Project <input value="Coastal mapping"></label><strong>Ready for review</strong>',
  '<small>Extension panel</small><b>Page scanned</b><span>Application deadline found · 12 December</span><strong>Saved to example watchlist ✓</strong>',
  '<small>Deadline alert</small><b>Deadline moved up</b><span>Northstar Fellowship · 12 Dec → 09 Dec</span>',
  '<small>December · Calendar preview</small><div class="calendar-grid"><span>07</span><span>08</span><strong>09</strong><span>10</span><span>11</span></div><b>Fellowship closes</b>'
];
function selectButton(buttons, current) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === current));
}
const features = [...document.querySelectorAll('[data-feature]')];
const stages = [...document.querySelectorAll('[data-stage]')];
const scene = document.querySelector('#feature-scene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
function showFeature(index) {
  selectButton(features, features[index]);
  scene.innerHTML = '<div class="scene scene-' + index + '">' + scenes[index] + '</div>';
  if (!reduced.matches && index === 0 && scene.getBoundingClientRect().top < innerHeight) {
    const counter = scene.querySelector('[data-count]');
    let value = 16;
    function tick() {
      if (!counter.isConnected || reduced.matches || document.hidden) {counter.textContent = '12'; return;}
      counter.textContent = String(value--);
      if (value >= 12) setTimeout(tick, 75);
    }
    tick();
  }
}
features.forEach((button, index) => button.onclick = () => showFeature(index));
showFeature(0);
stages.forEach((button, index) => button.onclick = () => {
  selectButton(stages, button);
  document.querySelector('#stage-symbol').textContent = ['↗','⌖','↻','✓'][index];
  document.querySelector('#stage-preview-title').textContent = ['northstar.example / apply','Application closes · 12 December','Source updated · 12 Dec → 09 Dec','Application draft · Ready for review'][index];
  document.querySelector('#stage-copy').textContent = stageDescriptions[index];
  document.querySelector('#waypoint').style.transform = 'translateX(' + (index * 94) + 'px)';
});
next.addEventListener('click', () => {
  document.querySelector('#source-date').textContent = step === 4 || step === 0 ? '09 December' : '12 December';
});
const menu = document.querySelector('.mobile-menu');
menu.addEventListener('click', event => {if (event.target.closest('a')) menu.open = false;});
function mountMotion() {
  const controller = new AbortController();
  const options = {signal:controller.signal, passive:true};
  const stack = document.querySelector('.stack');
  const hero = document.querySelector('.instrument');
  const closing = document.querySelector('.closing');
  let frame = 0;
  function scroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!reduced.matches) stack.style.setProperty('--align', Math.max(0,Math.min(1,(innerHeight-stack.getBoundingClientRect().top)/(innerHeight*.52))));
    });
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.classList.toggle('paused', !entry.isIntersecting);
      entry.target.classList.toggle('in-view', entry.isIntersecting);
    }
  });
  for (const section of [hero,closing]) observer.observe(section);
  window.addEventListener('scroll',scroll,options);
  window.addEventListener('resize',scroll,options);
  scroll();
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    for (const target of [hero,...document.querySelectorAll('.primary')]) {
      const move = (x,y) => {
        const isHero = target === hero;
        target.style.setProperty(isHero?'--px':'--mx',x+'px');
        target.style.setProperty(isHero?'--py':'--my',y+'px');
      };
      target.addEventListener('pointermove', event => {
        if (reduced.matches) return;
        const box = target.getBoundingClientRect();
        const scale = target === hero ? 12 : 5;
        move(((event.clientX-box.left)/box.width-.5)*scale,((event.clientY-box.top)/box.height-.5)*scale);
      },options);
      target.addEventListener('pointerleave',()=>move(0,0),options);
    }
  }
  window.addEventListener('pagehide',()=>{controller.abort();observer.disconnect();cancelAnimationFrame(frame);},{once:true});
}
mountMotion();
window.addEventListener('pageshow',event=>{if(event.persisted) mountMotion();});
