import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import {Signups} from '../server/signups.js';
import {vault} from '../server/security.js';
import {suggestField,validateFiles,validateAnswer} from '../extension/shared/signup.js';
import {createApp} from '../server/app.js';
const base='http://localhost:4317';
function fixture(t){const store=new Store(':memory:'),secrets=vault('.',Buffer.alloc(32,7).toString('base64')),s=new Signups({store,secrets,base});t.after(()=>store.close());const m={id:'deadline',date:'2030-09-12',time:'17:00',zone:'Asia/Kolkata'};store.put('alice','track','track',{id:'track',milestones:[m],conflicts:[],uncertain:[]});return {store,s,m};}
async function draft(f,{mode='demo-auto',email='test@example.com'}={}){const schema=f.s.schema(),file=f.s.file('alice',{name:'proposal.pdf',data:Buffer.from('%PDF-1.4\nTest proposal only').toString('base64')}),step={url:base+'/signup-demo.html',title:'Scout Lab',terms:schema.terms,fields:schema.fields,answers:{'id:name':'Test Person','id:email':email,'id:repo':'https://github.com/example/repository'},files:{'id:proposal':[file]}};
 const d=await f.s.route('alice','/api/signups','POST',{title:'Demo test',trackId:'track',steps:[step],reviewedAll:true});return f.s.route('alice','/api/signups/'+d.id+'/arm','POST',{mode,approved:true,backupAt:Date.now()+60000,milestoneId:'deadline'});}
function due(f,d){d.backupAt=Date.now()-1;f.s.save('alice',d);}
test('mappings distinguish repository, profile and video links; ambiguous links are never silently chosen',()=>{
 const links=[{kind:'github',url:'https://github.com/alice'},{kind:'repository',url:'https://github.com/alice/project'},{kind:'video',url:'https://example.org/demo'},{kind:'deck',url:'https://example.org/slides'}];
 assert.equal(suggestField({label:'GitHub profile'}, {},links).value,links[0].url);assert.equal(suggestField({label:'GitHub repository URL'}, {},links).value,links[1].url);assert.equal(suggestField({label:'Demo video'}, {},links).value,links[2].url);assert.equal(suggestField({label:'Presentation link'}, {},links).value,links[3].url);assert.equal(suggestField({label:'Affiliation'},{college:'Test College'}).value,'Test College');assert.equal(suggestField({label:'Repository URL'}, {},[...links,{kind:'repository',url:'https://example.org/second'}]).value,'');
 assert.match(validateAnswer({label:'Repository URL',help:'Must use github.com',type:'url'},'https://example.org/repo'),/github/);
});
test('two upload fields validate their own files, types, sizes and missing attachments',()=>{
 const pdf={label:'Proposal',type:'file',required:true,accept:'.pdf',maxBytes:20},photo={label:'Team photo',required:true,accept:'image/*'};
 assert.match(validateFiles(pdf,[]),/Choose/);assert.match(validateFiles(pdf,[{name:'wrong.png',size:5,type:'image/png'}]),/type/);assert.match(validateFiles(pdf,[{name:'big.pdf',size:21,type:'application/pdf'}]),/size/);assert.equal(validateFiles(photo,[{name:'photo.png',size:5,type:'image/png'}]),'');assert.equal(validateFiles(pdf,[{name:'proposal.pdf',size:10,type:'application/pdf'}]),'');
});
test('encrypted snapshots are owner scoped, immutable uploads are checked and rearming edits requires approval',async t=>{
 const f=fixture(t),d=await draft(f);assert.equal(d.status,'Armed');assert.ok(!JSON.stringify(f.store.get('alice','signup',d.id)).includes('test@example.com'));assert.throws(()=>f.s.read('bob',d.id),/not found/);
 const edited=await f.s.route('alice','/api/signups','POST',{...d,reviewedAll:false});assert.equal(edited.status,'Draft');await assert.rejects(f.s.route('alice','/api/signups/'+d.id+'/arm','POST',{approved:true,mode:'demo-auto',milestoneId:'deadline',backupAt:Date.now()+60000}),/reviewed/);
});
test('demo backup submits once, confirms receipt and recognizes already registered users',async t=>{
 const f=fixture(t),d=await draft(f);due(f,d);await f.s.tick();const result=f.s.read('alice',d.id);assert.equal(result.status,'Confirmed');assert.match(result.receipt,/^DEMO-/);await f.s.tick();assert.equal(f.store.list('_system','demoSignup').length,1);
 const second=await draft(f);due(f,second);await f.s.tick();assert.equal(f.s.read('alice',second.id).status,'Already registered');assert.equal(f.store.list('_system','demoSignup').length,1);
});
test('new required field, missing file, changed terms and new fee pause automatic backup',async t=>{
 for(const scenario of ['field','file','expired','terms','fee','uncertain']){const f=fixture(t),d=await draft(f);if(scenario==='expired'){const ref=d.steps[0].files['id:proposal'][0],file=f.store.get('alice','signupFile',ref.id);file.expires=0;f.store.put('alice','signupFile',ref.id,file);}else if(scenario==='file')f.store.remove('alice','signupFile',d.steps[0].files['id:proposal'][0].id);else{const schema=f.s.schema();if(scenario==='field')schema.fields.push({key:'id:new',label:'New required question',type:'text',required:true});if(scenario==='terms')schema.terms='Changed consent';if(scenario==='fee')schema.fee=10;if(scenario==='uncertain')schema.open='unknown';f.store.put('_system','demoOrganizer','schema',schema);}due(f,d);await f.s.tick();assert.equal(f.s.read('alice',d.id).status,'Needs review',scenario);assert.equal(f.store.list('_system','demoSignup').length,0);}
});
test('demo timeout reconciles status on next attempt without a duplicate registration',async t=>{
 const f=fixture(t),d=await draft(f),schema=f.s.schema();schema.timeoutOnce=true;f.store.put('_system','demoOrganizer','schema',schema);due(f,d);await f.s.tick();assert.equal(f.s.read('alice',d.id).status,'Armed');await f.s.tick();assert.equal(f.s.read('alice',d.id).status,'Confirmed');assert.equal(f.store.list('_system','demoSignup').length,1);
});
test('ordinary websites only create reminders, and cancelled or removed-page drafts never run',async t=>{
 const f=fixture(t),d=await draft(f,{mode:'reminder'});d.formUrl='https://example.org/signup';due(f,d);await f.s.tick();assert.equal(f.s.read('alice',d.id).status,'Ready to finish');assert.equal(f.store.list('_system','demoSignup').length,0);
 const cancelled=await draft(f);await f.s.route('alice','/api/signups/'+cancelled.id+'/cancel','POST',{});await f.s.tick();assert.equal(f.s.read('alice',cancelled.id).status,'Cancelled');
 const removed=await draft(f);f.store.remove('alice','track','track');due(f,removed);await f.s.tick();assert.equal(f.s.read('alice',removed.id).status,'Cancelled');
});
test('relative timing follows approved deadline changes and pauses if new time already passed',async t=>{
 const f=fixture(t),d=await draft(f);d.rule='relative';d.offsetMinutes=15;f.s.save('alice',d);const track=f.store.get('alice','track','track');track.milestones[0].date='2030-09-11';f.store.put('alice','track','track',track);await f.s.tick();assert.equal(f.s.read('alice',d.id).deadline.date,'2030-09-11');track.milestones[0].date='2020-01-01';f.store.put('alice','track','track',track);await f.s.tick();assert.equal(f.s.read('alice',d.id).status,'Needs review');
});
test('public captures require auth to consume and signup APIs never expose another owner',async t=>{
 const app=createApp({env:{HOST:'127.0.0.1',APP_URL:base},store:new Store(':memory:')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const root='http://127.0.0.1:'+app.server.address().port;
 const r=await fetch(root+'/api/signup-captures',{method:'POST',body:JSON.stringify({step:{url:'https://example.org/form',fields:[],terms:''}})});assert.equal(r.status,200);const capture=await r.json(),token=new URL(capture.url).hash.slice(9);const denied=await fetch(root+'/api/signup-captures/'+token);assert.equal(denied.status,401);assert.equal((await fetch(root+'/api/signups')).status,401);
});

test('next form capture appends atomically, recapture keeps answers, and user ordering persists',async t=>{
 const f=fixture(t),d=await draft(f,{mode:'reminder'}),step={url:base+'/second-step',title:'Team details',fields:[{key:'id:team',id:'team',label:'Team name',type:'text',required:true}],answers:{'id:team':'Scout team'}};
 const appended=await f.s.route('alice','/api/signups/'+d.id+'/steps','POST',{step});assert.equal(appended.id,d.id);assert.equal(appended.steps.length,2);assert.equal(appended.status,'Draft');assert.equal(appended.reviewedAll,false);
 const recaptured=await f.s.route('alice','/api/signups/'+d.id+'/steps','POST',{step:{...step,answers:{'id:team':''}}});assert.equal(recaptured.steps.length,2);assert.equal(recaptured.steps[1].answers['id:team'],'Scout team');
 const reordered=await f.s.route('alice','/api/signups/'+d.id+'/reorder','POST',{order:[1,0],revision:recaptured.revision});assert.equal(reordered.steps[0].title,'Team details');assert.equal(reordered.steps[1].answers['id:name'],'Test Person');assert.equal(f.s.read('alice',d.id).steps[0].url,base+'/second-step');
 await assert.rejects(f.s.route('alice','/api/signups/'+d.id+'/reorder','POST',{order:[0,0],revision:reordered.revision}),/exactly once/);
 await assert.rejects(f.s.route('alice','/api/signups','POST',{...recaptured,reviewedAll:true}),/another tab/);
 assert.equal(f.s.list('alice').length,1);
});

test('deleting a signup hides it, cancels reminders and prevents execution; undo restores an unarmed draft',async t=>{
 const f=fixture(t),d=await draft(f);f.s.notify('alice',d,'Test signup notice');due(f,d);
 await assert.rejects(f.s.route('bob','/api/signups/'+d.id,'DELETE',{}),/not found/);
 await f.s.route('alice','/api/signups/'+d.id,'DELETE',{});assert.equal(f.s.list('alice').length,0);await f.s.tick();assert.equal(f.store.list('_system','demoSignup').length,0);assert.ok(f.store.list('alice','delivery').every(x=>x.status==='cancelled'));
 const restored=await f.s.route('alice','/api/signups/'+d.id+'/restore','POST',{});assert.equal(restored.status,'Draft');assert.equal(restored.reviewedAll,false);assert.equal(restored.steps.length,1);
});
import {resumePlan,fillPendingSignup} from '../extension/shared/signup-resume.js';
test('manual execution restores matching pages and skips already-filled steps, changed terms and other sites',async t=>{
 const f=fixture(t),first=f.s.capture({url:'https://example.org/form?page=1',terms:'Terms A',fields:[{key:'id:name',id:'name',label:'Name',type:'text',required:true}]}),second=f.s.capture({url:'https://example.org/form?page=2',terms:'Terms A',fields:[{key:'id:repo',id:'repo',label:'Repository URL',type:'url',required:true}]});
 const d={formUrl:first.url,reviewedAll:true,steps:[{...first,answers:{'id:name':'Test User'}},{...second,answers:{'id:repo':'https://github.com/test/repo'}}]};
 assert.equal(resumePlan(d,second).index,1);assert.match(resumePlan(d,{...second,terms:'New terms'}).error,/Terms/);
 let pending={draft:d,tabId:1,expires:Date.now()+60000,filled:[]},live=first,restores=0,permission=false;
 const storage={get:async()=>pending,set:async(_key,v)=>pending=v};
 const browser={tabs:{get:async()=>({url:live.url})},permissions:{contains:async()=>permission},scripting:{executeScript:async o=>{if(o.func.name==='captureSignupForm')return [{result:live}];if(o.func.name==='restoreSignupAnswers'){restores++;assert.ok(o.args[0].answers);return [{result:['Restored saved answers']}];}return [{result:null}];}}};
 assert.equal((await fillPendingSignup({browser,storage,tabId:1})).needsPermission,true);assert.equal(restores,0);
 permission=true;assert.equal((await fillPendingSignup({browser,storage,tabId:1})).ok,true);await fillPendingSignup({browser,storage,tabId:1});assert.equal(restores,1);
 live=second;await fillPendingSignup({browser,storage,tabId:1});assert.equal(restores,2);
 live={...second,url:'https://other.example/form'};assert.equal((await fillPendingSignup({browser,storage,tabId:1})).ok,false);assert.equal(restores,2);
});

test('Register now manually invokes only the demo organizer and produces a receipt without waiting',async t=>{
 const f=fixture(t),d=await draft(f);const result=await f.s.route('alice','/api/signups/'+d.id+'/submit-now','POST',{approved:true,milestoneId:'deadline'});assert.equal(result.status,'Confirmed');assert.match(result.receipt,/DEMO-/);
 const ordinary=await draft(f,{mode:'reminder'});ordinary.formUrl='https://example.org/form';ordinary.steps[0].url=ordinary.formUrl;f.s.save('alice',ordinary);await assert.rejects(f.s.route('alice','/api/signups/'+ordinary.id+'/submit-now','POST',{approved:true,milestoneId:'deadline'}),/demo organizer/);
});

import {advanceSignup} from '../extension/shared/signup-resume.js';
test('approved submission dispatch requires complete files, consent, validity and one submit control',()=>{
 const previousStyle=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({visibility:'visible'});const previous=globalThis.document;let submits=0,valid=true,files=[],checks=[],buttons=[{type:'submit',innerText:'Register',disabled:false,getClientRects:()=>[{}]}];
 const form={innerText:'Your registration',getClientRects:()=>[{}],querySelector:()=>({}),querySelectorAll:s=>s==='input[type=file]'?files:s==='input[type=checkbox]'?checks:s==='button,input[type=submit]'?buttons:[],checkValidity:()=>valid,requestSubmit:()=>submits++};
 globalThis.document={forms:[form],querySelectorAll:()=>[]};try{
  files=[{required:true,files:[]}];assert.equal(advanceSignup({finalStep:true}).paused,true);assert.equal(submits,0);
  files=[];checks=[{required:true,checked:false}];assert.equal(advanceSignup({finalStep:true}).paused,true);assert.equal(submits,0);
  checks=[];valid=false;assert.equal(advanceSignup({finalStep:true}).paused,true);valid=true;
  assert.equal(advanceSignup({finalStep:true}).attempted,true);assert.equal(submits,1);
  assert.equal(advanceSignup({finalStep:false}).paused,true);assert.equal(submits,1);
  buttons=[{type:'button',innerText:'Next',getClientRects:()=>[{}],click:()=>{}}];assert.equal(advanceSignup({finalStep:false}).advanced,true);assert.equal(submits,1);
 }finally{globalThis.document=previous;globalThis.getComputedStyle=previousStyle;}
});

test('an uncertain ordinary-site submit attempt is persisted and never automatically repeated',async t=>{
 const f=fixture(t),step=f.s.capture({url:'https://example.org/register',terms:'',fields:[{key:'id:name',id:'name',label:'Name',type:'text'}]});let pending={draft:{formUrl:step.url,steps:[{...step,answers:{'id:name':'Test'}}]},tabId:1,expires:Date.now()+100000,autoSubmit:true},attempts=0;
 const storage={get:async()=>pending,set:async(_k,v)=>pending=v},browser={tabs:{get:async()=>({url:step.url})},permissions:{contains:async()=>true},scripting:{executeScript:async o=>{if(o.func.name==='captureSignupForm')return [{result:step}];if(o.func.name==='restoreSignupAnswers')return [{result:['Name restored']}];if(o.func.name==='advanceSignup'){attempts++;throw Error('Navigation interrupted response');}return [{result:null}];}}};
 await assert.rejects(fillPendingSignup({browser,storage,tabId:1}),/interrupted/);await fillPendingSignup({browser,storage,tabId:1,force:true});assert.equal(attempts,1);
});

test('paused automation resumes after a manual attachment without overwriting answers',async()=>{
 const step={url:'https://example.org/register',terms:'',stepToken:'project-panel',fields:[{key:'id:project',id:'project',label:'Project',type:'text'}]};
 let pending={draft:{formUrl:step.url,steps:[{...step,answers:{'id:project':'Test'}}]},tabId:1,expires:Date.now()+100000,autoSubmit:true},restores=0,attempts=0,attached=false;
 const storage={get:async()=>pending,set:async(_k,v)=>pending=v},browser={tabs:{get:async()=>({url:step.url})},permissions:{contains:async()=>true},scripting:{executeScript:async o=>{if(o.func.name==='captureSignupForm')return [{result:step}];if(o.func.name==='restoreSignupAnswers'){restores++;return [{result:['Project restored']}];}if(o.func.name==='advanceSignup'){attempts++;return [{result:attached?{attempted:true}:{paused:true,message:'Attach required file'}}];}return [{result:null}];}}};
 await fillPendingSignup({browser,storage,tabId:1});assert.equal(pending.attempted.length,0);
 attached=true;await fillPendingSignup({browser,storage,tabId:1});assert.equal(attempts,2);assert.equal(restores,1);
 await fillPendingSignup({browser,storage,tabId:1});assert.equal(attempts,2);
});

test('saved PDF downloads require the owner, reviewed active draft and immutable file reference',async t=>{
 const f=fixture(t),d=await draft(f),ref=d.steps[0].files['id:proposal'][0],path='/api/signups/'+d.id+'/files/'+ref.id;
 const file=await f.s.route('alice',path,'GET',{});assert.equal(file.name,'proposal.pdf');assert.ok(Buffer.from(file.data,'base64').subarray(0,5).equals(Buffer.from('%PDF-')));
 await assert.rejects(f.s.route('bob',path,'GET',{}),/not found/);
 const other=f.s.file('alice',{name:'other.pdf',data:Buffer.from('%PDF-test other').toString('base64')});await assert.rejects(f.s.route('alice','/api/signups/'+d.id+'/files/'+other.id,'GET',{}),/missing/);
 d.reviewedAll=false;f.s.save('alice',d);await assert.rejects(f.s.route('alice',path,'GET',{}),/review/);
 d.reviewedAll=true;f.s.save('alice',d);const saved=f.store.get('alice','signupFile',ref.id);saved.expires=0;f.store.put('alice','signupFile',ref.id,saved);await assert.rejects(f.s.route('alice',path,'GET',{}),/expired/);
 assert.throws(()=>f.s.file('alice',{name:'bad.pdf',data:Buffer.alloc(2*1024*1024+1).toString('base64')}),/2 MB/);
});

import {finalReviewPlan} from '../extension/shared/signup-resume.js';
test('background jobs claim once, stop after deletion or reapproval, and report submission without pretending confirmation',async t=>{
 const f=fixture(t),d=await draft(f,{mode:'reminder'});const armed=await f.s.route('alice','/api/signups/'+d.id+'/arm','POST',{approved:true,mode:'browser-auto',milestoneId:'deadline',backupAt:Date.now()+60000});
 assert.equal((await f.s.browserPoll('alice',armed.id,armed.revision)).waiting,true);due(f,armed);
 const run=await f.s.browserPoll('alice',armed.id,armed.revision);assert.ok(run.runId);assert.ok(run.filePayload[0].data);assert.equal(run.draft.status,'Browser running');
 assert.equal((await f.s.browserPoll('alice',armed.id,armed.revision)).stop,true);assert.equal((await f.s.browserPoll('alice',armed.id,armed.revision,{runId:run.runId,check:true})).allowed,true);
 await assert.rejects(f.s.browserPoll('alice',armed.id,armed.revision,{runId:'wrong',result:'attempted'}),/Wrong/);
 const reported=await f.s.browserPoll('alice',armed.id,armed.revision,{runId:run.runId,result:'attempted'});assert.equal(reported.status,'Submission requested');assert.notEqual(f.s.read('alice',armed.id).status,'Confirmed');
 const next=await draft(f,{mode:'reminder'}),a=await f.s.route('alice','/api/signups/'+next.id+'/arm','POST',{approved:true,mode:'browser-auto',milestoneId:'deadline',backupAt:Date.now()+60000});
 await f.s.route('alice','/api/signups/'+next.id+'/arm','POST',{approved:true,mode:'browser-auto',milestoneId:'deadline',backupAt:Date.now()+70000});await assert.rejects(f.s.browserPoll('alice',a.id,a.revision),/approval changed/);
 const removed=await draft(f,{mode:'reminder'}),b=await f.s.route('alice','/api/signups/'+removed.id+'/arm','POST',{approved:true,mode:'browser-auto',milestoneId:'deadline',backupAt:Date.now()+60000});f.store.remove('alice','track','track');assert.equal((await f.s.browserPoll('alice',b.id,b.revision)).status,'Cancelled');
});
test('final review needs all approved steps visited and rejects new fields or changed terms',()=>{
 const field={key:'id:name',type:'text',required:true},step={url:'https://example.org/form',fields:[field],terms:''},pending={autoSubmit:true,draft:{steps:[step]},visited:[0]},live={...step,fields:[]};
 assert.equal(finalReviewPlan(pending,live,step).review,true);assert.equal(finalReviewPlan({...pending,visited:[]},live,step),null);
 assert.equal(finalReviewPlan(pending,live,{...step,fields:[field,{key:'id:new',type:'text'}]}),null);assert.equal(finalReviewPlan(pending,{...live,terms:'New agreement'},step),null);assert.equal(finalReviewPlan(pending,live,{...step,fields:[]}),null);
});

import {startSignupSession,pollSignupJobs} from '../extension/shared/signup-background.js';
test('automatic sessions create inactive tabs and queued jobs do not steal an active signup session',async()=>{
 const state={};const storage={get:async k=>state[k],set:async(k,v)=>state[k]=v};let created;
 const browser={permissions:{contains:async()=>true},storage:{session:{set:async()=>{}}},tabs:{create:async args=>{created=args;return {id:12};}}};
 const draft={formUrl:'https://example.org/form',reviewedAll:true,steps:[]};await startSignupSession({browser,storage,draft,autoSubmit:true});assert.equal(created.active,false);assert.equal(state.signupResume.autoSubmit,true);
 await assert.rejects(startSignupSession({browser,storage,draft,autoSubmit:true}),/Another/);
 let requests=0;await pollSignupJobs({browser,storage,request:async()=>{requests++;},start:async()=>{}});assert.equal(requests,0);
 state.signupResume=null;state.signupJobs=[{token:'test'}];await pollSignupJobs({browser,storage,request:async()=>({stop:true}),start:async()=>{}});assert.equal(state.signupJobs.length,0);
});

import {hash} from '../server/security.js';
test('scheduled signup token is bound to one draft and the parent website session',async t=>{
 const app=createApp({env:{HOST:'127.0.0.1',APP_URL:base},store:new Store(':memory:')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const root='http://127.0.0.1:'+app.server.address().port,web='website-test-token';
 app.store.put('_system','session',hash(web),{owner:'alice',expires:Date.now()+100000});app.store.put('alice','track','track',{id:'track',milestones:[{id:'deadline',date:'2030-09-12',time:'17:00',zone:'Asia/Kolkata'}],conflicts:[],uncertain:[]});
 const step={url:'https://example.org/form',fields:[{key:'id:name',label:'Name',type:'text',required:true}],answers:{'id:name':'Test'},terms:''};
 const d=await app.signups.route('alice','/api/signups','POST',{trackId:'track',steps:[step],reviewedAll:true});await app.signups.route('alice','/api/signups/'+d.id+'/arm','POST',{approved:true,mode:'browser-auto',milestoneId:'deadline',backupAt:Date.now()+60000});
 const grant=await (await fetch(root+'/api/signups/'+d.id+'/browser-session',{method:'POST',headers:{Authorization:'Bearer '+web,'Content-Type':'application/json'},body:'{}'})).json();assert.ok(grant.token);
 const headers={Authorization:'Bearer '+grant.token,'Content-Type':'application/json'};
 assert.equal((await fetch(root+'/api/signups',{headers})).status,403);assert.equal((await fetch(root+'/api/signup-files',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await (await fetch(root+'/api/signup-browser/poll',{method:'POST',headers,body:'{}'})).json()).waiting,true);
 app.store.remove('_system','session',hash(web));assert.equal((await fetch(root+'/api/signup-browser/poll',{method:'POST',headers,body:'{}'})).status,401);
});
