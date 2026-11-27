import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { startCloud } from '../server/cloud.js';
import { CloudStore } from '../server/cloud-store.js';
import { hash, vault } from '../server/security.js';

const postgresModule = process.env.SCOUT_TEST_POSTGRES_MODULE;
test('scoped cloud APIs execute against Postgres and transfer only the records they use', {skip:!postgresModule}, async t=>{
  const { PGlite }=await import(pathToFileURL(postgresModule).href);
  const db=new PGlite();
  const queries=[];
  const client={query:async(sql,params)=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]}; // The fixture uses one connection.
    const result=await db.query(sql,params);
    queries.push({sql,params,rows:result.rows});
    return result;
  },release(){}};
  const env={PORT:'0',APP_URL:'https://scout.example',DATA_DIR:process.env.TEMP||'/tmp',DATABASE_URL:'test',
    SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'test-key',
    TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),CRON_SECRET:'fixture-cron'};
  const secrets=vault(env.DATA_DIR,env.TOKEN_ENCRYPTION_KEY);
  const seed=await CloudStore.open(client);
  const now=Date.now(),source=env.APP_URL+'/demo/registration';
  const milestone={id:'m',date:'2099-12-01',kind:'registration_closes',label:'Registration closes',sourceUrl:source,quote:'Registration closes in December.'};
  const track={id:'one',title:'Alice event',url:source,sources:[source],milestones:[milestone],nextCheck:now+60000,intervalMinutes:60,status:'watching'};
  seed.put('alice','track','one',track);
  seed.put('bob','track','two',{...track,id:'two',title:'Bob event'});
  seed.put('alice','profile','me',{email:'alice@example.test',emailVerified:true});
  seed.put('_system','session',hash('alice-session'),{owner:'alice',expires:now+100000});
  const pdf=Buffer.from('%PDF-1.7 demo');
  const file={id:'pdf',name:'Proposal.pdf',type:'application/pdf',version:'pdf',sha256:hash(pdf),size:pdf.length,expires:now+86400000};
  seed.put('alice','signupFile','pdf',{...file,sealed:secrets.seal({data:pdf.toString('base64')})});
  seed.put('alice','signupFile','unused',{...file,id:'unused',sealed:'a'.repeat(500000)});
  seed.put('bob','signupFile','other',{...file,id:'other',sealed:'b'.repeat(500000)});
  const legacy={id:'legacy',trackId:'one',status:'Draft'};
  seed.put('alice','signup',legacy.id,{...legacy,sealed:secrets.seal({title:'Legacy draft',formUrl:source,reviewedAll:true,
    steps:[{title:'Form',url:source,fields:[{key:'pdf',type:'file'}],files:{pdf:[file]}}]})});
  const modern={id:'modern',trackId:'one',status:'Confirmed'};
  seed.put('alice','signup',modern.id,{...modern,sealed:'c'.repeat(500000),
    summary:secrets.seal({...modern,mode:'browser-auto',receipt:'fixture',title:'Confirmed draft',formUrl:source,steps:[]})});
  const observation={status:'observed',evidence:[milestone]};
  seed.put('alice','sourceHistory','one',{sources:[{url:source,history:[observation,{...observation,evidence:[{...milestone,quote:'x'.repeat(300000)}]}]}]});
  for(let i=0;i<25;i++){
    const id='history-'+String(i).padStart(2,'0'),at=new Date(now-100000+i*1000).toISOString();
    seed.put('alice','change',id,{id,trackId:'one',at,title:track.title,label:milestone.label,before:{...milestone,date:'2099-11-30'},after:milestone});
    seed.put('alice','delivery','mail-'+id,{id:'mail-'+id,at,channel:'email',status:'failed',subject:'Date change',html:'z'.repeat(5000)});
  }
  seed.put('alice','change','orphan',{id:'orphan',trackId:'gone',at:new Date(now).toISOString()});
  seed.put('alice','delivery','browser-alert',{id:'browser-alert',at:new Date(now).toISOString(),channel:'browser',status:'queued',trackId:'one',changeId:'history-24'});
  await seed.flush();
  await db.query('COMMIT');
  const table=await db.query('SELECT owner,kind,id,body FROM public.deadline_scout_records');
  const oldBytes=Buffer.byteLength(JSON.stringify(table.rows));
  const server=startCloud({env,pool:{connect:async()=>client}});
  await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,options={}){
    queries.length=0;
    const response=await fetch(base+path,{method:options.method||'GET',headers:{
      Authorization:options.auth||'Bearer alice-session','Content-Type':'application/json'
    },body:options.body?JSON.stringify(options.body):undefined});
    const data=await response.json();
    return {status:response.status,data};
  }

  const workspace=await request('/api/workspace?compact=1');
  assert.equal(workspace.status,200);
  assert.deepEqual(workspace.data.tracks.map(item=>item.id),['one']);
  assert.equal(workspace.data.tracks[0].signupDrafts.length,2);
  assert.equal(workspace.data.changes.length,12);
  assert.ok(queries.every(q=>q.rows.every(row=>row.owner!=='bob'&&row.kind!=='signupFile')));
  assert.ok(queries.every(q=>!JSON.stringify(q.rows).includes('x'.repeat(100))));
  const newBytes=queries.reduce((bytes,q)=>bytes+Buffer.byteLength(JSON.stringify(q.rows)),0);
  assert.ok(newBytes<oldBytes/5);
  t.diagnostic('Seeded workspace database read: '+oldBytes+' bytes before scoping, '+newBytes+' bytes after scoping (JSON approximation).');

  const prepared=await request('/api/auth/prepare',{method:'POST',body:{redirect:env.APP_URL+'/auth/done',challenge:'a'.repeat(43)}});
  assert.equal(prepared.status,200);
  const authStart=new URL(prepared.data.url);
  const redirect=await fetch(base+authStart.pathname+authStart.search,{redirect:'manual'});
  assert.equal(redirect.status,302);
  assert.equal(new URL(redirect.headers.get('location')).origin,env.SUPABASE_URL);
  assert.ok(queries.some(query=>query.params?.includes('oauth')));
  assert.equal(queries.some(query=>query.rows.some(row=>row.kind==='signupFile')),false);

  const timeline=[];
  for(let next='',i=0;i<4;i++){
    const page=await request('/api/changes?limit=7'+(next?'&after='+next:''));
    assert.equal(page.status,200);
    timeline.push(...page.data.entries.map(item=>item.id));
    next=page.data.next;
  }
  assert.equal(timeline.length,25);
  assert.equal(new Set(timeline).size,25);
  const email=await request('/api/deliveries?limit=3');
  assert.equal(email.data.entries.length,3);
  assert.ok(email.data.next);
  assert.equal(queries.some(q=>q.rows.some(row=>row.body?.html)),false);
  assert.equal((await request('/api/signup-confirmations')).data[0].receipt,'fixture');
  assert.equal((await request('/api/signups/legacy/files/other')).status,404);
  assert.equal(queries.some(q=>q.params?.includes('signupFile')),false);
  const attached=await request('/api/signups/legacy/files/pdf');
  assert.equal(attached.data.data,pdf.toString('base64'));
  assert.deepEqual(queries.flatMap(q=>q.rows.filter(row=>row.kind==='signupFile').map(row=>row.id)),['pdf']);
  assert.equal((await request('/api/alerts')).data[0].change.id,'history-24');
  assert.equal((await request('/api/alerts/ack',{method:'POST',body:{id:'browser-alert'}})).status,200);
  assert.deepEqual((await request('/api/alerts')).data,[]);
  assert.equal((await request('/api/cron',{auth:'Bearer fixture-cron'})).status,200);
  assert.ok(queries.every(q=>q.rows.every(row=>row.kind!=='track'&&row.kind!=='signupFile')));
  await db.query("UPDATE public.deadline_scout_records SET body=jsonb_set(body,'{nextCheck}','0') WHERE owner='alice' AND kind='track'");
  assert.equal((await request('/api/cron',{auth:'Bearer fixture-cron'})).status,200);
  assert.ok(queries.some(q=>q.rows.some(row=>row.kind==='track'&&row.owner==='alice')));
  assert.equal(queries.some(q=>q.rows.some(row=>row.kind==='track'&&row.owner==='bob')),false);
  const checked=await db.query("SELECT body FROM public.deadline_scout_records WHERE owner='alice' AND kind='track'");
  assert.ok(checked.rows[0].body.lastAttempt);
  assert.ok(checked.rows[0].body.nextCheck>now);
  assert.equal((await request('/api/account/clear-data',{method:'POST',body:{action:'clear-account-data'}})).status,200);
  assert.equal((await request('/api/workspace?compact=1')).data.tracks.length,0);
  assert.ok((await db.query("SELECT id FROM public.deadline_scout_records WHERE owner='bob' AND kind='signupFile'")).rows.length);
});
