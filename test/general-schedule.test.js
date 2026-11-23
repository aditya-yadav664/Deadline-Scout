import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,readHtml} from '../extension/shared/extract.js';
import {rendererAvailable,renderPublicPage} from '../server/render-page.js';
import {Store} from '../server/store.js';
import {Engine} from '../server/engine.js';
const url='https://schedule-test.example/event';
const schedule=`Event Date\nMonday, September 20, 2027\nIn 301 days\nEvent Time\n10:30 AM – 1:00 PM UTC\nDoors open at 10:00 AM UTC\nLast Time to Register\nSun, Sep 12, 2027 · 5:00 PM UTC\nCloses 294 days from today`;
test('generic schedule rows extract registration, event start/end and doors with explicit UTC',()=>{
 const result=extract(schedule,url);assert.equal(result.length,4);
 const by=Object.fromEntries(result.map(m=>[m.kind,m]));
 assert.equal(by.registration_closes.date,'2027-09-12');assert.equal(by.registration_closes.time,'17:00');assert.equal(by.registration_closes.zone,'UTC');
 assert.equal(by.event.time,'10:30');assert.equal(by.event.zone,'UTC');assert.equal(by.event_end.time,'13:00');assert.equal(by.doors_open.time,'10:00');assert.equal(by.doors_open.date,'2027-09-20');
});
test('table markup associates Last Time to Register with its adjacent date cell',()=>{
 const page=readHtml('<table><tr><th>Event Date</th><td>September 20, 2027</td></tr><tr><th>Last Time to Register</th><td>Sep 12, 2027 · 5:00 PM UTC</td></tr></table>',url);
 assert.equal(page.milestones.find(m=>m.kind==='registration_closes').time,'17:00');
});
test('fresh isolated browser reads detect a changed shared API schedule through the engine',async t=>{
 if(!await rendererAvailable()){t.skip('Install renderer and Edge/Chromium to run browser integration.');return;}
 let day='12';
 const html=`<!doctype html><title>Different Test Platform</title><main id="schedule">Loading shared event schedule...</main><script>fetch('/public-schedule').then(r=>r.json()).then(d=>document.getElementById('schedule').innerText=d.text)</script>`;
 const reader=async target=>{assert.equal(target,'https://schedule-test.example/public-schedule');return {body:JSON.stringify({text:schedule.replace('Sep 12,','Sep '+day+',')}),status:200,headers:{'content-type':'application/json'}};};
 const initial=await renderPublicPage(url,html,process.env,reader);assert.equal(initial.milestones.length,4);
 const store=new Store(':memory:');try{
  const track={id:'generic',title:'Different platform',url,sources:[url],milestones:initial.milestones.map((m,i)=>({...m,id:String(i),manual:false})),intervalMinutes:5};store.put('owner','track',track.id,track);
  day='11';const engine=new Engine({store,readPage:()=>renderPublicPage(url,html,process.env,reader),email:{mode:'demo',send:async()=>({status:'demo'})},google:{}});
  const changed=await engine.check('owner',track.id);assert.equal(changed.status,'changed');assert.equal(changed.milestones.find(m=>m.kind==='registration_closes').date,'2027-09-11');assert.equal(store.list('owner','change').length,1);assert.equal(store.list('owner','delivery').length,1);
  const repeat=await engine.check('owner',track.id);assert.equal(repeat.status,'watching');assert.equal(store.list('owner','change').length,1);
 }finally{store.close();}
});
test('browser renderer refuses private-network data requests instead of claiming an unchanged source',async t=>{
 if(!await rendererAvailable()){t.skip('Renderer unavailable.');return;}
 const html='<main>'+schedule.replace(/\n/g,'<br>')+'</main><script>fetch("http://127.0.0.1/private-data").catch(()=>{})</script>';
 await assert.rejects(renderPublicPage(url,html),/incomplete.*private/i);
});
