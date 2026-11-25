import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../server/cloud-store.js';
test('cloud store isolates owners, rolls back local transactions and persists parameterized changes',async()=>{
 const calls=[],client={query:async(...args)=>{calls.push(args);return {rows:[]};}};
 const store=await CloudStore.open(client);
 store.put('alice','track','one',{title:'Alpha'});store.put('bob','track','one',{title:'Beta'});
 assert.equal(store.get('alice','track','one').title,'Alpha');assert.equal(store.list('alice','track').length,1);
 const copy=store.get('alice','track','one');copy.title='changed';assert.equal(store.get('alice','track','one').title,'Alpha');
 assert.throws(()=>store.transaction(()=>{store.remove('alice','track','one');throw Error('rollback');}));assert.equal(store.get('alice','track','one').title,'Alpha');
 await store.flush();const writes=calls.filter(c=>c[0].startsWith('INSERT'));assert.equal(writes.length,2);assert.equal(writes[0][1][0],'alice');assert.ok(calls.some(c=>c[0].includes('ENABLE ROW LEVEL SECURITY')));
});

import {startCloud} from '../server/cloud.js';
import {once} from 'node:events';
const env={HOST:'0.0.0.0',PORT:'0',APP_URL:'https://scout.example',DATA_DIR:'/tmp/deadline-scout-test',DATABASE_URL:'test',SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'public-test',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};
test('cloud HTTP responses wait for commit and hide database failures',async t=>{
 let rejectCommit=false,committed=0;
 const client={query:async sql=>{if(sql==='COMMIT'){if(rejectCommit)throw Object.assign(Error('private database failure'),{code:'test_failure'});committed++;}return {rows:[]};},release(){}};
 const server=startCloud({env,pool:{connect:async()=>client}});await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 let response=await fetch(base+'/api/tracks');assert.equal(response.status,401);await response.json();assert.equal(committed,1);
 rejectCommit=true;response=await fetch(base+'/api/tracks');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private database/);
 rejectCommit=false;response=await fetch(base+'/api/cron');assert.equal(response.status,401);
});

test('cloud reads avoid write locks and schema changes during background monitoring',async()=>{
 const sql=[];await CloudStore.open({query:async text=>{sql.push(text);return {rows:[]};}},{readOnly:true,initialize:false});
 assert.ok(sql.includes('SET TRANSACTION READ ONLY'));assert.equal(sql.some(s=>/advisory|CREATE TABLE|ALTER TABLE/.test(s)),false);
});

test('public cloud assets and config work without opening a database connection; private APIs still require it',async t=>{
 let connections=0;const server=startCloud({env,pool:{connect:async()=>{connections++;throw Error('database offline');}}});await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/','/auth/done','/panel.css','/panel.js','/assets/inter.woff2','/assets/icons/calendar.svg','/api/config','/health']){const r=await fetch(base+path);assert.equal(r.status,200,path);await r.arrayBuffer();}
 assert.equal(connections,0);
 const css=await fetch(base+'/panel.css');const etag=css.headers.get('etag');await css.text();assert.ok(etag);const unchanged=await fetch(base+'/panel.css',{headers:{'If-None-Match':etag}});assert.equal(unchanged.status,304);
 const denied=await fetch(base+'/api/config',{headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);
 assert.equal((await fetch(base+'/api/workspace')).status,503);assert.equal(connections,1);
});

test('cloud account clear batches deletion, preserves other accounts, and rolls back cleanly',async()=>{
 const queries=[],client={query:async(...args)=>{queries.push(args);return {rows:[]};}};
 const rows=[{owner:'alice',kind:'track',id:'one',body:{id:'one'}},{owner:'bob',kind:'track',id:'two',body:{id:'two'}},{owner:'alice',kind:'profile',id:'me',body:{displayName:'Alice'}}];
 const store=new CloudStore(client,rows);assert.throws(()=>store.transaction(()=>{store.clearKinds('alice',['track']);throw Error('rollback');}));assert.equal(store.list('alice','track').length,1);assert.equal(store.bulkClears.size,0);
 store.clearKinds('alice',['track','change','delivery','googleLink']);await store.flush();assert.equal(store.list('bob','track').length,1);assert.equal(store.get('alice','profile','me').displayName,'Alice');assert.equal(queries.length,1);assert.equal(queries[0][1][0],'alice');assert.match(queries[0][0],/kind=ANY/);
});
