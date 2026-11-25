import {api,settings,storage,isExtension} from './api.js';
import {scanActivePage} from './shared/page-scanner.js';
import {beginAlertConnection} from './shared/alert-connection.js';
import {copiedLinkReviewUrl} from './shared/copied-link.js';
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
$('#track-copied').onclick=e=>run(e.currentTarget,async()=>{
  // Request clipboard access only for this explicit action, never on popup open.
  if(isExtension&&!await chrome.permissions.request({permissions:['clipboardRead']}))throw new Error('Clipboard access was not granted. Open the dashboard to paste your link.');
  let copied;try{copied=await navigator.clipboard.readText();}catch{throw new Error('Could not read the clipboard. Copy a page link and try again, or paste it on the dashboard.');}
  const s=await settings();await openWebsite(copiedLinkReviewUrl(copied,s.backendUrl));
});
try{const [t]=await chrome.tabs.query({active:true,currentWindow:true});$('#page-title').textContent=t?.title||'Open a page with dates to scan.';}catch{}

$('#setup-alerts').onclick=e=>run(e.currentTarget,async()=>{if(!isExtension)throw new Error('Open the installed Deadline Scout extension to set up background alerts.');await openWebsite(await beginAlertConnection(chrome,storage,async()=>(await settings()).backendUrl));});
