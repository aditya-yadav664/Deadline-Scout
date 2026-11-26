import {googleFormsSignup,isGoogleForms} from './shared/google-forms.js';
import {collectSignupPage} from './shared/signup-collection.js';
import {captureSignupForm,restoreSignupAnswers,formSignature} from './shared/signup.js';
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

async function paintSignupCollection(){const collection=await storage.get('signupCollection');const count=collection?.steps?.length||0;$('#signup-collection-status').textContent=count?count+' page(s) captured locally. Continue through the form, capture the next answer page, then Submit as draft.':'';for(const id of ['add-signup-page','submit-signup-draft','discard-signup-capture'])$('#'+id).hidden=!count;$('#prepare-signup').textContent=count?'Capture this page again':'Prepare signup';}
async function captureSignupPage(button){return run(button,async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!/^https?:\/\//i.test(tab?.url||''))throw Error('Open a normal form page first.');const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:isGoogleForms(tab.url)?googleFormsSignup:captureSignupForm,args:isGoogleForms(tab.url)?[{captureAnswers:true}]:[+$('#signup-form-choice').value||0,false,true]});if(result.result.formChoices?.length>1&&$('#signup-form-choice').hidden){$('#signup-form-choice').innerHTML=result.result.formChoices.map(f=>'<option value="'+f.index+'">'+esc(f.label)+'</option>').join('');$('#signup-form-choice').hidden=false;throw Error('Choose the intended form and capture again.');}await storage.set('signupCollection',collectSignupPage(await storage.get('signupCollection'),result.result));await paintSignupCollection();$('#status').textContent='Page captured. Stay on the form and capture the next page when ready.';});}
$('#prepare-signup').onclick=e=>captureSignupPage(e.currentTarget);$('#add-signup-page').onclick=e=>captureSignupPage(e.currentTarget);
$('#submit-signup-draft').onclick=e=>run(e.currentTarget,async()=>{const collection=await storage.get('signupCollection');if(!collection?.steps.length)throw Error('Capture an answer page first.');const capture=await api('/api/signup-captures','POST',{steps:collection.steps,extensionId:chrome.runtime.id});await openWebsite(capture.url);await storage.set('signupCollection',null);await paintSignupCollection();});
$('#discard-signup-capture').onclick=async()=>{await storage.set('signupCollection',null);await paintSignupCollection();};await paintSignupCollection();
const pendingSignup=await storage.get('signupResume');$('#restore-signup').hidden=!pendingSignup;if(pendingSignup?.autoSubmit)$('#restore-signup').textContent='Enable approved fill & submit on this site';$('#resume-step').hidden=!pendingSignup;if(pendingSignup)$('#resume-step').innerHTML='<option value="">Detect current step automatically</option>'+pendingSignup.draft.steps.map((s,i)=>'<option value="'+i+'">Captured step '+(i+1)+': '+esc(s.title)+'</option>').join('');
$('#restore-signup').onclick=e=>run(e.currentTarget,async()=>{if(!pendingSignup)throw Error('Open Fill form now on the website first.');const origin=new URL(pendingSignup.draft.formUrl).origin;if(!await chrome.permissions.request({origins:[origin+'/*']}))throw Error('Site access is needed to fill your saved answers.');const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const selected=$('#resume-step').value;const response=await chrome.runtime.sendMessage({type:'signup-fill-now',tabId:tab.id,stepIndex:selected===''?undefined:+selected});if(!response?.ok)throw Error(response?.error||'Could not fill this step.');$('#status').textContent=(response.report||['Autofill enabled for this session.']).join('\n');});
