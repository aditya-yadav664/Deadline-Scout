import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { hash } from '../server/security.js';
import { extractFacts, riskFor } from '../server/intelligence.js';
import { extract } from '../extension/shared/extract.js';
import { readPublicPdf } from '../server/public-pdf.js';

const executablePath = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium'
].find(path => path && existsSync(path));

async function fixture(t, options = {}) {
  const store = new Store(':memory:');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const url = 'http://127.0.0.1:' + port;
  const app = createApp({
    store,
    env: { HOST: '127.0.0.1', APP_URL: url },
    vault: { seal: JSON.stringify, open: JSON.parse },
    ...options
  });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  t.after(() => app.close());
  const source = url + '/demo/registration';
  const faq = url + '/demo/faq';
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  }
  const { data: { token } } = await request('/api/local-session', 'POST', {});
  const { data: page } = await request('/api/inspect', 'POST', { url: source }, token);
  const { status, data: track } = await request('/api/tracks', 'POST', {
    title: 'Orbit Hack',
    url: source,
    sources: [source, faq],
    milestones: page.milestones.filter(milestone => milestone.kind === 'registration_closes')
  }, token);
  assert.equal(status, 201);
  return { store, url, source, faq, track, token, request };
}

test('intelligence stores sourced changes, suppresses noise, and reviews and verifies without changing a conflicted date', async t => {
  let changed = false;
  let extraDate = '28 November 2026';
  let failed = false;
  const extra = 'https://notices.example/official';
  const f = await fixture(t, { readPage: async url => {
    if (failed && url === extra) throw Error('Unavailable');
    const text = url === extra || url.endsWith('/faq') ? 'Registration deadline: ' + (url === extra ? extraDate : '28 November 2026') : [
      'Registration deadline: 28 November 2026',
      'Eligibility: ' + (changed ? 'All students' : 'Final-year students'),
      'Application fee: ' + (changed ? '₹700' : '₹500'),
      ...(changed ? [] : ['Required documents: Latest marksheet']),
      changed ? 'Advertisement: new banner' : 'Advertisement: old banner'
    ].join('\n');
    return {url,title:'Orbit Hack',text,milestones:extract(text,url)};
  } });
  const call = (path,method,body) => f.request(path,method,body,f.token);
  const check = () => call('/api/tracks/' + f.track.id + '/check','POST',{});
  const detail = async () => (await call('/api/opportunities/' + f.track.id)).data;
  await check();
  assert.equal((await call('/api/intelligence')).data.changes.length,0);
  assert.equal((await call('/api/tracks/' + f.track.id,'PATCH',{verificationSource:extra})).status,200);
  await check();
  assert.equal((await detail()).verification[0].status,'corroborated');
  changed = true;
  extraDate = '25 November 2026';
  await check();
  const conflicted = await detail();
  assert.equal(conflicted.verification[0].status,'conflict');
  assert.equal(conflicted.milestones[0].date,'2026-11-28');
  assert.ok(conflicted.summaries.some(source=>source.facts.some(fact=>fact.evidence==='Application fee: ₹700')));
  const {changes} = (await call('/api/intelligence')).data;
  assert.deepEqual(changes.map(change=>change.category).sort(),['documents','eligibility','fee']);
  const fee = changes.find(change=>change.category==='fee');
  assert.equal(fee.before.value,'₹500');
  assert.equal(fee.after.evidence,'Application fee: ₹700');
  assert.equal(changes.find(change=>change.category==='documents').after,null);
  const review = '/api/opportunities/' + f.track.id + '/changes/' + fee.id;
  assert.equal((await call(review,'PATCH',{reviewed:false})).status,400);
  assert.ok((await call(review,'PATCH',{reviewed:true})).data.reviewedAt);
  await check();
  failed = true;
  await check();
  assert.equal((await call('/api/intelligence')).data.changes.length,3);
  assert.equal((await call('/api/tracks/' + f.track.id,'PATCH',{removeVerificationSource:extra})).status,200);
  const removed = await detail();
  assert.ok(!removed.sources.some(source=>source.url===extra));
  assert.ok(!removed.summaries.some(source=>source.sourceUrl===extra));
  await call('/api/tracks/' + f.track.id,'DELETE');
  assert.equal(f.store.get('local-demo','intelligence',f.track.id),null);
});

test('deterministic facts ignore unrelated text and timed risk uses the source timezone', () => {
  assert.deepEqual(extractFacts('Advertisement: rolling offer\nEligibility\nFinal-year students')
    .map(({ category, evidence }) => [category, evidence]), [['eligibility','Final-year students']]);
  const result = riskFor({milestones:[{ label:'Deadline', date:'2026-12-01', time:'18:00', zone:'Asia/Kolkata' }]},
    [], null, {now:Date.parse('2026-12-01T11:30:00Z')});
  assert.equal(result.remainingHours,1);
  assert.equal(result.level,'Critical');
});

test('public PDF sources are parsed from bytes and retain a source quotation',
  {skip:!!spawnSync('pdftotext',['-v'],{windowsHide:true}).error}, async () => {
    const text = 'BT /F1 12 Tf 30 200 Td (Registration deadline: 28 November 2026) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    for(const [index,object] of objects.entries()){
      offsets.push(pdf.length);
      pdf += (index+1)+' 0 obj\n'+object+'\nendobj\n';
    }
    const xref = pdf.length;
    pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')
      + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
    const url = 'https://notices.example/official.pdf';
    const source = await readPublicPdf(Buffer.from(pdf),url);
    assert.equal(source.sourceType,'pdf');
    assert.equal(source.milestones[0].date,'2026-11-28');
    assert.equal(source.milestones[0].sourceUrl,url);
    assert.match(source.milestones[0].quote,/28 November/);
    await assert.rejects(readPublicPdf(Buffer.from('invalid'),url),/readable PDF/);
  });

test('opportunity details project legacy tracks, isolate owners and retain bounded source evidence', async t => {
  const f = await fixture(t);
  const path = '/api/opportunities/' + f.track.id;
  assert.equal((await f.request(path)).status, 401);
  f.store.put('_system', 'session', hash('other-account'), { owner: 'another', expires: Date.now() + 10000 });
  assert.equal((await f.request(path, 'GET', undefined, 'other-account')).status, 404);
  const get = async () => (await f.request(path, 'GET', undefined, f.token)).data;
  const send = (path, method, body) => f.request(path, method, body, f.token);
  const check = () => send('/api/tracks/' + f.track.id + '/check', 'POST', {});
  const legacy = await get();
  assert.equal(legacy.milestones[0].id, f.track.milestones[0].id);
  assert.deepEqual(legacy.sources.map(source => source.history), [[], []]);
  await check();
  await check();
  assert.equal((await get()).sources[0].history.length, 1);
  await send('/api/demo', 'POST', { mode: 'changed' });
  await check();
  const changed = await get();
  assert.equal(changed.changes[0].category, 'milestone_date');
  assert.equal(changed.changes[0].before.date, '2026-11-28');
  assert.equal(changed.changes[0].after.date, '2026-11-26');
  assert.match(changed.sources.find(source => source.url === f.faq).history[0].evidence[0].quote, /moved/);
  await send('/api/demo', 'POST', { mode: 'failed' });
  await check();
  const failed = await get();
  assert.equal(failed.milestones[0].date, '2026-11-26');
  assert.equal(failed.sources.find(source => source.url === f.faq).history[0].status, 'unavailable');
  await send('/api/tracks/' + f.track.id, 'DELETE');
  assert.equal((await f.request(path, 'GET', undefined, f.token)).status, 404);
  assert.equal(f.store.get('local-demo', 'sourceHistory', f.track.id), null);
});

test('dashboard shell keeps watchlist actions and opportunity links accessible on mobile', { skip: !executablePath }, async t => {
  const f = await fixture(t);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url);
  await page.getByRole('button', { name: /^My Watchlist/ }).click();
  await page.locator('#tracks').getByRole('button', { name: 'Check now' }).click();
  await page.locator('#tracks').getByRole('link', { name: 'Orbit Hack' }).click();
  await page.getByRole('heading', { name: 'Orbit Hack' }).waitFor();
  await page.getByText('Source check history', { exact: true }).click();
  await page.getByText('Source evidence', { exact: true }).first().click();
  await page.getByText('Milestones found', { exact: false }).first().waitFor();
  assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), true);
  await page.reload();
  await page.getByRole('heading', { name: 'Orbit Hack' }).waitFor();
  await page.getByRole('button', { name: 'Back to watchlist' }).click();
  await page.getByRole('link', { name: 'Backup Signup', exact: true }).click();
  await page.waitForURL('**/backup.html');
  assert.deepEqual(errors, []);
});

test('desktop sidebar keeps labels visible and comparison review persists', { skip: !executablePath }, async t => {
  let fee = '₹500';
  const f = await fixture(t,{readPage:async url=>{
    const text = 'Registration deadline: 28 November 2026\n' + (url.endsWith('/faq')?'':'Application fee: '+fee);
    return {url,title:'Orbit Hack',text,milestones:extract(text,url)};
  }});
  const check = () => f.request('/api/tracks/'+f.track.id+'/check','POST',{},f.token);
  await check();
  fee = '₹700';
  await check();
  const browser = await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.url);
  await page.getByRole('heading',{name:'Upcoming deadlines'}).waitFor();
  assert.equal(await page.getByText('Recent date changes',{exact:true}).count(),0);
  const navigation=page.locator('#workspace-menu');
  const content=page.locator('.workspace-content');
  const origin=(await content.boundingBox()).x;
  assert.ok((await navigation.boundingBox()).width>200);
  const item=page.getByRole('button',{name:'Change Intelligence'});
  const idleColor=await item.evaluate(node=>getComputedStyle(node).backgroundColor);
  await item.hover();
  assert.notEqual(await item.evaluate(node=>getComputedStyle(node).backgroundColor),idleColor);
  assert.equal((await content.boundingBox()).x,origin);
  await page.getByRole('button',{name:'Change Intelligence'}).click();
  await page.getByRole('heading',{name:'Fees',exact:true}).waitFor();
  await page.getByLabel('Category').selectOption('fee');
  await page.getByText('₹500',{exact:true}).waitFor();
  await page.getByText('₹700',{exact:true}).waitFor();
  await page.getByLabel('Jump to change').selectOption({label:'Orbit Hack · Fees'});
  await page.getByRole('button',{name:'Mark as reviewed'}).click();
  await page.getByText('Reviewed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Reviewed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Risk Overview'}).click();
  await page.locator('#risk-content .risk-badge').waitFor();
  assert.deepEqual(errors,[]);
});

test('application workspace validates task dependencies and isolates passport entries', async t => {
  const f = await fixture(t, { readPage: async url => ({
    url, title:'Orbit Hack', text:'Required documents: Latest marksheet',
    milestones:extract('Registration deadline: 28 November 2026',url)
  }) });
  const path = '/api/opportunities/' + f.track.id;
  const patch = input => f.request(path+'/application','PATCH',input,f.token);
  const detail = async () => (await f.request(path,'GET',undefined,f.token)).data;
  f.store.put('_system','session',hash('other'),{owner:'other',expires:Date.now()+10000});
  assert.equal((await f.request(path+'/application','PATCH',{ action:'notes', notes:'private',priority:'high' },'other')).status,404);
  assert.equal((await patch({action:'addPage',url:'https://example.com/?token=private'})).status,400);
  assert.equal((await patch({action:'addPage',url:'https://example.com/application'})).status,200);
  await f.request('/api/tracks/'+f.track.id+'/check','POST',{},f.token);
  await patch({action:'importRequirement',sourceUrl:f.source,evidence:'Required documents: Latest marksheet'});
  let application = (await detail()).application;
  assert.equal(application.checklist[0].label,'Latest marksheet');
  assert.equal(application.checklist[0].done,false);
  const task = (label, fields = {}) => ({ action:'addTask',label,dependencies:[],...fields });
  const a = (await patch(task('Prepare ID'))).data.tasks[0];
  const b = (await patch(task('Submit',{dependencies:[a.id]}))).data.tasks[1];
  assert.equal((await patch(task('Prepare ID',{action:'updateTask',id:a.id,dependencies:[b.id]}))).status,400);
  assert.equal((await patch(task('Submit',{action:'updateTask',id:b.id,dependencies:[a.id],done:true}))).status,400);
  await patch(task('Prepare ID',{action:'updateTask',id:a.id,done:true}));
  assert.equal((await patch(task('Submit',{action:'updateTask',id:b.id,dependencies:[a.id],done:true}))).status,200);
  const passport='/api/application-passport';
  const saved=await f.request(passport,'PATCH',{action:'save',category:'skills',label:'Tools',value:'JavaScript'},f.token);
  assert.equal(saved.data[0].value,'JavaScript');
  assert.deepEqual((await f.request(passport,'GET',undefined,'other')).data,[]);
  assert.ok(f.store.get('local-demo','applicationPassport','me').sealed);
  await f.request('/api/tracks/'+f.track.id,'DELETE',undefined,f.token);
  assert.equal(f.store.get('local-demo','applicationWorkspace',f.track.id),null);
});

test('application notes, checklist and passport can be saved through the dashboard', {skip:!executablePath}, async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  await page.goto(f.url);
  await page.getByRole('button',{name:'Application Workspaces'}).click();
  await page.locator('#application-list').getByRole('link',{name:'Orbit Hack'}).click();
  await page.getByLabel('Notes',{exact:true}).fill('Check the organizer instructions.');
  await page.getByRole('button',{name:'Save notes'}).click();
  await page.getByText('Application workspace saved.',{exact:true}).waitFor();
  assert.equal(f.store.get('local-demo','applicationWorkspace',f.track.id).notes,'Check the organizer instructions.');
  await page.getByLabel('Requirement',{exact:true}).fill('ID photo');
  await page.getByRole('button',{name:'Add requirement'}).click();
  await page.getByText('Required · ID photo',{exact:true}).waitFor();
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('[data-application-action=notes] textarea')?.value==='Check the organizer instructions.',null,{timeout:5000});
  await page.getByRole('button',{name:'Application Passport'}).click();
  const passport=page.locator('#passport-content');
  await passport.getByLabel('Label').fill('Skill');
  await passport.getByLabel('Value').fill('JavaScript');
  await passport.getByRole('button',{name:'Add entry'}).click();
  await passport.getByText('Skill',{exact:true}).waitFor();
});
