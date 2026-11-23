import {api,storage,settings,isExtension,connectGoogle} from './api.js';
import {extract,labels} from './shared/extract.js';
import {compare} from './shared/compare.js';
import {pretty,validateMilestone,instant,scheduleKey,DEFAULT_TIMEZONE} from './shared/dates.js';
import {selectMilestone} from './shared/milestone-selection.js';
const $=s=>document.querySelector(s);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}};
let tracks=[],localTracks=[],changes=[],me={},config={},connected=false,draft=null,view='watchlist',toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
function trackingStatus(message,signIn=false){$('#tracking-status').hidden=!message;$('#tracking-status-text').textContent=message;$('#tracking-signin').hidden=!signIn;}
async function run(button,fn){if(button?.disabled)return;try{if(button)button.disabled=true;await fn();}catch(e){toast(e.message);}finally{if(button)button.disabled=false;}}
function formatDate(date){if(!date)return 'No date';try{return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}catch{return date;}}
function relative(value){if(!value)return 'Not checked yet';const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return minutes===0?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hr ago`:new Date(value).toLocaleDateString();}
function showView(name){view=name;for(const v of ['watchlist','timeline','settings'])$('#'+v+'-view').hidden=v!==name;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}
async function refresh(){
  localTracks=await storage.get('localTracks')||[];
  try{
    config=await api('/api/config');connected=true;
    if(!await storage.get('token')&&config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);}
    if(await storage.get('token')){
      try{[tracks,changes,me]=await Promise.all([api('/api/tracks'),api('/api/changes'),api('/api/me')]);}
      catch(e){if(e.status===401){await storage.set('token',null);tracks=[];me={};if(config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);return refresh();}}else throw e;}
    }else{tracks=[];me={};}
    await storage.set('cachedTracks',tracks);
  }catch(e){connected=false;tracks=(await storage.get('cachedTracks')||[]).map(t=>({...t,cached:true}));}
  changes=[...new Map([...changes,...await storage.get('localChanges')||[]].map(c=>[c.id,c])).values()].sort((a,b)=>b.at.localeCompare(a.at));render();
}
const statusLabels={watching:['Watching',''],changed:['Date updated','warn'],conflict:['Sources disagree','warn'],needs_review:['Review date','warn'],check_failed:['Check failed','warn'],date_missing:['Date missing','warn'],manual:['Manual reminder','neutral']};
function render(){
  const all=[...tracks,...localTracks.map(t=>({...t,local:true}))];
  $('#connection-label').textContent=connected?(config.auth==='local'?'Local backend · monitoring ready':me.email?'Connected · '+me.email:'Sign in to start monitoring'):'Backend offline · local mode';
  $('#track-count').textContent=all.length;$('#change-count').textContent=changes.length;
  const reviews=all.filter(t=>['conflict','needs_review','check_failed','date_missing'].includes(t.status)).length;$('#review-count').textContent=reviews?`${reviews} need${reviews===1?'s':''} attention`:all.length?'All in view':'';
  $('#tracks').innerHTML=all.length?all.map(renderTrack).join(''):'<div class="empty"><div class="empty-symbol">◷</div><h3>A clear view starts here.</h3><p>Open a registration page or paste its link above. We’ll help you find the dates worth watching.</p></div>';
  $('#timeline').innerHTML=changes.length?changes.map(c=>`<article class="event"><time>${esc(new Date(c.at).toLocaleString())}</time><h3>${esc(c.title)}</h3><p>${esc(c.label)}</p><div class="diff-box"><div><small>Before</small><strong>${esc(formatDate(c.before.date))}</strong><span class="date-meta">${esc(c.before.time?c.before.time+' '+c.before.zone:'Date only')}</span></div><div><small>After</small><strong>${esc(formatDate(c.after.date))}</strong><span class="date-meta">${esc(c.after.time?c.after.time+' '+c.after.zone:'Date only')}</span></div></div><p class="impact">${esc(c.impact)}</p><blockquote class="evidence">${esc(c.after.quote)}</blockquote><a href="${safeLink(c.after.sourceUrl)}" target="_blank" rel="noreferrer">View source</a></article>`).join(''):'<div class="empty"><div class="empty-symbol">≋</div><h3>No changes. No noise.</h3><p>When a tracked date changes, you’ll see the before, after, and evidence here.</p></div>';
  renderSettings();
  if(connected&&config.auth==='supabase'&&!me.email)trackingStatus('Preview a public registration URL now. Sign in to save private backend tracking and enable live integrations.',true);
}
function renderTrack(t){
  const [status,tone]=statusLabels[t.status]||['Watching',''];
  let domain='Registration';try{domain=new URL(t.url).hostname;}catch{}
  const conflicts=[...(t.conflicts||[]),...(t.uncertain||[])];
  return `<article class="card" data-track="${esc(t.id)}"><div class="card-heading"><h3 class="card-title">${esc(t.title)}</h3><span class="badge ${tone}">${esc(status)}</span></div><div class="domain">${esc(domain)}${t.local?' · local, manual recheck':''}${t.cached?' · cached while backend offline':''}</div>${t.milestones.map(m=>`<div class="milestone"><div><span class="milestone-label">${esc(m.label)}</span>${m.manual?'<span class="date-meta">Manual reminder · not monitored</span>':''}</div><div class="milestone-date">${esc(formatDate(m.date))}<span class="date-meta">${esc(m.time?m.time+' '+m.zone:'Date only')}</span></div></div>`).join('')}${t.plan?`<div class="plan">Your plan: register on <strong>${esc(formatDate(t.plan))}</strong></div>`:''}${(t.errors||[]).map(e=>`<p class="error-list">${esc(e.message)}<br>Last confirmed dates kept.</p>`).join('')}${t.missing?.length?'<p class="error-list">A tracked date is missing from the sources. Last confirmed date kept.</p>':''}${conflicts.map(c=>`<div class="review"><h4>${esc(labels[c.kind])}: review the sources</h4>${c.candidates.map((m,i)=>`<p><strong>${esc(pretty(m))}</strong></p><blockquote class="evidence">${esc(m.quote)}</blockquote><a class="muted" href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><br><button class="text-button" data-action="resolve" data-kind="${esc(c.kind)}" data-index="${i}">Review this interpretation</button>`).join('')}</div>`).join('')}${t.googleError?`<p class="error-list">${esc(t.googleError)}</p>`:''}<div class="card-actions"><button class="button primary" data-action="check">Check now</button><button class="button secondary" data-action="calendar">${needsUpdate(t,'calendar')?'Update Calendar event':'Add to Calendar'}</button><button class="button secondary" data-action="task">${needsUpdate(t,'task')?'Update Google Task':'Create Google Task'}</button></div>${t.local&&connected?'<button class="text-button" data-action="sync">Sync to backend</button>':''}<div class="card-foot"><span>${t.lastSuccessfulCheck?'Checked '+esc(relative(t.lastSuccessfulCheck)):'Not checked yet'}${!t.local?' · every '+t.intervalMinutes+' min':''}</span><button class="text-button" data-action="manage">Manage</button></div></article>`;
}
function needsUpdate(t,channel){return t.googleLinks?.some(l=>l.channel===channel&&t.milestones.some(m=>m.id===l.milestoneId&&scheduleKey(m)!==scheduleKey(l)));}
async function renderSettings(){
  $('#google-status').textContent=me.googleConnected?'Connected':'Not connected';$('#disconnect-google').hidden=!me.googleConnected;
  $('#connect-google').textContent=me.googleConnected?'Reconnect Google':'Connect Google';
  $('#google-help').textContent=me.googleError||(!config.googleConfigured?'Configure Supabase’s Google provider and server environment variables. Setup steps are in the README.':'Calendar events and Tasks are separate actions. Google access tokens stay on your backend.');
  $('#extension-id').textContent=isExtension?'Extension ID: '+chrome.runtime.id:'Web companion · install the extension for active-tab tracking and browser alerts.';
  $('#email-mode').textContent=config.email==='brevo'?'Live · Brevo':'Demo · no emails sent';
  $('#email-alerts').checked=!!me.emailEnabled;$('#recipient-status').textContent=me.email?`${me.email} · ${config.email==='demo'&&me.local?'local demo recipient':me.emailVerified?'verified':'not verified'}`:'Verify an address to enable.';
  $('#email-address').placeholder=me.email||'you@example.com';
  $('#backend-url').value=(await settings()).backendUrl;
  $('#model-status').textContent=config.model?'Optional Gemini fallback enabled. Model extractions require review.':'Rule-based extraction · optional Gemini fallback not configured.';
  $('#demo-controls').hidden=connected&&!['localhost','127.0.0.1'].includes(new URL(config.base).hostname);
  const s=await settings();$('#demo-link').href=s.backendUrl+'/demo/registration';
  if(isExtension)$('#browser-alerts').checked=await chrome.permissions.contains({permissions:['notifications']});else{$('#browser-alerts').disabled=true;$('#browser-alerts').title='Install the extension to receive browser alerts.';}
}
async function inspect(url,captured){
  url=url.trim();if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))url='https://'+url;
  if(!/^https?:\/\//i.test(url))throw new Error('Use a public HTTP(S) page. Browser settings and local files cannot be tracked.');
  trackingStatus('Reading the registration page…');
  let page,monitoring=true;
  if(connected){try{page=await api('/api/inspect','POST',{url});}catch(e){if(!captured)throw e;page=captured;monitoring=false;toast(e.message+' Captured dates can be saved as manual reminders.');}}
  else if(captured){page=captured;monitoring=false;}
  else{
    if(!isExtension)throw new Error('Start the backend to inspect URLs.');
    const granted=await chrome.permissions.request({origins:[new URL(url).origin+'/*']});if(!granted)throw new Error('Page access was not granted.');
    const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Page could not be read. Try selecting a sentence or entering a date.');
    const html=new DOMParser().parseFromString(await response.text(),'text/html');html.querySelectorAll('script,style,template,noscript').forEach(n=>n.remove());
    page={title:html.title,text:html.body.textContent,url,links:[],milestones:extract(html.body.textContent,url)};monitoring=false;
  }
  if(captured?.selected){const selected=extract(captured.selected,url);if(selected.length)page={...page,milestones:selected,text:captured.selected};}
  if(page.readability==='requires_browser'){
    monitoring=false;
    if(captured?.milestones?.length)page={...captured,notice:'Dates captured from the visible page. This site requires JavaScript, so these are manual reminders; the backend cannot automatically recheck its rendered schedule.'};
  }
  trackingStatus(page.notice||(!me.email&&config.auth==='supabase'?'Preview ready. Sign in for backend monitoring, or save this registration locally.':''),!me.email&&config.auth==='supabase');
  draft={url,title:page.title,links:page.links||[],sources:[url],milestones:(page.milestones||extract(page.text,url)).map(m=>({...m,detected:{time:m.time??null,zone:m.zone??null},manual:!monitoring&&connected,confirmed:false})),monitoring};
  if(!draft.milestones.length){const message=page.notice||'No reliable deadline found. Enter a date manually, or select its sentence using the browser extension.';trackingStatus(message,!me.email&&config.auth==='supabase');draft.milestones=[manualMilestone(url)];}
  draft.catalog=structuredClone(draft.milestones);
  renderDraft();
}
function renderEvidenceChoices(m){
  const choices=(draft.catalog||[]).map((candidate,index)=>({candidate,index})).filter(x=>x.candidate.kind===m.kind);
  if(choices.length<2)return '';
  return `<label>Source date<select data-field="evidence"><option value="">Choose a source date</option>${choices.map(({candidate:c,index})=>`<option value="${index}" ${c.date===m.date&&c.quote===m.quote?'selected':''}>${esc(c.date)} · ${esc(c.quote)}</option>`).join('')}</select></label>`;
}
function manualMilestone(url){return {kind:'registration_closes',label:labels.registration_closes,date:'',time:null,zone:null,quote:'',sourceUrl:url,manual:true,reasons:['Manual reminder: source is not checked automatically.'],confirmed:false};}
function renderDraft(){
  const box=$('#draft');box.hidden=false;
  box.innerHTML=`<section class="draft"><div class="card-heading"><h2>Choose what to track</h2><button id="cancel-draft" class="text-button">Cancel</button></div><p class="draft-intro">Confirm the dates and their source before saving.${!draft.monitoring?' Backend monitoring is unavailable. Local entries can be rechecked manually while your browser is open; manual reminders are never rechecked.':''}</p><label for="draft-title">Registration name</label><input id="draft-title" value="${esc(draft.title)}">${draft.milestones.map((m,i)=>`<div class="candidate" data-candidate="${i}"><label class="candidate-heading"><input type="checkbox" data-field="selected" ${m.selected===false?'':'checked'}> Track this milestone</label><label>Milestone<select data-field="kind">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${m.kind===k?'selected':''}>${v}</option>`).join('')}</select></label>${renderEvidenceChoices(m)}<blockquote>${esc(m.quote||'Enter a source sentence below.')}</blockquote><label>Source sentence<input data-field="quote" value="${esc(m.quote)}"></label><a class="muted" href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><div class="date-grid"><label>Date<input data-field="date" type="date" value="${esc(m.date)}"></label><label>Time (optional)<input data-field="time" type="time" value="${esc(m.time||'')}"></label><label class="zone-field">Timezone (default: IST / UTC+05:30)<input data-field="zone" value="${esc(m.zone||'')}" placeholder="Asia/Kolkata or UTC+05:30"></label></div>${m.reasons?.length?`<p class="hint">${esc(m.reasons.join(' '))}</p>`:''}<label class="candidate-heading"><input type="checkbox" data-field="manual" ${m.manual?'checked':''}> Manual reminder only</label><label class="candidate-heading"><input type="checkbox" data-field="confirmed" ${m.confirmed?'checked':''}> I confirm this date and interpretation</label></div>`).join('')}<button id="add-manual" class="text-button">Add another milestone</button>${draft.links.length?`<div class="review"><h4>Suggested supporting sources</h4><p>Only pages you approve will be checked.</p>${draft.links.filter(l=>!draft.sources.includes(l.url)).map(l=>`<button class="text-button" data-add-source="${esc(l.url)}">Add ${esc(l.label||new URL(l.url).pathname)}</button><br>`).join('')}</div>`:''}<p class="muted">${draft.sources.length} approved source${draft.sources.length===1?'':'s'}</p><label for="planned-date">I plan to register on (optional)</label><input id="planned-date" type="date" value="${esc(draft.plan||'')}"><button id="save-draft" class="button primary full">Save registration</button></section>`;
  $('#cancel-draft').onclick=async()=>{draft=null;box.hidden=true;await storage.set('pendingReview',null);};
  $('#add-manual').onclick=()=>{readDraft();draft.milestones.push(manualMilestone(draft.url));renderDraft();};
  box.querySelectorAll('[data-add-source]').forEach(button=>button.onclick=()=>run(button,async()=>{
    readDraft();if(!connected)throw new Error('Start the backend to add a monitored supporting source.');const page=await api('/api/inspect','POST',{url:button.dataset.addSource});draft.sources.push(button.dataset.addSource);const added=page.milestones.map(m=>({...m,detected:{time:m.time??null,zone:m.zone??null},confirmed:false}));draft.milestones.push(...added);draft.catalog.push(...structuredClone(added));renderDraft();toast('Supporting source added. Select one date per milestone type.');
  }));
  $('#save-draft').onclick=e=>run(e.currentTarget,saveDraft);
  box.querySelectorAll('[data-candidate]').forEach(node=>{
    const i=+node.dataset.candidate;
    node.querySelector('[data-field="time"]').onchange=event=>{
      const zone=node.querySelector('[data-field="zone"]');if(event.target.value&&!zone.value.trim())zone.value=DEFAULT_TIMEZONE;
    };
    node.querySelector('[data-field="kind"]').onchange=event=>{
      const oldKind=draft.milestones[i].kind,newKind=event.target.value;readDraft();
      const current=draft.milestones[i];current.variants||={};current.variants[oldKind]={...current,kind:oldKind,variants:undefined};
      const cached=current.variants[newKind];
      draft.milestones[i]=cached?{...cached,variants:current.variants,selected:current.selected,confirmed:false}:selectMilestone(current,newKind,draft.catalog||[]);
      draft.milestones[i].label=labels[newKind];renderDraft();
    };
    const evidence=node.querySelector('[data-field="evidence"]');if(evidence)evidence.onchange=event=>{
      const choice=event.target.value;readDraft();if(choice==='')return;
      draft.milestones[i]={...draft.milestones[i],...structuredClone(draft.catalog[+choice]),confirmed:false};renderDraft();
    };
  });
  box.querySelector('h2').textContent=`${draft.milestones.length} milestone${draft.milestones.length===1?'':'s'} found — review and save`;
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
function readDraft(){
  draft.title=$('#draft-title').value;draft.plan=$('#planned-date').value;
  $('#draft').querySelectorAll('[data-candidate]').forEach(node=>{const m=draft.milestones[+node.dataset.candidate];for(const field of ['selected','kind','quote','date','time','zone','manual','confirmed']){const input=node.querySelector(`[data-field="${field}"]`);m[field]=input.type==='checkbox'?input.checked:input.value;}m.label=labels[m.kind];});
}
async function saveDraft(){
  readDraft();const selected=draft.milestones.filter(m=>m.selected!==false);if(!selected.length)throw new Error('Select at least one milestone.');
  if(new Set(selected.map(m=>m.kind)).size!==selected.length)throw new Error('Choose one date per milestone type. Uncheck duplicate candidates.');
  for(const m of selected){validateMilestone(m);if(m.time)instant(m);if(!m.confirmed)throw new Error('Confirm each selected date interpretation before saving.');}
  const payload={...draft,milestones:selected.map(m=>({...m,uncertain:false,reasons:[]}))};
  if(connected&&await storage.get('token')){await api('/api/tracks','POST',payload);toast('Registration saved. Your backend will watch the approved sources.');}
  else{localTracks.push({...payload,id:crypto.randomUUID(),milestones:payload.milestones.map(m=>({...m,id:crypto.randomUUID()})),status:selected.every(m=>m.manual)?'manual':'watching',local:true,intervalMinutes:60,errors:[]});await storage.set('localTracks',localTracks);toast('Saved locally. Recheck manually while your browser is open, or sync to the backend later.');}
  await storage.set('pendingReview',null);draft=null;$('#draft').hidden=true;await refresh();
  showView('watchlist');$('#watchlist-view').scrollIntoView({behavior:'smooth',block:'start'});
}
async function activePage(){
  if(!isExtension)throw new Error('Load the browser extension to read your active tab, or paste a URL here.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  let result;try{[result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({title:document.title,url:location.href,text:document.body.innerText.slice(0,250000),selected:window.getSelection()?.toString()||'',links:[...document.querySelectorAll('a[href]')].filter(a=>a.origin===location.origin&&/faq|rules|updates|schedule/i.test(a.textContent+' '+a.pathname)).slice(0,12).map(a=>({url:a.href,label:a.innerText}))})});}catch{throw new Error('Page access is unavailable. Click the extension toolbar icon on the registration page, then try again.');}
  const p=result.result;await inspect(p.url,{...p,milestones:extract(p.text,p.url)});
}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#action-dialog').showModal();}
function closeDialog(){$('#action-dialog').close();}
async function googleDialog(t,channel){
  if(t.local||!connected)throw new Error('Sync this registration to a running backend first.');
  if(!me.googleConnected){showView('settings');throw new Error('Connect Google in Settings, then try again.');}
  const isCalendar=channel==='calendar';
  dialog(isCalendar?'Google Calendar':'Google Tasks',`<p>${isCalendar?'Create or update a deadline event. Date-only deadlines become all-day events.':'Create or update a dated task. Google Tasks does not support a specific reminder time through this API.'}</p><label for="google-milestone">Milestone</label><select id="google-milestone">${t.milestones.map(m=>`<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.date)}</option>`).join('')}</select>${isCalendar?'<label for="reminder-minutes">Remind me</label><select id="reminder-minutes"><option value="1440">1 day before</option><option value="60">1 hour before</option><option value="10080">1 week before</option><option value="0">At the deadline</option></select><button id="preview-reminder" class="text-button">Preview reminder time</button><p id="reminder-preview" class="hint">Preview the reminder before approving.</p>':'<p class="hint">A dated task has a date only. Use Calendar for a reminder at a specific time.</p>'}<p>The original registration link is included. Existing linked entries will be updated without creating another entry.</p><button id="approve-google" class="button primary full" ${isCalendar?'disabled':''}>Approve ${isCalendar?'Calendar event':'Google Task'}</button>`);
  const preview=async button=>run(button,async()=>{const data=await api(`/api/tracks/${t.id}/preview`,'POST',{milestoneId:$('#google-milestone').value,minutes:+$('#reminder-minutes').value});$('#reminder-preview').textContent=`${new Date(data.at).toLocaleString(undefined,{timeZone:data.zone})} (${data.zone}). ${data.explanation}`;$('#approve-google').disabled=false;});
  if(isCalendar){$('#preview-reminder').onclick=e=>preview(e.currentTarget);$('#reminder-minutes').onchange=()=>$('#approve-google').disabled=true;$('#google-milestone').onchange=()=>$('#approve-google').disabled=true;}
  $('#approve-google').onclick=e=>run(e.currentTarget,async()=>{await api(`/api/tracks/${t.id}/google`,'POST',{milestoneId:$('#google-milestone').value,channel,minutes:isCalendar?+$('#reminder-minutes').value:1440,approved:true});closeDialog();toast('Google entry saved.');await refresh();});
}
function manageDialog(t){
  dialog('Manage registration',`<label for="manage-plan">Planned signup date</label><input id="manage-plan" type="date" value="${esc(t.plan||'')}"><label for="manage-interval">Background check interval</label><select id="manage-interval"><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440">Every day</option></select><label class="toggle-line"><span><strong>Automatically update Google entries</strong><small>Explicit opt-in. Paused when sources conflict or need review.</small></span><input id="manage-auto" type="checkbox" ${t.autoGoogle?'checked':''}></label><label for="manage-source">Add a same-site FAQ, rules or updates source</label><input id="manage-source" type="url" placeholder="https://example.com/faq"><p class="muted">Approved sources:<br>${t.sources.map(s=>`<a href="${safeLink(s)}" target="_blank" rel="noreferrer">${esc(s)}</a>`).join('<br>')}</p><button id="save-management" class="button primary full">Save preferences</button><div class="dialog-action"><button id="delete-track" class="text-button">Remove this registration</button><p class="muted">Linked Calendar events and Tasks remain in your Google account.</p></div>`);
  $('#manage-interval').value=String(t.intervalMinutes||60);
  if(t.milestones.some(m=>m.manual)&&!t.local){
    const button=document.createElement('button');button.className='button secondary full';button.textContent='Verify source & enable automatic monitoring';
    $('#dialog-body').append(button);button.onclick=()=>run(button,async()=>{await api(`/api/tracks/${t.id}/monitor`,'POST',{approved:true});closeDialog();await refresh();toast('Source verified. Monitoring enabled and first recheck completed.');});
  }
  $('#save-management').onclick=e=>run(e.currentTarget,async()=>{
    const changes={plan:$('#manage-plan').value,intervalMinutes:+$('#manage-interval').value,autoGoogle:$('#manage-auto').checked,...($('#manage-source').value?{addSource:$('#manage-source').value}:{})};
    if(t.local){Object.assign(t,changes);await storage.set('localTracks',localTracks);}else await api('/api/tracks/'+t.id,'PATCH',changes);
    closeDialog();await refresh();toast('Preferences saved.');
  });
  $('#delete-track').onclick=e=>run(e.currentTarget,async()=>{if(t.local){localTracks=localTracks.filter(l=>l.id!==t.id);await storage.set('localTracks',localTracks);}else await api('/api/tracks/'+t.id,'DELETE');closeDialog();await refresh();});
}
async function localCheck(t,button){
  if(!isExtension)throw new Error('Local checks are available in the browser extension.');
  const observations=[];
  for(const url of t.sources){if(!await chrome.permissions.request({origins:[new URL(url).origin+'/*']}))throw new Error('Page access was not granted.');const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Failed fetch. Last confirmed date kept.');const doc=new DOMParser().parseFromString(await r.text(),'text/html');doc.querySelectorAll('script,style,noscript').forEach(n=>n.remove());observations.push({milestones:extract(doc.body.textContent,url)});}
  const result=compare(t,observations);const history=await storage.get('localChanges')||[];history.push(...result.changes.map(c=>({...c,id:crypto.randomUUID(),trackId:t.id,title:t.title,at:new Date().toISOString()})));await storage.set('localChanges',history);Object.assign(t,result,{lastSuccessfulCheck:new Date().toISOString(),status:result.conflicts.length?'conflict':result.uncertain.length?'needs_review':result.changes.length?'changed':'watching'});delete t.changes;await storage.set('localTracks',localTracks);toast(result.changes.length?'Local deadline change detected. Sync to enable durable alerts.':'Local check complete.');
}
function resolveDialog(t,kind,index){
  const conflict=[...(t.conflicts||[]),...(t.uncertain||[])].find(c=>c.kind===kind),m=conflict.candidates[index],old=t.milestones.find(m=>m.kind===kind);
  dialog('Review source interpretation',`<p>${esc(m.quote)}</p><a href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><p class="hint">${esc((m.reasons||[]).join(' ')||'Sources disagree. Approve this candidate only after reviewing the evidence.')}</p><label>Date<input id="resolve-date" type="date" value="${esc(m.date)}"></label><label>Time (optional)<input id="resolve-time" type="time" value="${esc(m.time||'')}"></label><label>Timezone<input id="resolve-zone" value="${esc(m.zone||'')}"></label><button id="approve-resolution" class="button primary full">Approve this interpretation</button>`);
  $('#approve-resolution').onclick=e=>run(e.currentTarget,async()=>{
    if(t.local)throw new Error('Sync this registration to the backend before resolving source conflicts.');
    await api(`/api/tracks/${t.id}/resolve`,'POST',{milestoneId:old.id,date:$('#resolve-date').value,sourceDate:m.date,time:$('#resolve-time').value,zone:$('#resolve-zone').value,sourceUrl:m.sourceUrl,approved:true});closeDialog();await refresh();
  });
}
async function renderOutbox(){const items=await api('/api/deliveries');$('#outbox').innerHTML=items.filter(d=>d.channel!=='browser').reverse().slice(0,30).map(d=>`<div class="outbox-item"><strong>${esc(d.subject||'Email alert')}</strong><p>${esc(d.to)} · ${esc(d.status)}</p><p>${esc(d.label||d.error||'Queued')}</p>${d.status==='demo'?`<pre>${esc(d.text)}</pre>`:''}</div>`).join('')||'<p class="muted">No email activity yet.</p>';}
$('#tracks').onclick=e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const id=button.closest('[data-track]').dataset.track,t=tracks.find(t=>t.id===id)||localTracks.find(t=>t.id===id);
  run(button,async()=>{
    switch(button.dataset.action){
      case 'check':if(t.local)await localCheck(t,button);else{const result=await api(`/api/tracks/${id}/check`,'POST',{});toast(result.status==='changed'?'A deadline changed. See the timeline.':result.status==='conflict'?'Sources disagree. Review the evidence.':result.status==='check_failed'?'Check failed. Your confirmed dates are kept.':result.status==='manual'?'This is a manual reminder. Use Manage to verify the source and enable automatic monitoring.':result.status==='date_missing'?'A tracked milestone is missing from the source. Your confirmed date is kept.':result.status==='needs_review'?'A source date needs your review. Open the registration card.':'Check complete.');if(isExtension)chrome.runtime.sendMessage({type:'surface-alerts'}).catch(()=>{});}await refresh();break;
      case 'calendar':case 'task':await googleDialog(t,button.dataset.action);break;
      case 'manage':manageDialog(t);break;
      case 'resolve':resolveDialog(t,button.dataset.kind,+button.dataset.index);break;
      case 'sync':await api('/api/tracks','POST',{...t,milestones:t.milestones.map(m=>({...m,confirmed:true}))});localTracks=localTracks.filter(l=>l.id!==id);await storage.set('localTracks',localTracks);await refresh();toast('Synced to the persistent backend.');break;
    }
  });
};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{showView(button.dataset.view);if(view==='settings'&&connected)renderOutbox().catch(()=>{});});
$('#settings-shortcut').onclick=()=>{showView('settings');if(connected)renderOutbox().catch(()=>{});};
async function signIn(){if(draft){readDraft();await storage.set('pendingReview',draft);}await connectGoogle();await refresh();}
$('#tracking-signin').onclick=e=>run(e.currentTarget,signIn);
async function inspectPastedLink(){
  const url=$('#source-url').value.trim();
  if(!url){trackingStatus('Paste a registration URL in the box, then choose Find dates.');$('#source-url').focus();return;}
  try{await inspect(url);}catch(error){trackingStatus(error.message,error.status===401);throw error;}
}
function updateCaptureAction(){
  $('#track-active').textContent=isExtension&&!$('#source-url').value.trim()?'Track this page':'Find dates from link';
}
$('#track-active').onclick=e=>run(e.currentTarget,()=>$('#source-url').value.trim()||!isExtension?inspectPastedLink():activePage());
$('#inspect-url').onclick=e=>run(e.currentTarget,inspectPastedLink);
$('#source-url').oninput=updateCaptureAction;
$('#source-url').placeholder='Paste a public registration URL';
$('#inspect-url').textContent='Find';
$('#inspect-url').style.fontSize='.8rem';
updateCaptureAction();
$('#source-url').onkeydown=e=>{if(e.key==='Enter')$('#inspect-url').click();};
$('#manual-start').onclick=()=>{const url=$('#source-url').value.trim();if(!/^https?:\/\//i.test(url)){toast('Paste the original registration URL first, then enter its date manually.');$('#source-url').focus();return;}draft={url,title:'My registration',sources:[url],links:[],milestones:[manualMilestone(url)],monitoring:false};renderDraft();};
$('#close-dialog').onclick=closeDialog;
$('#connect-google').onclick=e=>run(e.currentTarget,async()=>{await signIn();toast('Google connected.');});
$('#disconnect-google').onclick=e=>run(e.currentTarget,async()=>{await api('/api/google/disconnect','POST',{});await refresh();});
$('#browser-alerts').onchange=e=>run(null,async()=>{if(e.target.checked){const ok=await chrome.permissions.request({permissions:['notifications']});e.target.checked=ok;if(ok)chrome.runtime.sendMessage({type:'surface-alerts'});}else await chrome.permissions.remove({permissions:['notifications']});});
$('#email-alerts').onchange=e=>run(null,async()=>{try{await api('/api/settings','PATCH',{emailEnabled:e.target.checked});await refresh();}catch(error){e.target.checked=!e.target.checked;throw error;}});
$('#request-code').onclick=e=>run(e.currentTarget,async()=>{const r=await api('/api/email/verify/request','POST',{email:$('#email-address').value.trim()});toast(r.mode==='brevo'?'Verification code sent.':'Demo verification only: inspect the code in Email activity. Live email remains unverified.');await renderOutbox();});
$('#confirm-code').onclick=e=>run(e.currentTarget,async()=>{const r=await api('/api/email/verify/confirm','POST',{code:$('#email-code').value});toast(r.demo?'Demo code confirmed. Use Brevo or Google sign-in to verify a real recipient.':'Email verified. Alerts enabled.');await refresh();});
$('#test-email').onclick=e=>run(e.currentTarget,async()=>{const d=await api('/api/email/test','POST',{});toast(d.label);await renderOutbox();});
$('#save-backend').onclick=e=>run(e.currentTarget,async()=>{
  const u=new URL($('#backend-url').value);if(!['https:','http:'].includes(u.protocol)||u.pathname!=='/'||u.username||u.password)throw new Error('Enter a backend origin, such as https://api.example.com.');
  if(u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('Hosted backends require HTTPS.');
  if(isExtension&&!await chrome.permissions.request({origins:[u.origin+'/*']}))throw new Error('Backend access was not granted.');
  await storage.set('settings',{backendUrl:u.origin});await storage.set('token',null);await refresh();toast('Backend connection saved.');
});
$('#apply-demo').onclick=e=>run(e.currentTarget,async()=>{await api('/api/demo','POST',{mode:$('#demo-mode').value});toast('Fictional source updated. Use Check now on your demo registration.');});
$('#refresh-outbox').onclick=e=>run(e.currentTarget,renderOutbox);
$('#sign-out').onclick=e=>run(e.currentTarget,async()=>{await api('/api/logout','POST',{});await storage.set('token',null);tracks=[];me={};await storage.set('cachedTracks',[]);render();toast('Signed out.');});
async function openCapturedReview(token){
  const captured=await api('/api/captures/'+encodeURIComponent(token));
  history.replaceState(null,'',location.pathname);
  let serverPage=null;try{serverPage=await api('/api/inspect','POST',{url:captured.url});}catch{/* Captured evidence remains useful as a manual reminder. */}
  const fromBrowser=captured.milestones.map(m=>{
    const match=serverPage?.milestones.find(s=>s.kind===m.kind&&scheduleKey(s)===scheduleKey(m));
    return {...m,...(match||{}),manual:!match,confirmed:false,detected:{time:m.time,zone:m.zone}};
  });
  const all=[...fromBrowser,...(serverPage?.milestones||[]).filter(s=>!fromBrowser.some(m=>m.kind===s.kind&&scheduleKey(m)===scheduleKey(s)))];
  draft={url:captured.url,title:captured.title,sources:[captured.url],links:captured.links||[],monitoring:!!serverPage?.milestones.length,milestones:all.length?all:[manualMilestone(captured.url)]};
  draft.catalog=structuredClone(draft.milestones);renderDraft();
  trackingStatus('Page scan received from the extension. Backend-readable dates can be monitored; browser-only dates are labelled manual reminders.');
}
if(location.pathname!=='/auth/done'){
  await refresh();
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('capture'))await run(null,()=>openCapturedReview(fragment.get('capture')));
  else if(fragment.has('inspect')){const url=fragment.get('inspect');history.replaceState(null,'',location.pathname);$('#source-url').value=url;await run(null,()=>inspect(url));}
  else {const pending=await storage.get('pendingReview');if(pending){draft=pending;renderDraft();}if(['#settings','#timeline'].includes(location.hash))showView(location.hash.slice(1));}
}
let refreshing=false;
setInterval(async()=>{
  if(refreshing||document.visibilityState!=='visible'||draft||$('#action-dialog').open||view==='settings')return;
  refreshing=true;try{await refresh();}finally{refreshing=false;}
},15000);
