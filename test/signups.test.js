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
