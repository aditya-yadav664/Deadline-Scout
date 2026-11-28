import test from 'node:test';
import { simulateReadiness } from '../extension/readiness.js';
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
import { recordSourceCheck } from '../server/opportunities.js';
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
    env: { HOST: '127.0.0.1', APP_URL: url, ...options.env },
    vault: { seal: JSON.stringify, open: JSON.parse },
    ...(options.readPage ? {readPage:options.readPage} : {}),
    ...(options.assistantFetch ? {assistantFetch:options.assistantFetch} : {})
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
  await page.goto(f.url+'/dashboard');
  await page.getByRole('button',{name:'Toggle navigation'}).click();
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
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Backup Signup', exact: true }).click();
  await page.locator('#backup-view #backup-title').waitFor();
  await page.locator('#backup-account').getByText('Your Google account is connected.').waitFor();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: /^My Watchlist/ }).click();
  await page.locator('#tracks').getByRole('button', { name: 'Prepare a Signup' }).click();
  await page.getByRole('link', { name: 'Open registration page' }).waitFor();
  assert.equal(new URL(page.url()).pathname,'/dashboard');
  assert.deepEqual(errors, []);
});

test('assistant cites owner evidence, keeps private records out of Gemini, and clears saved history',async t=>{
  let callCount=0;
  let bogus=false;
  const f=await fixture(t,{env:{GEMINI_API_KEY:'fixture-only'},assistantFetch:async function(request,init){
    callCount++;
    assert.match(request,/generativelanguage\.googleapis\.com/);
    const data=JSON.parse(init.body);
    assert.match(data.contents[0].parts[0].text,/Registration deadline/);
    assert.doesNotMatch(init.body,/private draft|secret note|unrelated user|private task/);
    return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({summary:'The saved registration date is 1 December 2099.',ids:[bogus?999:0]})}]}}]}));
  }});
  f.track.milestones[0].date='2099-12-01';
  f.store.put('local-demo','track',f.track.id,f.track);
  f.store.put('local-demo','applicationWorkspace',f.track.id,{
    notes:'secret note',priority:'normal',pages:[],checklist:[{required:true,done:false}],tasks:[{label:'private task',due:'2099-12-01',dependencies:[],done:false}]
  });
  f.store.put('someone-else','track','outside',{...f.track,id:'outside',title:'unrelated user'});
  f.store.put('local-demo','signup','draft',{id:'draft',trackId:f.track.id,status:'Draft',sealed:'private draft'});
  const request=(path,method,body)=>f.request('/api/'+path,method,body,f.token);
  const question='What are the upcoming deadlines?';
  const first=await request('assistant/answer','POST',{question,useGemini:false});
  assert.equal(first.status,200);
  assert.equal(first.data.answer.mode,'workspace');
  assert.match(first.data.answer.summary,/Next up: Orbit Hack/);
  assert.equal(callCount,0);
  const unverified=await request('assistant/answer','POST',{question,useGemini:true});
  assert.equal(unverified.data.answer.mode,'workspace');
  assert.equal(callCount,0);
  recordSourceCheck(f.store,'local-demo',f.track,[{requestedUrl:f.source,milestones:f.track.milestones}],[],new Date().toISOString());
  const ranked=await request('assistant/answer','POST',{question,useGemini:true});
  assert.equal(ranked.data.answer.mode,'gemini');
  assert.equal(ranked.data.answer.items[0].url,f.source);
  assert.equal(ranked.data.answer.items[0].cited,true);
  assert.match(ranked.data.answer.sourceSummary,/1 December 2099/);
  bogus=true;
  const fallback=await request('assistant/answer','POST',{question,useGemini:true});
  assert.equal(fallback.data.answer.mode,'workspace');
  assert.match(fallback.data.answer.note,/could not summarize/);
  const privateAnswer=await request('assistant/answer','POST',{question:'Which documents are required?',useGemini:true});
  assert.equal(privateAnswer.data.answer.mode,'workspace');
  assert.match(privateAnswer.data.answer.summary,/1 required checklist item is still open/);
  const tasks=await request('assistant/answer','POST',{question:'Which tasks are open for Orbit Hack?'});
  assert.match(tasks.data.answer.items[0].text,/private task/);
  assert.equal(callCount,2);
  const persisted=await request('assistant/history','PATCH',{action:'save',receipt:first.data.receipt});
  const second={...f.track,id:'second',title:'Other Scholarship'};
  f.store.put('local-demo','track',second.id,second);
  await request('opportunities/'+second.id+'/application','PATCH',{action:'addRequirement',label:'Other transcript',required:true});
  const followUp=await request('assistant/answer','POST',{question:'What documents am I missing for it?',previousId:first.data.answer.id});
  assert.equal(followUp.data.answer.trackId,f.track.id);
  assert.equal(followUp.data.answer.items.length,1);
  assert.doesNotMatch(JSON.stringify(followUp.data.answer),/Other transcript/);
  const readiness=await request('assistant/answer','POST',{question:'Am I ready to submit for Orbit Hack?'});
  assert.match(readiness.data.answer.summary,/Start with private task/);
  const absent=await request('assistant/answer','POST',{question:'When does "Unknown Program" close?'});
  assert.equal(absent.data.answer.items.length,0);
  assert.match(absent.data.answer.summary,/couldn’t find/);
  f.store.remove('local-demo','track',second.id);

  assert.equal(persisted.data.entries.length,1);
  assert.ok(f.store.get('local-demo','assistantHistory','me').sealed);
  assert.equal((await request('assistant/memory','PATCH',{action:'save',label:'Preference',value:'Choose small teams'})).status,200);
  const details=await request('productivity','GET');
  assert.equal(details.data.insights.activeOpportunities,1);
  assert.ok(details.data.events.some(event=>event.label==='private task'));
  await request('assistant/history','PATCH',{action:'clear'});
  assert.equal((await request('assistant/history','PATCH',{action:'save',receipt:first.data.receipt})).status,409);
  assert.deepEqual((await request('assistant/history','GET')).data.entries,[]);
});

test('planning UI answers a question, saves a memory note and renders the heatmap', {skip:!executablePath}, async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.url+'/dashboard');
  await page.getByRole('button',{name:'Ask Deadline Scout',exact:true}).click();
  await page.getByText('Answers use your saved dates, changes, and application plans.').waitFor();
  await page.getByLabel('Question',{exact:true}).fill('What should I do first?');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await page.getByRole('heading',{name:'What needs your attention'}).waitFor();
  await page.locator('.nav-more > summary').click();
  await page.getByRole('button',{name:'Saved notes'}).click();
  await page.getByLabel('Label',{exact:true}).fill('Preference');
  await page.getByLabel('Note',{exact:true}).fill('Local memory');
  await page.getByRole('button',{name:'Add note'}).click();
  await page.getByText('Preference',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Deadline calendar'}).click();
  await page.locator('[data-cal-day]').first().waitFor();
  assert.equal(await page.locator('[data-cal-day]').count(),42);
  await page.getByLabel('Period',{exact:true}).selectOption('week');
  assert.equal(await page.locator('[data-cal-day]').count(),7);
  await page.getByRole('button',{name:'Activity summary'}).click();
  await page.locator('#productivity-content').getByText('Tracked opportunities',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
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
  await page.goto(f.url+'/dashboard');
  await page.getByRole('heading',{name:'Upcoming deadlines'}).waitFor();
  assert.equal(await page.getByText('Recent date changes',{exact:true}).count(),0);
  const navigation=page.locator('#workspace-menu');
  const content=page.locator('.workspace-content');
  const origin=(await content.boundingBox()).x;
  assert.ok((await navigation.boundingBox()).width>200);
  await page.locator('.nav-more > summary').click();
  const item=page.getByRole('button',{name:'Source changes'});
  const idleColor=await item.evaluate(node=>getComputedStyle(node).backgroundColor);
  await item.hover();
  assert.notEqual(await item.evaluate(node=>getComputedStyle(node).backgroundColor),idleColor);
  assert.equal((await content.boundingBox()).x,origin);
  await page.getByRole('button',{name:'Source changes'}).click();
  await page.getByRole('heading',{name:'Fees',exact:true}).waitFor();
  await page.getByLabel('Category').selectOption('fee');
  await page.getByText('₹500',{exact:true}).waitFor();
  await page.getByText('₹700',{exact:true}).waitFor();
  await page.getByLabel('Jump to change').selectOption({label:'Orbit Hack · Fees'});
  await page.getByRole('button',{name:'Mark as reviewed'}).click();
  await page.getByText('Reviewed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByText('Reviewed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Needs attention'}).click();
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
  await page.goto(f.url+'/dashboard');
  await page.getByRole('button',{name:'Applications'}).click();
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
  await page.locator('.nav-more > summary').click();
  await page.getByRole('button',{name:'Reusable answers'}).click();
  const passport=page.locator('#passport-content');
  await passport.getByLabel('Label').fill('Skill');
  await passport.getByLabel('Value').fill('JavaScript');
  await passport.getByRole('button',{name:'Add entry'}).click();
  await passport.getByText('Skill',{exact:true}).waitFor();
});

test('public home, profile menu, settings and navigation fit the requested viewports', {skip:!executablePath}, async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function capture(name,width) {
    if(process.env.SCOUT_LAYOUT_SCREENSHOTS)await page.screenshot({
      path:'data/layout-review/'+name+'-'+width+'.png',animations:'disabled'
    });
  }
  for(const width of [1440,1280,1024,768,390]){
    await page.setViewportSize({width,height:900});
    await page.goto(f.url);
    await page.getByRole('heading',{name:'Never miss what matters.'}).waitFor();
    assert.equal(await page.locator('#opportunity-overview').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Landing '+width);
    await capture('home',width);
    if(width===1440){
      for(const label of ['Scan example page','Find the deadline','Start tracking','Run another check','Show the alert']){
        await page.getByRole('button',{name:label,exact:true}).click();
      }
      await page.getByText('Deadline moved 3 days earlier',{exact:true}).waitFor();
    }
    await page.getByRole('button',{name:/Get Started|Go to Dashboard/}).first().click();
    await page.waitForURL('**/dashboard');
    await page.getByRole('heading',{name:'Upcoming deadlines'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Dashboard '+width);
    await capture('dashboard',width);
    const nav=page.locator('#workspace-sidebar');
    if(width<=800){
      assert.equal(await nav.isVisible(),false);
      await page.getByRole('button',{name:'Toggle navigation'}).click();
      await nav.getByRole('button',{name:/My Watchlist/}).click();
      assert.equal(await nav.isVisible(),false);
    }else{
      assert.equal(await nav.isVisible(),true);
      await page.getByRole('button',{name:'Toggle navigation'}).click();
      assert.equal(await nav.isVisible(),false);
      await page.getByRole('button',{name:'Toggle navigation'}).click();
    }
    await page.getByRole('button',{name:'Open profile'}).click();
    const menu=page.locator('#profile-popover');
    const box=await menu.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=width&&box.height<400,'Profile '+width);
    assert.equal(await menu.locator('#settings-view').count(),0);
    if(width===390||width===1440)await capture('profile',width);
    await menu.getByRole('button',{name:'Account settings'}).click();
    await page.getByRole('heading',{name:'Google Calendar & Tasks'}).waitFor();
    assert.equal(await menu.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Settings '+width);
    if(width===390||width===1440)await capture('settings',width);
  }
  assert.deepEqual(errors,[]);
});

test('signed-out dashboard preserves the extension handoff across the existing Google sign-in return', {skip:!executablePath}, async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('**/api/config',route=>route.fulfill({json:{auth:'supabase'}}));
  await page.route('**/api/auth/prepare',async route=>{
    const {redirect,challenge}=route.request().postDataJSON();
    assert.equal(redirect,f.url+'/auth/done');
    assert.match(challenge,/^[\w-]{43}$/);
    await route.fulfill({json:{url:f.url+'/auth/done#code=fixture'}});
  });
  await page.route('**/api/auth/redeem',route=>route.fulfill({json:{token:f.token}}));
  await page.goto(f.url+'/#opportunity='+f.track.id);
  await page.waitForURL(url=>url.pathname==='/'&&!url.hash);
  await page.getByRole('button',{name:'Log In',exact:true}).click();
  await page.waitForURL('**/dashboard#opportunity='+f.track.id);
  await page.getByRole('heading',{name:'Orbit Hack',exact:true}).waitFor();
});

test('readiness forecasts only saved open work and respects task prerequisites', () => {
  const tasks = [
    { id: 'completed', label: 'Research', done: true, dependencies: [] },
    { id: 'draft', label: 'Draft essay', done: false, dependencies: ['completed'] },
    { id: 'review', label: 'Review essay', done: false, dependencies: ['draft'] }
  ];
  const checklist = [
    { id: 'resume', label: 'Resume', required: true, done: true },
    { id: 'letter', label: 'Letter', required: true, done: false },
    { id: 'optional', label: 'Portfolio', required: false, done: false }
  ];
  const workspace = { tasks, checklist };
  const estimates = new Map([['task:draft', 2], ['task:review', 3], ['requirement:letter', 4]]);
  const inputs = { today: '2026-11-27', deadline: '2026-12-04', delay: 0, estimates };
  const before = structuredClone(workspace);
  const result = simulateReadiness(workspace, inputs);
  assert.equal(result.completed, 1);
  assert.equal(result.total, 2);
  assert.equal(result.next.id, 'draft');
  assert.equal(result.finish, '2026-12-02');
  assert.equal(result.slack, 2);
  assert.equal(simulateReadiness(workspace, { ...inputs, delay: 3 }).slack, -1);
  assert.deepEqual(workspace, before);
});

test('overview opens a readiness scenario and pre-fills the existing assistant', {skip: !executablePath}, async t => {
  const f = await fixture(t);
  const track = structuredClone(f.track);
  track.milestones[0].date = '2099-06-20';
  f.store.put('local-demo', 'track', track.id, track);
  const apiPath = '/api/opportunities/' + track.id + '/application';
  assert.equal((await f.request(apiPath, 'PATCH', {action:'addRequirement',label:'Recommendation',required:true}, f.token)).status, 200);
  assert.equal((await f.request(apiPath, 'PATCH', {action:'addTask',label:'Review application',dependencies:[]}, f.token)).status, 200);
  const browser = await chromium.launch({executablePath, headless:true});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url + '/dashboard');
  await page.locator('#opportunity-overview').getByRole('link', {name:'Recommendation'}).waitFor();
  const feature=page.locator('.deadline-feature');
  assert.equal(await feature.getByRole('heading').textContent(),'Orbit Hack');
  assert.match(await feature.textContent(),/Jun 20, 2099/);
  assert.equal(await page.locator('.scout-overview-main .date-line').count(),0);
  const main = await page.locator('.scout-overview-main').boundingBox();
  const rail = await page.locator('.scout-overview-rail').boundingBox();
  assert.ok(rail.x >= main.x + main.width && rail.y === main.y);
  const snapshot = page.getByRole('article').filter({has:page.getByRole('heading',{name:'Readiness at a glance'})});
  assert.equal(await snapshot.getByRole('progressbar').getAttribute('max'),'1');
  await snapshot.getByRole('button',{name:'Simulate',exact:true}).click();
  await page.getByRole('heading', {name:'Checklist progress',exact:true}).waitFor();
  await page.getByRole('spinbutton', {name:/Recommendation/}).fill('5');
  await page.getByRole('button', {name:'Start in 3 days'}).click();
  assert.match(await page.locator('[data-readiness-result]').textContent(), /Estimated finish: .* days? before the deadline/);
  await page.setViewportSize({width:390,height:840});
  assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), true);
  await page.getByRole('button', {name:'Toggle navigation'}).click();
  await page.getByRole('button', {name:'Overview',exact:true}).click();
  await page.getByRole('textbox', {name:'Ask Scout a question'}).fill('What closes next week?');
  await page.getByRole('button', {name:'Open assistant'}).click();
  assert.equal(await page.locator('#assistant-question').inputValue(), 'What closes next week?');
  assert.deepEqual(errors, []);
});

test('dashboard loads more timeline and email rows on demand',{skip:!executablePath},async t=>{
  const f=await fixture(t);
  const track=f.track;
  const date='2099-01-01';
  for(let i=0;i<23;i++){
    const id='page-'+i, at=new Date(Date.UTC(2026,11,1,0,i)).toISOString();
    f.store.put('local-demo','change',id,{id,trackId:track.id,at,title:'Change '+i,label:'Date changed',
      before:{date},after:{date,sourceUrl:track.url,quote:'Original evidence'}});
    f.store.put('local-demo','delivery',id,{id,at,channel:'email',subject:'Email '+i,status:'failed'});
  }
  // This test exercises paging, independently of the transient notification overlay.
  f.store.put('local-demo','dashboard','preferences',{
    groups:[],pinnedIds:[],seenChangeIds:Array.from({length:23},(_,index)=>'page-'+index)
  });
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  const requests=[];
  page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.goto(f.url+'/dashboard');
  await page.getByRole('heading',{name:'Upcoming deadlines'}).waitFor();
  assert.equal(requests.includes('/api/changes'),false);
  assert.equal(requests.includes('/api/deliveries'),false);
  await page.locator('#workspace-sidebar').getByRole('button',{name:/Timeline/}).click();
  await page.getByRole('button',{name:'Load older changes'}).click();
  await page.locator('#timeline').getByRole('heading',{name:'Change 0',exact:true}).waitFor();
  assert.equal(await page.locator('#timeline').getByRole('heading',{name:/^Change \d+$/}).count(),23);
  await page.locator('.nav-more > summary').click();
  await page.locator('#workspace-sidebar').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByText('3 shown',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load 5 more'}).click();
  await page.getByText('8 shown',{exact:true}).waitFor();
  assert.equal(await page.locator('#outbox .outbox-item').count(),8);
});

test('extension date review uses one workspace read and displays the capture during verification',{skip:!executablePath},async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.addInitScript(token=>localStorage.setItem('dd:token',JSON.stringify(token)),f.token);
  await page.route('**/api/config',route=>route.fulfill({json:{auth:'supabase'}}));
  let allowVerification;
  const pending=new Promise(resolve=>{allowVerification=resolve;});
  t.after(allowVerification);
  await page.route('**/api/inspect',async route=>{
    await pending;
    await route.fulfill({json:{milestones:f.track.milestones}});
  });
  const capture=await f.request('/api/captures','POST',{url:f.track.url,title:'Captured workshop',milestones:f.track.milestones},f.token);
  assert.equal(capture.status,201);
  const requests=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto(capture.data.reviewUrl);
  assert.equal(new URL(page.url()).pathname,'/dashboard');
  const review=page.getByRole('dialog',{name:/milestone.*review and save/i});
  await review.getByLabel('Page name').waitFor();
  assert.equal(await review.getByLabel('Page name').inputValue(),'Captured workshop');
  assert.equal(await review.getByRole('button',{name:'Checking source…'}).isDisabled(),true);
  assert.equal(requests.filter(path=>path==='/api/workspace').length,1);
  assert.equal(requests.filter(path=>path==='/api/me').length,0);
  assert.equal(requests.filter(path=>path.startsWith('/api/captures/')).length,1);
  assert.equal(requests.filter(path=>path==='/api/inspect').length,1);
  allowVerification();
  await review.getByRole('button',{name:'Save tracked page'}).waitFor();
});

test('startup shows the Scout animation and preserves a readable sign-in error',{skip:!executablePath},async t=>{
  const f=await fixture(t);
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:780}});
  let release;
  const ready=new Promise(resolve=>{release=resolve;});
  t.after(release);
  await page.route('**/api/config',async route=>{await ready;await route.continue();});
  await page.goto(f.url+'/dashboard',{waitUntil:'commit'});
  const character=page.locator('.scout-loading-robot');
  await character.waitFor();
  assert.equal(await character.evaluate(node=>getComputedStyle(node).animationName),'scout-hover');
  assert.equal(await page.getByText('Loading Deadline Scout',{exact:true}).evaluate(node=>node.offsetWidth),1);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await character.evaluate(node=>getComputedStyle(node).animationName),'none');
  release();
  await page.getByRole('heading',{name:'Upcoming deadlines'}).waitFor();
  assert.equal(await character.isVisible(),false);
  await page.goto(f.url+'/auth/done');
  await page.getByText('This sign-in link has expired. Return to the app and sign in again.').waitFor();
  assert.equal(await character.isVisible(),false);
});
