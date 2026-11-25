import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { publicAddress,vault } from '../server/security.js';
import { fetchPublicPage } from '../server/fetch-page.js';
import { createEmailAdapter } from '../server/email.js';
import { Google,calendarPayload,taskPayload } from '../server/google.js';
import { extract } from '../extension/shared/extract.js';
import { createHash,randomBytes } from 'node:crypto';
import { modelExtract } from '../server/model.js';
import {readRegistrationSource} from '../server/source-adapters.js';
const plainVault={seal:v=>JSON.stringify(v),open:v=>JSON.parse(v)};
async function fixture(t,extra={}){
  const app=createApp({env:{APP_URL:'http://localhost:4317',HOST:'127.0.0.1'},store:new Store(':memory:'),vault:plainVault,...extra});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  let token;
  async function request(path,method='GET',body,auth=token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();return {status:r.status,data};}
  token=(await request('/api/local-session','POST',{})).data.token;
  const source='http://localhost:4317/demo/registration';
  async function track(){const page=(await request('/api/inspect','POST',{url:source})).data;return (await request('/api/tracks','POST',{title:'Orbit Hack 2026',url:source,sources:[source,'http://localhost:4317/demo/faq'],plan:'2026-11-27',milestones:page.milestones.filter(m=>m.kind==='registration_closes').map(m=>({...m,confirmed:true}))})).data;}
  return {...app,request,track};
}
test('end-to-end change, impact, durable alerts, demo email, and duplicate suppression',async t=>{
  const f=await fixture(t),track=await f.track();assert.ok(track.id);
  await f.request('/api/demo','POST',{mode:'changed'});
  let r=await f.request('/api/tracks/'+track.id+'/check','POST',{});assert.equal(r.data.milestones[0].date,'2026-11-26');
  const changes=(await f.request('/api/changes')).data;assert.equal(changes.length,1);assert.match(changes[0].impact,/1 day after/);assert.match(changes[0].after.quote,/moved/);
  let deliveries=(await f.request('/api/deliveries')).data;assert.equal(deliveries.length,2);assert.equal(deliveries.find(d=>d.channel==='email').status,'demo');
  r=await f.request('/api/tracks/'+track.id+'/check','POST',{});assert.equal(r.data.status,'watching');assert.equal((await f.request('/api/changes')).data.length,1);assert.equal((await f.request('/api/deliveries')).data.length,2);
  const alerts=(await f.request('/api/alerts')).data;assert.equal(alerts.length,1);await f.request('/api/alerts/ack','POST',{id:alerts[0].id});assert.equal((await f.request('/api/alerts')).data.length,0);
});
test('banner edits, conflicts and fetch failures keep confirmed dates',async t=>{
  const f=await fixture(t),track=await f.track();
  await f.request('/api/demo','POST',{mode:'reworded'});await f.request(`/api/tracks/${track.id}/check`,'POST',{});assert.equal((await f.request('/api/changes')).data.length,0);
  await f.request('/api/demo','POST',{mode:'conflict'});let r=await f.request(`/api/tracks/${track.id}/check`,'POST',{});assert.equal(r.data.status,'conflict');assert.equal(r.data.milestones[0].date,'2026-11-28');assert.equal(r.data.conflicts[0].candidates.length,2);
  await f.request('/api/demo','POST',{mode:'failed'});r=await f.request(`/api/tracks/${track.id}/check`,'POST',{});assert.equal(r.data.status,'check_failed');assert.equal(r.data.milestones[0].date,'2026-11-28');assert.ok(r.data.errors.length);
});
test('approval resolves a conflict and remains stable on unchanged evidence',async t=>{
  const f=await fixture(t),track=await f.track();await f.request('/api/demo','POST',{mode:'conflict'});let r=await f.request(`/api/tracks/${track.id}/check`,'POST',{});const c=r.data.conflicts[0].candidates.find(c=>c.date==='2026-11-25');
  r=await f.request(`/api/tracks/${track.id}/resolve`,'POST',{milestoneId:track.milestones[0].id,date:c.date,sourceUrl:c.sourceUrl,approved:true});assert.equal(r.status,200);
  r=await f.request(`/api/tracks/${track.id}/check`,'POST',{});assert.equal(r.data.conflicts.length,0);assert.equal(r.data.milestones[0].date,'2026-11-25');
});
test('scheduler runs due tracks without extension polling',async t=>{
  const f=await fixture(t),track=await f.track();await f.request('/api/demo','POST',{mode:'changed'});track.nextCheck=0;f.store.put('local-demo','track',track.id,track);await f.engine.tick();assert.equal(f.store.list('local-demo','change').length,1);
});
test('manual reminders explicitly enable source monitoring and detect subsequent changes',async t=>{
 const f=await fixture(t),track=await f.track();track.milestones.forEach(m=>m.manual=true);f.store.put('local-demo','track',track.id,track);
 assert.equal((await f.request(`/api/tracks/${track.id}/check`,'POST',{})).data.status,'manual');
 assert.equal((await f.request(`/api/tracks/${track.id}/monitor`,'POST',{})).status,400);
 assert.equal((await f.request(`/api/tracks/${track.id}/monitor`,'POST',{approved:true})).data.milestones[0].manual,false);
 await f.request('/api/demo','POST',{mode:'changed'});const checked=await f.request(`/api/tracks/${track.id}/check`,'POST',{});assert.equal(checked.data.status,'changed');assert.equal(checked.data.milestones[0].date,'2026-11-26');
});
test('authentication, origin checks and owner isolation',async t=>{
  const f=await fixture(t),track=await f.track();assert.equal((await f.request('/api/tracks','GET',undefined,'wrong')).status,401);
  f.store.put('_system','session','other-session-hash',{owner:'other',expires:Date.now()+60000});assert.equal(f.store.get('other','track',track.id),null);
  const r=await fetch('http://127.0.0.1:'+f.server.address().port+'/api/config',{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
  assert.equal((await f.request('/api/inspect','POST',{url:'http://127.0.0.1/secrets'})).status,400);
});
test('SQLite persists records and secrets are encrypted',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deadline-diff-test-'));try{const file=join(dir,'test.sqlite');let s=new Store(file);s.put('alice','track','one',{date:'2026-11-28'});s.close();s=new Store(file);assert.equal(s.get('alice','track','one').date,'2026-11-28');assert.equal(s.get('bob','track','one'),null);s.close();const v=vault(dir),encrypted=v.seal({refresh_token:'fake-refresh'});assert.ok(!encrypted.includes('fake-refresh'));assert.equal(v.open(encrypted).refresh_token,'fake-refresh');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('public URL guard rejects private, reserved, mapped and non-HTTP destinations',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','172.31.0.1','::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(fetchPublicPage('file:///etc/passwd'),/HTTP/);await assert.rejects(fetchPublicPage('http://localhost/'),/private/);
});
test('Brevo adapter uses live API shape and stable idempotency header',async()=>{
 let payload;const e=createEmailAdapter({EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'fake',BREVO_SENDER_EMAIL:'sender@example.com'},async(url,options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');payload=JSON.parse(options.body);return Response.json({messageId:'mock-brevo-id'});});
 const r=await e.send({to:'verified@example.com',subject:'Changed',text:'Evidence',id:'one-change'});assert.equal(r.status,'accepted');assert.equal(payload.headers.IdempotencyKey,'one-change');assert.equal(payload.to[0].email,'verified@example.com');
});
test('unverified recipients cannot enable email',async t=>{
 const f=await fixture(t,{env:{HOST:'127.0.0.1',APP_URL:'http://localhost:4317',EMAIL_PROVIDER:'brevo'}});
 assert.equal((await f.request('/api/settings','PATCH',{emailEnabled:true})).status,400);
 assert.equal((await f.request('/api/email/test','POST',{})).status,400);
});
test('Google Calendar and Tasks payloads preserve date-only semantics and links',()=>{
 const m={id:'m1',kind:'registration_closes',label:'Registration closes',date:'2026-11-28',sourceUrl:'https://example.org/faq',quote:'Registration closes on 28 November 2026.'},t={id:'t1',url:'https://example.org',title:'Hackathon'};
 const c=calendarPayload(t,m,1440);assert.deepEqual(c.start,{date:'2026-11-28'});assert.deepEqual(c.end,{date:'2026-11-29'});assert.equal(c.reminders.overrides[0].minutes,1440);assert.match(c.description,/https:\/\/example.org/);
 assert.equal(taskPayload(t,m,'marker').due,'2026-11-28T00:00:00.000Z');
});
test('Google creates then updates existing Calendar event and Task; conflict pauses writes',async()=>{
 const s=new Store(':memory:');s.put('owner','profile','me',{google:plainVault.seal({access_token:'fake',expires_at:Date.now()+3600000})});let posts=0,patches=0;
 const g=new Google(s,plainVault,{},async(url,options)=>{if(options.method==='POST'){posts++;return Response.json({id:url.includes('calendar')?JSON.parse(options.body).id:'task-1'});}if(options.method==='PATCH'){patches++;return Response.json({id:'existing'});}return Response.json({value:'Asia/Kolkata'});});
 const m={id:'m',kind:'registration_closes',label:'Registration closes',date:'2026-11-28'},track={id:'t',title:'Test',url:'https://example.org'};
 for(const channel of ['calendar','task']){await g.perform('owner',track,m,channel);await g.perform('owner',track,{...m,date:'2026-11-26'},channel);}
 assert.equal(posts,2);assert.equal(patches,2);await assert.rejects(g.perform('owner',{...track,conflicts:[{kind:m.kind}]},m,'calendar'),/conflicting/);assert.equal(patches,2);s.close();
});
test('ambiguous Task network failure reconciles marker without another POST',async()=>{
 const s=new Store(':memory:');s.put('o','profile','me',{google:plainVault.seal({access_token:'fake',expires_at:Date.now()+3600000})});let posts=0,notes;
 const g=new Google(s,plainVault,{},async(url,o)=>{if(o.method==='POST'){posts++;notes=JSON.parse(o.body).notes;throw new Error('Network lost after create');}if(o.method==='PATCH')return Response.json({id:'recovered'});return Response.json({items:[{id:'recovered',notes}]});});
 const t={id:'t',title:'T',url:'https://example.org'},m={id:'m',kind:'event',label:'Event',date:'2026-11-28'};await assert.rejects(g.perform('o',t,m,'task'),/Network/);await g.perform('o',t,m,'task');assert.equal(posts,1);s.close();
});
test('live verification codes are not exposed by the outbox API',async t=>{
 let inbox;
 const f=await fixture(t,{email:{mode:'brevo',send:async d=>{inbox=d;return {status:'accepted'};}}});
 assert.equal((await f.request('/api/email/verify/request','POST',{email:'recipient@example.com'})).status,200);
 const code=inbox.text.match(/\d{6}/)[0];assert.ok(!JSON.stringify((await f.request('/api/deliveries')).data).includes(code));
 assert.equal((await f.request('/api/me')).data.emailVerified,false);
 assert.equal((await f.request('/api/email/verify/confirm','POST',{code})).status,200);assert.equal((await f.request('/api/me')).data.emailVerified,true);
});
test('demo verification never verifies a live recipient',async t=>{
 const f=await fixture(t);await f.request('/api/email/verify/request','POST',{email:'recipient@example.com'});
 const delivery=(await f.request('/api/deliveries')).data.find(d=>d.channel==='verification'),code=delivery.text.match(/\d{6}/)[0];
 await f.request('/api/email/verify/confirm','POST',{code});assert.equal((await f.request('/api/me')).data.emailVerified,false);
});
test('OAuth return page resolves every script, stylesheet and icon from the site root',async t=>{
 const f=await fixture(t),base='http://127.0.0.1:'+f.server.address().port;
 const page=await(await fetch(base+'/auth/done')).text();
 for(const m of page.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|svg))"/g)){
   const asset=new URL(m[1],base+'/auth/done');assert.ok(!asset.pathname.startsWith('/auth/'),asset.href);
   assert.equal((await fetch(asset)).status,200,asset.href);
 }
});
test('Devnovate adapter extracts evidence from public event data and retains uncertainty',async()=>{
 const raw=JSON.stringify({hackathon:{name:'wHACKiest',registrationDeadline:'2026-11-24',startDate:'01-12-2026'}});
 const page=await readRegistrationSource('https://devnovate.co/event/whackiest',async(url,_n,mode)=>{assert.equal(url,'https://devnovate.co/api/v1/events/name/whackiest');assert.equal(mode,'json');return {data:JSON.parse(raw),raw};});
 assert.equal(page.milestones[0].date,'2026-11-24');assert.equal(page.milestones[0].uncertain,false);assert.ok(raw.includes(page.milestones[0].quote));assert.equal(page.milestones[1].uncertain,true);
});
test('Builders Table timestamp registration deadline is not dropped',async()=>{
 const raw=JSON.stringify({hackathon:{name:'Builders Table',registrationDeadline:'2026-12-10T16:54',startDate:'12-12-2026'}});
 const p=await readRegistrationSource('https://devnovate.co/event/bengaluru-builders-table',async()=>({data:JSON.parse(raw),raw}));
 const deadline=p.milestones.find(m=>m.kind==='registration_closes');assert.equal(deadline.date,'2026-12-10');assert.equal(deadline.time,'16:54');assert.equal(deadline.zone,'Asia/Kolkata');assert.equal(deadline.uncertain,false);assert.equal(deadline.raw,'2026-12-10T16:54');
});
test('public URL preview works before Google sign-in; saved tracks remain private',async t=>{
 const f=await fixture(t,{env:{HOST:'127.0.0.1',APP_URL:'http://localhost:4317',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fake'}});
 const r=await f.request('/api/inspect','POST',{url:'http://localhost:4317/demo/registration'},null);
 assert.equal(r.status,200);assert.ok(r.data.milestones.length>0);
 assert.equal((await f.request('/api/tracks','GET',undefined,null)).status,401);
 assert.equal((await f.request('/api/inspect','POST',{url:'http://127.0.0.1/private'},null)).status,400);
});
test('Supabase PKCE flow validates browser state, verified user and single-use redemption',async t=>{
 const f=await fixture(t,{env:{HOST:'127.0.0.1',APP_URL:'http://localhost:4317',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fake-publishable'},oauthFetch:async(url,o)=>{
   if(url.includes('/token')){const b=JSON.parse(o.body);assert.equal(b.auth_code,'fake-authorization-code');assert.ok(b.code_verifier);return Response.json({access_token:'fake-supabase-token',provider_token:'fake-google-token',provider_refresh_token:'fake-refresh'});}
   return Response.json({id:'verified-user',email:'user@example.com',email_confirmed_at:'2026-11-22T00:00:00Z'});
 }});
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),local='http://127.0.0.1:'+f.server.address().port;
 let r=await f.request('/api/auth/prepare','POST',{redirect:'https://evil.example/',challenge});assert.equal(r.status,400);
 r=await f.request('/api/auth/prepare','POST',{redirect:'http://localhost:4317/auth/done',challenge});const flow=new URL(r.data.url).searchParams.get('flow');
 const start=await fetch(local+'/auth/start?flow='+flow,{redirect:'manual'}),cookie=start.headers.get('set-cookie').split(';')[0];assert.equal(start.status,302);assert.equal(new URL(start.headers.get('location')).searchParams.get('code_challenge_method'),'s256');
 assert.equal((await fetch(local+'/auth/callback?flow='+flow+'&code=fake-authorization-code',{redirect:'manual'})).status,400);
 const callback=await fetch(local+'/auth/callback?flow='+flow+'&code=fake-authorization-code',{redirect:'manual',headers:{Cookie:cookie}});assert.equal(callback.status,302);
 const code=new URLSearchParams(new URL(callback.headers.get('location')).hash.slice(1)).get('code');
 assert.equal((await f.request('/api/auth/redeem','POST',{code,verifier:'wrong'})).status,401);
 const redeemed=await f.request('/api/auth/redeem','POST',{code,verifier});assert.ok(redeemed.data.token);
 const profile=await f.request('/api/me','GET',undefined,redeemed.data.token);assert.equal(profile.data.email,'user@example.com');assert.equal(profile.data.googleConnected,true);assert.ok(!JSON.stringify(profile).includes('fake-google-token'));
 assert.equal((await f.request('/api/auth/redeem','POST',{code,verifier})).status,401);
});
test('model extraction rejects invented quotes and flags valid evidence for review',async()=>{
 const text='Final applications must arrive no later than 28 November 2026.';
 const fetcher=async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({milestones:[{kind:'registration_closes',date:'2026-11-28',quote:text},{kind:'payment',date:'2026-11-28',quote:'invented quote'}]})}]}}]});
 const result=await modelExtract(text,'https://example.org',{GEMINI_API_KEY:'fake'},fetcher);assert.equal(result.length,1);assert.equal(result[0].uncertain,true);assert.equal(result[0].quote,text);
});
test('transient email failures retry within the idempotency window; stale sends require review',async t=>{
 let calls=0;const f=await fixture(t,{email:{mode:'demo',send:async()=>{calls++;if(calls===1){const e=new Error('Temporary network issue');e.transient=true;throw e;}return {status:'demo'};}}}),track=await f.track();
 await f.request('/api/demo','POST',{mode:'changed'});await f.request(`/api/tracks/${track.id}/check`,'POST',{});
 let d=f.store.list('local-demo','delivery').find(d=>d.channel==='email');assert.equal(d.status,'retry');d.nextTry=0;f.store.put('local-demo','delivery',d.id,d);await f.engine.deliver('local-demo');assert.equal(calls,2);assert.equal(f.store.get('local-demo','delivery',d.id).status,'demo');
 d.status='sending';d.firstAttempt=Date.now()-16*60000;d.nextTry=0;f.store.put('local-demo','delivery',d.id,d);await f.engine.deliver('local-demo');assert.equal(calls,2);assert.equal(f.store.get('local-demo','delivery',d.id).status,'needs_review');
});

test('same-day events save without confirmation and repeated submission is idempotent',async t=>{
 const f=await fixture(t),url='https://example.com/schedule';
 const event=name=>({kind:'event',date:'2027-06-12',quote:name+' event date June 12, 2027',sourceUrl:url});
 const body={title:'Two sessions',url,milestones:[event('Workshop'),event('Showcase'),event('Workshop')]};
 const first=await f.request('/api/tracks','POST',body);
 assert.equal(first.status,201);assert.equal(first.data.milestones.length,2);
 const again=await f.request('/api/tracks','POST',body);
 assert.equal(again.data.id,first.data.id);assert.equal((await f.request('/api/tracks')).data.length,1);
});

test('transient DNS failure retries shortly and a successful retry clears it',async t=>{
 let failing=true;
 const f=await fixture(t,{readPage:async url=>{if(failing)throw new Error('getaddrinfo ENOTFOUND example.com');return {milestones:extract('Registration closes November 28, 2026',url)};}});
 const url='https://example.com/registration';
 const record=(await f.request('/api/tracks','POST',{url,milestones:extract('Registration closes November 28, 2026',url)})).data;
 const failed=(await f.request(`/api/tracks/${record.id}/check`,'POST',{})).data;
 assert.equal(failed.status,'check_failed');assert.ok(failed.nextCheck-Date.now()<=60000);
 failing=false;
 const recovered=(await f.request(`/api/tracks/${record.id}/check`,'POST',{})).data;
 assert.equal(recovered.status,'watching');assert.deepEqual(recovered.errors,[]);
});

test('workspace bootstrap returns one owner snapshot without exposing Google secrets or other owners',async t=>{
 const f=await fixture(t),track=await f.track();
 f.store.put('someone-else','track','private',{title:'Other owner private event'});
 const r=await f.request('/api/workspace');assert.equal(r.status,200);assert.equal(r.data.tracks.length,1);assert.equal(r.data.tracks[0].id,track.id);assert.deepEqual(r.data.changes,[]);assert.equal(r.data.me.local,true);assert.doesNotMatch(JSON.stringify(r.data),/Other owner private event/);
 assert.equal((await f.request('/api/workspace','GET',undefined,'wrong')).status,401);
});

test('preferred profile name persists per account and personalizes test and date-change emails',async t=>{
 const f=await fixture(t);const original=(await f.request('/api/me')).data;
 assert.equal((await f.request('/api/me','PATCH',{displayName:'  Aditi Scout  '})).status,200);
 const profile=(await f.request('/api/me')).data;assert.equal(profile.displayName,'Aditi Scout');assert.equal(profile.email,original.email);assert.equal(profile.emailEnabled,original.emailEnabled);
 assert.equal((await f.request('/api/workspace')).data.me.displayName,'Aditi Scout');
 await f.request('/api/email/test','POST',{});let deliveries=(await f.request('/api/deliveries')).data;assert.match(deliveries.find(d=>d.channel==='test').text,/^Hi Aditi Scout,/);
 const track=await f.track();await f.request('/api/demo','POST',{mode:'changed'});await f.request('/api/tracks/'+track.id+'/check','POST',{});
 deliveries=(await f.request('/api/deliveries')).data;assert.match(deliveries.find(d=>d.channel==='email').text,/^Hi Aditi Scout,/);
 assert.equal((await f.request('/api/me','PATCH',{displayName:'x'.repeat(81)})).status,400);assert.equal((await f.request('/api/me','PATCH',{displayName:'Name\nInjected'})).status,400);
 assert.equal((await f.request('/api/me','PATCH',{displayName:'No access'},'wrong')).status,401);
 const otherToken='other-profile-account';f.store.put('_system','session',createHash('sha256').update(otherToken).digest('hex'),{owner:'other-profile',expires:Date.now()+60000});
 await f.request('/api/me','PATCH',{displayName:'Other person'},otherToken);assert.equal((await f.request('/api/me')).data.displayName,'Aditi Scout');
 await f.request('/api/me','PATCH',{displayName:''});assert.equal((await f.request('/api/me')).data.displayName,'');
});
