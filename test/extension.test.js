import test from 'node:test';
import assert from 'node:assert/strict';
import {scanActivePage,milestonesFromCapture} from '../extension/shared/page-scanner.js';
import {saveCapture,consumeCapture} from '../server/captures.js';
import {Store} from '../server/store.js';
import {vault} from '../server/security.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const page={url:'https://example.org/registration',title:'Real page',text:'Registration closes 10 December 2026 at 16:54.\nEvent date: 12 December 2026.',links:[]};
test('popup scanner injects into the active tab and extracts rendered text without backend access',async()=>{
 let injected;
 const browser={tabs:{query:async q=>{assert.equal(q.active,true);return [{id:42,url:page.url}];}},scripting:{executeScript:async args=>{injected=args;return [{result:page}];}}};
 const capture=await scanActivePage(browser);assert.equal(injected.target.tabId,42);assert.equal(typeof injected.func,'function');assert.equal(capture.milestones[0].date,'2026-12-10');assert.equal(capture.milestones[0].zone,'Asia/Kolkata');assert.equal(capture.milestones.length,2);assert.equal(capture.text,undefined);
});
test('scanner handles restricted pages and actionable permission failures',async()=>{
 await assert.rejects(scanActivePage({tabs:{query:async()=>[{id:1,url:'edge://extensions'}]}}),/normal website/);
 await assert.rejects(scanActivePage({tabs:{query:async()=>[{id:1,url:page.url}]},scripting:{executeScript:async()=>{throw new Error('denied');}}}),e=>e.code==='PAGE_ACCESS'&&e.origin==='https://example.org');
});
test('selected deadline sentence takes priority over unrelated page dates',()=>{
 const capture=milestonesFromCapture({...page,selected:'Payment deadline: 11 December 2026.'});assert.equal(capture.length,1);assert.equal(capture[0].kind,'payment');
});
test('extension review handoff is encrypted, expires and can only be consumed once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'scout-capture-')),store=new Store(':memory:');try{
  const v=vault(dir),capture={...page,milestones:milestonesFromCapture(page)};
  const result=saveCapture(store,v,capture,'http://localhost:4317');const token=new URLSearchParams(new URL(result.reviewUrl).hash.slice(1)).get('capture');
  assert.ok(!JSON.stringify(store.list('_system','capture')).includes('Registration closes'));
  assert.equal(consumeCapture(store,v,token).milestones.length,2);assert.throws(()=>consumeCapture(store,v,token),/expired/);
  assert.throws(()=>saveCapture(store,v,{...capture,milestones:[{...capture.milestones[0],sourceUrl:'https://other.example/'}]},'http://localhost:4317'),/belong/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
