import {api,settings,storage,isExtension} from './api.js';
import {scanActivePage} from './shared/page-scanner.js';
let capture=null,blockedOrigin=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function run(button,fn){if(button.disabled)return;button.disabled=true;try{await fn();}catch(e){$('#status').textContent=e.message;if(e.code==='PAGE_ACCESS'&&e.origin){blockedOrigin=e.origin;$('#allow').hidden=false;}}finally{button.disabled=false;}}
async function openWebsite(url){if(isExtension)await chrome.tabs.create({url});else location.assign(url);}
async function dashboard(hash=''){const s=await settings();await openWebsite(s.backendUrl+'/'+hash);}
$('#scan').onclick=e=>run(e.currentTarget,async()=>{
  $('#status').textContent='Scanning the visible page…';$('#results').hidden=true;$('#allow').hidden=true;
  capture=await scanActivePage(chrome);$('#page-title').textContent=capture.title||new URL(capture.url).hostname;
  $('#result-count').textContent=`${capture.milestones.length} date${capture.milestones.length===1?'':'s'} found`;
  $('#dates').innerHTML=capture.milestones.slice(0,6).map(m=>`<div class="date"><span>${esc(m.label)}</span><strong>${esc(m.date)}<small>${esc(m.time?m.time+' '+m.zone:'Date only')}${m.uncertain?' · review':''}</small></strong></div>`).join('');
  $('#status').textContent=capture.milestones.length?'Scan complete. Review the evidence and choose what to monitor on the website.':'No reliable date found in the visible text. Continue to the website to add a date or another source.';
  $('#results').hidden=false;
});
$('#allow').onclick=e=>run(e.currentTarget,async()=>{
  if(!blockedOrigin)return;const granted=await chrome.permissions.request({origins:[blockedOrigin+'/*']});
  if(!granted)throw new Error('Access was not granted. You can still paste the public URL.');$('#allow').hidden=true;$('#scan').click();
});
$('#review').onclick=e=>run(e.currentTarget,async()=>{if(!capture)return;$('#status').textContent='Opening your date review…';const result=await api('/api/captures','POST',capture);await openWebsite(result.reviewUrl);});
$('#dashboard').onclick=e=>run(e.currentTarget,()=>dashboard());$('#dashboard-icon').onclick=e=>run(e.currentTarget,()=>dashboard());
$('#review-url').onclick=e=>run(e.currentTarget,async()=>{
  let value=$('#url').value.trim();if(!value)throw new Error('Paste a registration URL first.');if(!/^[a-z][a-z0-9+.-]*:/i.test(value))value='https://'+value;
  const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Use a public HTTP(S) registration URL.');await dashboard('#inspect='+encodeURIComponent(u.href));
});
$('#save-backend').onclick=e=>run(e.currentTarget,async()=>{
  const u=new URL($('#backend').value);if(u.pathname!=='/'||u.search||u.hash||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Use an HTTPS server origin, or localhost for development.');
  if(!await chrome.permissions.request({origins:[u.origin+'/*']}))throw new Error('Server access was not granted.');await storage.set('settings',{backendUrl:u.origin});await storage.set('token',null);$('#status').textContent='Server address saved.';
});
$('#connect').onclick=e=>run(e.currentTarget,async()=>{const r=await chrome.runtime.sendMessage({type:'connect-google'});if(!r?.ok)throw new Error(r?.error||'Sign-in did not complete.');if(await chrome.permissions.request({permissions:['notifications']}))$('#account').textContent='Browser alerts connected.';});
$('#backend').value=(await settings()).backendUrl;
try{const [t]=await chrome.tabs.query({active:true,currentWindow:true});$('#page-title').textContent=t?.title||'Open a registration page to scan.';}catch{}
if(await storage.get('token'))$('#account').textContent='Browser account connected. Notification permission is requested when you connect alerts.';
