import {deliverBrowserAlerts,enableExtensionAlerts} from './shared/browser-alerts.js';
import {api,storage,settings,isExtension,connectGoogle} from './api.js';
import {extract,labels} from './shared/extract.js';
import {compare} from './shared/compare.js';
import {pretty,validateMilestone,instant,scheduleKey,DEFAULT_TIMEZONE} from './shared/dates.js';
import {selectMilestone,dedupeMilestones,milestoneKey,mergeCapturedMilestones,nearestUpcomingTrack} from './shared/milestone-selection.js';
const $=s=>document.querySelector(s);
const icon=name=>'<img class="ui-icon" src="/assets/icons/'+name+'.svg" alt="">';
const openTracks=new Set();
const googleNamesRequested=new Set();
let profileNameDirty=false,profileNameEditing=false,workspaceEpoch=0,outboxVisible=3,outboxOwner=null,outboxItems=[],webAlertsBusy=false;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
$('#today-label').textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date())+' · IST';
function nextMilestone(t){const dates=[...t.milestones].sort((a,b)=>a.date.localeCompare(b.date));return dates.find(m=>m.date>=today)||dates.at(-1);}
function dateTile(m){const d=new Date(m.date+'T12:00:00Z');return '<time class="date-tile" datetime="'+esc(m.date)+'"><span>'+new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'}).format(d)+'</span><strong>'+d.getUTCDate()+'</strong><small>'+d.getUTCFullYear()+'</small></time>';}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}};
let dashboardPrefs={groups:[],pinnedIds:[],seenChangeIds:[]},noticesShown=new Set();
let tracks=[],localTracks=[],changes=[],me={},config={},connected=false,draft=null,view='watchlist',toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
function trackingStatus(message,signIn=false){$('#scan-feedback').hidden=!/reading|scanning/i.test(message||'');$('#tracking-status').hidden=!message;$('#tracking-status-text').textContent=message;$('#tracking-signin').hidden=!signIn;}
async function run(button,fn){if(button?.disabled)return;try{if(button)button.disabled=true;await fn();}catch(e){toast(e.message);}finally{if(button)button.disabled=false;}}
function formatDate(date){if(!date)return 'No date';try{return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}catch{return date;}}
function compactDate(date){return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
function displayZone(zone){return ['Asia/Kolkata','Asia/Calcutta'].includes(zone)?'IST':zone;}
function relative(value){if(!value)return 'Not checked yet';const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return minutes===0?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hr ago`:new Date(value).toLocaleDateString();}
function showView(name){if(name==='settings'){openProfileSettings();return;}view=name;for(const v of ['watchlist','timeline'])$('#'+v+'-view').hidden=v!==name;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));}
async function refresh(){
  const epoch=workspaceEpoch;
  localTracks=await storage.get('localTracks')||[];
  try{
    config=await api('/api/config');connected=true;
    if(!await storage.get('token')&&config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);}
    if(await storage.get('token')){
      try{const workspace=await api('/api/workspace');if(epoch!==workspaceEpoch)return;({tracks,changes,me}=workspace);dashboardPrefs=workspace.dashboard||{groups:[],pinnedIds:[],seenChangeIds:[]};}
      catch(e){if(e.status===401){await storage.set('token',null);tracks=[];me={};if(config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);return refresh();}}else throw e;}
    }else{tracks=[];me={};}
    await storage.set('cachedTracks',tracks);
  }catch(e){connected=false;tracks=(await storage.get('cachedTracks')||[]).map(t=>({...t,cached:true}));}
  if(!me.email)dashboardPrefs=await storage.get('dashboard-local')||{groups:[],pinnedIds:[],seenChangeIds:[]};
  const activeTrackIds=new Set([...tracks,...localTracks].map(t=>t.id));
  changes=[...new Map([...changes,...await storage.get('localChanges')||[]].filter(c=>activeTrackIds.has(c.trackId)).map(c=>[c.id,c])).values()].sort((a,b)=>b.at.localeCompare(a.at));render();
}
const statusLabels={watching:['Watching',''],changed:['Date updated','warn'],conflict:['Sources disagree','warn'],needs_review:['Review date','warn'],check_failed:['Check failed','warn'],date_missing:['Date missing','warn'],manual:['Manual reminder','neutral']};
function render(){
  $('#tracks').setAttribute('aria-busy','false');
  const all=[...tracks,...localTracks.map(t=>({...t,local:true}))];
  $('#profile-email').textContent=me.email||'Not signed in';$('#profile-status').textContent=me.email?(me.googleConnected?'Google Calendar & Tasks connected':'Google account signed in'):'Sign in to connect your Google account.';$('#profile-avatar').innerHTML=me.email?esc((me.displayName||me.email)[0].toUpperCase()):icon('user');$('#profile-signin').hidden=!!me.email;$('#profile-switch').hidden=!me.email;$('#sign-out').hidden=!me.email;
  if(!me.email){profileNameDirty=false;profileNameEditing=false;}
  $('#profile-identity').hidden=!me.email;$('#profile-display-name').textContent=me.displayName||'Your profile';$('#edit-profile-name').hidden=profileNameEditing;$('#profile-name-form').hidden=!me.email||!profileNameEditing;if(!profileNameEditing&&!profileNameDirty)$('#profile-name').value=me.displayName||'';
  if(outboxOwner!==me.email){outboxOwner=me.email;outboxVisible=3;outboxItems=[];paintOutbox();}
  $('#track-count').textContent=all.length;$('#change-count').textContent=all.reduce((count,t)=>count+t.milestones.length,0);
  const reviews=all.filter(t=>['conflict','needs_review','check_failed','date_missing'].includes(t.status)).length;$('#review-count').textContent=reviews?`${reviews} need${reviews===1?'s':''} attention`:'';
  const ordered=[...all].filter(t=>t.title.toLowerCase().includes($('#find-event').value.trim().toLowerCase())).sort((a,b)=>{const ad=a.milestones.find(m=>m.kind==='event')?.date||nextMilestone(a).date,bd=b.milestones.find(m=>m.kind==='event')?.date||nextMilestone(b).date;return (ad<today)-(bd<today)||ad.localeCompare(bd);});
  const nextTrack=nearestUpcomingTrack(all,today);
  const featured=ordered.filter(t=>(dashboardPrefs.pinnedIds||[]).includes(t.id)||t.id===nextTrack?.id);
  $('#featured-track').innerHTML=featured.length?'<p class="eyebrow">'+(featured.some(t=>(dashboardPrefs.pinnedIds||[]).includes(t.id))?'PINNED & UP NEXT':'UP NEXT')+'</p>'+featured.map(t=>renderTrack(t,true)).join(''):'';$('#featured-track').hidden=!featured.length;
  $('#new-group').hidden=$('#watchlist-layout').value!=='groups';
  $('#tracks').innerHTML=$('#watchlist-layout').value==='groups'?renderGroups(ordered):ordered.map(t=>renderTrack(t)).join('')||'<div class="empty"><h3>'+ (all.length?'No matching saved names':'Your watchlist is empty')+'</h3><p>'+(all.length?'Try a different name.':'Paste a public page URL above to find dates.')+'</p></div>';
  $('#tracks').querySelectorAll('[data-group-edit]').forEach(b=>b.onclick=()=>groupDialog(b.dataset.groupEdit));
  void showChangeMessages();
  const history=changes.length?changes.map(c=>`<article class="event"><time>${esc(new Date(c.at).toLocaleString())}</time><h3>${esc(c.title)}</h3><p>${esc(c.label)}</p><div class="diff-box"><div><small>Before</small><strong>${esc(formatDate(c.before.date))}</strong><span class="date-meta">${esc(c.before.time?c.before.time+' '+c.before.zone:'Date only')}</span></div><div><small>After</small><strong>${esc(formatDate(c.after.date))}</strong><span class="date-meta">${esc(c.after.time?c.after.time+' '+c.after.zone:'Date only')}</span></div></div><p class="impact">${esc(c.impact)}</p><blockquote class="evidence">${esc(c.after.quote)}</blockquote><a href="${safeLink(c.after.sourceUrl)}" target="_blank" rel="noreferrer">View source</a></article>`).join(''):'<div class="empty"><div class="empty-symbol">'+icon('list-details')+'</div><h3>No changes. No noise.</h3><p>When a tracked date changes, you’ll see the before, after, and evidence here.</p></div>';
  const milestones=all.flatMap(t=>t.milestones.map(m=>({track:t,m}))).sort((a,b)=>a.m.date.localeCompare(b.m.date)||(a.m.time||'').localeCompare(b.m.time||'')||a.track.title.localeCompare(b.track.title));
  function scheduleRows(rows){return rows.map(({track:t,m})=>`<article class="event schedule-event"><time datetime="${esc(m.date)}">${esc(formatDate(m.date))}${m.time?' · '+esc(m.time)+' '+esc(displayZone(m.zone||DEFAULT_TIMEZONE)):' · Date only'}</time><h3>${esc(t.title)}</h3><p>${esc(m.label)}</p>${m.manual?'<p class="muted">Manual reminder · not monitored</p>':''}<a href="${safeLink(t.url)}" target="_blank" rel="noreferrer">Open event page</a></article>`).join('');}
  const upcoming=milestones.filter(({m})=>m.date>=today),past=milestones.filter(({m})=>m.date<today);
  $('#timeline').innerHTML=milestones.length?
    '<section aria-labelledby="schedule-heading"><h3 id="schedule-heading" class="timeline-heading">Upcoming milestones</h3>'+(upcoming.length?scheduleRows(upcoming):'<p class="muted">No upcoming milestones. Your earlier dates are below.</p>')+'</section>'+
    (past.length?'<details class="past-milestones"><summary>Past milestones ('+past.length+')</summary>'+scheduleRows(past)+'</details>':'')+
    '<section aria-labelledby="history-heading"><h3 id="history-heading" class="timeline-heading">Date-change history</h3>'+history+'</section>':
    '<div class="empty"><div class="empty-symbol">'+icon('list-details')+'</div><h3>Your schedule starts here.</h3><p>Track a page to see all its milestones here, even before any dates change.</p></div>';

  renderSettings();
  if(connected&&config.auth==='supabase'&&!me.email)trackingStatus('Preview a public page URL now. Sign in to save private backend tracking and enable live integrations.',true);
}
function renderTrack(t,featured=false){
 const [status,tone]=statusLabels[t.status]||['Watching',''];let domain='Registration';try{domain=new URL(t.url).hostname;}catch{}
 const conflicts=[...(t.conflicts||[]),...(t.uncertain||[])];const next=nextMilestone(t),expanded=openTracks.has(t.id),recent=changes.find(c=>c.trackId===t.id);
 const summary=t.milestones.slice(0,2).map(m=>`<div><span>${icon(m.kind==='event'?'arrow-right':'calendar')}${esc(m.label)}</span><time datetime="${esc(m.date)}">${esc(compactDate(m.date))}${m.time?' · '+esc(m.time)+' '+esc(displayZone(m.zone)):''}</time></div>`).join('');
 return `<article class="card track-row ${featured?'featured-track':''} ${expanded?'is-open':''}" data-track="${esc(t.id)}"><div class="track-overview">${dateTile(next)}<div class="track-identity"><h3 class="card-title">${esc(t.title)}</h3><a class="domain" href="${safeLink(t.url)}" target="_blank" rel="noreferrer">${icon('external-link')}${esc(domain)}</a><span class="badge ${tone}">${esc(status)}</span>${recent?`<div class="change-chip">${icon('refresh')}${esc(compactDate(recent.before.date))} <span>→</span> ${esc(compactDate(recent.after.date))}</div>`:''}</div><div class="schedule-preview">${summary}</div><div class="row-actions"><button class="button secondary pin-action" data-action="pin" aria-pressed="${(dashboardPrefs.pinnedIds||[]).includes(t.id)}" title="${(dashboardPrefs.pinnedIds||[]).includes(t.id)?'Unpin':'Pin'}">${(dashboardPrefs.pinnedIds||[]).includes(t.id)?'Unpin':'Pin'}</button><button class="button secondary" data-action="prepare-signup">Prepare a Signup</button><button class="button secondary check-action" data-action="check">${icon('refresh')}<span>Check now</span></button><button class="button secondary icon-action" data-action="calendar" aria-label="${needsUpdate(t,'calendar')?'Update Calendar event':'Add to Calendar'}" title="${needsUpdate(t,'calendar')?'Update Calendar event':'Add to Calendar'}">${icon('calendar')}</button><button class="button secondary icon-action" data-action="task" aria-label="${needsUpdate(t,'task')?'Update Google Task':'Create Google Task'}" title="${needsUpdate(t,'task')?'Update Google Task':'Create Google Task'}">${icon('check')}</button><button class="expand-action" data-action="expand" aria-label="${expanded?'Collapse':'Expand'} milestones for ${esc(t.title)}" aria-expanded="${expanded}" aria-controls="milestones-${esc(t.id)}">${icon('chevron-down')}</button></div></div><div class="track-details" id="milestones-${esc(t.id)}" ${expanded?'':'hidden'}>${t.signupDrafts?.length?`<div class="signup-card-links"><h4>Signup drafts</h4>${t.signupDrafts.map(d=>`<p><a href="/backup.html#draft=${esc(d.id)}">${esc(d.title)}</a> · ${esc(d.status)}<br><a href="${safeLink(d.formUrl)}" target="_blank" rel="noreferrer">Registration page ↗</a></p>`).join('')}</div>`:''}<h4>Milestones</h4>${t.milestones.map(m=>`<div class="milestone"><div><span class="milestone-label">${esc(m.label)}</span>${m.manual?'<span class="date-meta">Manual reminder · not monitored</span>':''}</div><div class="milestone-date">${esc(formatDate(m.date))}<span class="date-meta">${esc(m.time?m.time+' '+displayZone(m.zone):'Date only')}</span></div></div>`).join('')}${t.local&&connected?'<button class="text-button" data-action="sync">Sync to backend</button>':''}</div><div class="track-notices">${t.plan?`<div class="plan">Your plan: act on <strong>${esc(formatDate(t.plan))}</strong></div>`:''}${(t.errors||[]).map(e=>`<p class="error-list">${esc(e.message)}<br>Last confirmed dates kept.</p>`).join('')}${t.missing?.length?'<p class="error-list">A tracked date is missing from the sources. Last confirmed date kept.</p>':''}${conflicts.map(c=>`<div class="review"><h4>${esc(c.label||labels[c.kind])}: review the sources</h4>${c.candidates.map((m,i)=>`<p><strong>${esc(pretty(m))}</strong></p><blockquote class="evidence">${esc(m.quote)}</blockquote><a class="muted" href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><br><button class="text-button" data-action="resolve" data-kind="${esc(c.kind)}" data-milestone="${esc(c.milestoneId||'')}" data-index="${i}">Review this interpretation</button>`).join('')}</div>`).join('')}${t.googleError?`<p class="error-list">${esc(t.googleError)}</p>`:''}</div><div class="card-foot"><span>${t.lastSuccessfulCheck?'Checked '+esc(relative(t.lastSuccessfulCheck)):'Not checked yet'}${t.local?' · saved locally':' · every '+t.intervalMinutes+' min'}</span><button class="text-button" data-action="manage">Manage</button></div></article>`;
}
function needsUpdate(t,channel){return t.googleLinks?.some(l=>l.channel===channel&&t.milestones.some(m=>m.id===l.milestoneId&&scheduleKey(m)!==scheduleKey(l)));}
async function renderSettings(){
  $('#google-status').textContent=me.googleConnected?'Connected':'Not connected';$('#disconnect-google').hidden=!me.googleConnected;
  $('#connect-google').textContent=me.googleConnected?'Reconnect Google':'Connect Google';
  $('#google-help').textContent=me.googleError||(!config.googleConfigured?'Configure Supabase’s Google provider and server environment variables. Setup steps are in the README.':'Calendar events and Tasks are separate actions. Google access tokens stay on your backend.');
  $('#extension-id').textContent=isExtension?'Extension ID: '+chrome.runtime.id:'Web companion · install the extension for active-tab tracking and browser alerts.';
  $('#email-mode').textContent=config.email==='brevo'?'Live · Brevo':'Demo · no emails sent';
  $('#email-alerts').checked=!!me.emailEnabled;$('#recipient-status').textContent=me.email?`${me.email}${config.email==='demo'&&me.local?' · local demo recipient':''}`:'Sign in with Google to receive email alerts.';
  $('#backend-url').value=(await settings()).backendUrl;
  $('#model-status').textContent=config.model?'Optional Gemini fallback enabled. Model extractions require review.':'Rule-based extraction · optional Gemini fallback not configured.';
  $('#demo-controls').hidden=connected&&!['localhost','127.0.0.1'].includes(new URL(config.base).hostname);
  const s=await settings();$('#demo-link').href=s.backendUrl+'/demo/registration';$('.demo-hint').hidden=connected&&!['localhost','127.0.0.1'].includes(new URL(config.base).hostname);
  const supported=isExtension||'Notification' in window;$('#browser-alerts').disabled=!supported;
  $('#browser-alerts').checked=isExtension?!!me.email&&await chrome.permissions.contains({permissions:['notifications']})&&await chrome.notifications.getPermissionLevel()==='granted':supported&&Notification.permission==='granted'&&!!await storage.get('webAlerts:'+me.email);
  $('#browser-alerts-help').textContent=isExtension?'Background alerts while Edge is running. Sign in here and allow notifications.':'Alerts while this website is open. In the extension, choose Set up background alerts to receive them without this page.';
  $('#test-browser-alert').disabled=!$('#browser-alerts').checked;

}
async function inspect(url,captured){
  url=url.trim();if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))url='https://'+url;
  if(!/^https?:\/\//i.test(url))throw new Error('Use a public HTTP(S) page. Browser settings and local files cannot be tracked.');
  trackingStatus('Reading the page with dates…');
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
  trackingStatus(page.notice||(!me.email&&config.auth==='supabase'?'Preview ready. Sign in for backend monitoring, or save this page locally.':''),!me.email&&config.auth==='supabase');
  draft={url,title:page.title,links:page.links||[],sources:[url],milestones:dedupeMilestones(page.milestones||extract(page.text,url)).map(m=>({...m,sourceLabel:m.sourceLabel||m.label,detected:{time:m.time??null,zone:m.zone??null},manual:!monitoring&&connected,confirmed:false})),monitoring};
  if(!draft.milestones.length){const message=page.notice||'No reliable deadline found. Enter a date manually, or select its sentence using the browser extension.';trackingStatus(message,!me.email&&config.auth==='supabase');draft.milestones=[manualMilestone(url)];}
  draft.catalog=structuredClone(draft.milestones);
  renderDraft();
}
function renderEvidenceChoices(m){
  const choices=(draft.catalog||[]).map((candidate,index)=>({candidate,index})).filter(x=>x.candidate.kind===m.kind&&(m.kind!=='custom'||(x.candidate.sourceLabel||x.candidate.label)===(m.sourceLabel||m.label)));
  if(choices.length<2)return '';
  return `<label>Source date<select data-field="evidence"><option value="">Choose a source date</option>${choices.map(({candidate:c,index})=>`<option value="${index}" ${c.date===m.date&&c.quote===m.quote?'selected':''}>${esc(c.date)} · ${esc(c.quote)}</option>`).join('')}</select></label>`;
}
function manualMilestone(url){return {kind:'custom',label:'My deadline',date:'',time:null,zone:null,quote:'',sourceUrl:url,manual:true,reasons:['Manual reminder: source is not checked automatically.'],confirmed:false};}
async function closeDraft(){draft=null;$('#draft-dialog').close();document.body.append($('#toast'));$('#draft').hidden=true;await storage.set('pendingReview',null);}
$('#draft-dialog').addEventListener('cancel',event=>{event.preventDefault();void closeDraft();});
function renderDraft(){
  const box=$('#draft');box.hidden=false;
  box.innerHTML=`<section class="draft"><div class="card-heading"><h2 id="draft-review-title">Choose what to track</h2><button id="cancel-draft" class="text-button">Cancel</button></div><p class="draft-intro">Confirm the dates and their source before saving.${draft.verifying?' Checking the source in the background. You can review the captured dates now; editing and saving will unlock when the check finishes.':!draft.monitoring?' Backend monitoring is unavailable. Local entries can be rechecked manually while your browser is open; manual reminders are never rechecked.':''}</p>${draft.verifying?'<p class="source-verification" role="status"><progress aria-label="Checking source"></progress> Checking the latest source dates…</p>':''}<fieldset class="review-fields" ${draft.verifying?'disabled':''}><label for="draft-title">Page name</label><input id="draft-title" value="${esc(draft.title)}">${draft.milestones.map((m,i)=>`<div class="candidate" data-candidate="${i}"><label class="candidate-heading"><input type="checkbox" data-field="selected" ${m.selected===false?'':'checked'}> Track this milestone</label><label>Milestone name<input data-field="label" maxlength="100" value="${esc(m.label||labels[m.kind])}"></label><label>Category<select data-field="kind">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${m.kind===k?'selected':''}>${v}</option>`).join('')}</select></label>${renderEvidenceChoices(m)}<blockquote>${esc(m.quote||'Enter a source sentence below.')}</blockquote><label>Source sentence<input data-field="quote" value="${esc(m.quote)}"></label><a class="muted" href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><div class="date-grid"><label>Date<input data-field="date" type="date" value="${esc(m.date)}"></label><label>Time (optional)<input data-field="time" type="time" value="${esc(m.time||'')}"></label><label class="zone-field">Timezone (default: IST / UTC+05:30)<input data-field="zone" value="${esc(m.zone||'')}" placeholder="Asia/Kolkata or UTC+05:30"></label></div>${m.reasons?.length?`<p class="hint">${esc(m.reasons.join(' '))}</p>`:''}<label class="candidate-heading"><input type="checkbox" data-field="manual" ${m.manual?'checked':''}> Manual reminder only</label></div>`).join('')}<button id="add-manual" class="text-button">Add another milestone</button>${draft.links.length?`<div class="review"><h4>Suggested supporting sources</h4><p>Only pages you approve will be checked.</p>${draft.links.filter(l=>!draft.sources.includes(l.url)).map(l=>`<button class="text-button" data-add-source="${esc(l.url)}">Add ${esc(l.label||new URL(l.url).pathname)}</button><br>`).join('')}</div>`:''}<p class="muted">${draft.sources.length} approved source${draft.sources.length===1?'':'s'}</p><label for="planned-date">Planned action date (optional)</label><input id="planned-date" type="date" value="${esc(draft.plan||'')}"></fieldset><button id="save-draft" class="button primary full" ${draft.verifying?'disabled':''}>${draft.verifying?'Checking source…':'Save tracked page'}</button></section>`;
  $('#cancel-draft').onclick=closeDraft;
  $('#add-manual').onclick=()=>{readDraft();draft.milestones.push(manualMilestone(draft.url));renderDraft();};
  box.querySelectorAll('[data-add-source]').forEach(button=>button.onclick=()=>run(button,async()=>{
    readDraft();if(!connected)throw new Error('Start the backend to add a monitored supporting source.');const page=await api('/api/inspect','POST',{url:button.dataset.addSource});draft.sources.push(button.dataset.addSource);const added=page.milestones.map(m=>({...m,detected:{time:m.time??null,zone:m.zone??null},confirmed:false}));draft.milestones=dedupeMilestones([...draft.milestones,...added]);draft.catalog.push(...structuredClone(added));renderDraft();toast('Supporting source added. Repeated copies are filtered; distinct milestones can share a date.');
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
      draft.milestones[i].label=draft.milestones[i].label||labels[newKind];renderDraft();
    };
    const evidence=node.querySelector('[data-field="evidence"]');if(evidence)evidence.onchange=event=>{
      const choice=event.target.value;readDraft();if(choice==='')return;
      draft.milestones[i]={...draft.milestones[i],...structuredClone(draft.catalog[+choice]),confirmed:false};renderDraft();
    };
  });
  box.querySelector('h2').textContent=`${draft.milestones.length} milestone${draft.milestones.length===1?'':'s'} found — review and save`;
  if(!$('#draft-dialog').open){$('#draft-dialog').append($('#toast'));$('#draft-dialog').showModal();$('#draft-dialog').scrollTop=0;}
}
function readDraft(){
  draft.title=$('#draft-title').value;draft.plan=$('#planned-date').value;
  $('#draft').querySelectorAll('[data-candidate]').forEach(node=>{const m=draft.milestones[+node.dataset.candidate];for(const field of ['selected','kind','label','quote','date','time','zone','manual']){const input=node.querySelector(`[data-field="${field}"]`);m[field]=input.type==='checkbox'?input.checked:input.value;}m.label=m.label.trim()||labels[m.kind];});
}
async function saveDraft(){
  if(draft?.verifying)return;
  readDraft();const selected=dedupeMilestones(draft.milestones.filter(m=>m.selected!==false));if(!selected.length)throw new Error('Select at least one milestone.');
  for(const m of selected){validateMilestone(m);if(m.time)instant(m);}
  const payload={...draft,milestones:selected.map(m=>({...m,confirmed:true,uncertain:false,reasons:[]}))};
  if(connected&&await storage.get('token')){await api('/api/tracks','POST',payload);toast('Page saved. Your backend will watch the approved sources.');}
  else{const signature=ms=>ms.map(milestoneKey).sort().join("\n");const exists=localTracks.some(t=>t.url===payload.url&&t.title===payload.title&&signature(t.milestones)===signature(payload.milestones)&&t.plan===(payload.plan||null));if(!exists)localTracks.push({...payload,id:crypto.randomUUID(),milestones:payload.milestones.map(m=>({...m,id:crypto.randomUUID()})),status:selected.every(m=>m.manual)?'manual':'watching',local:true,intervalMinutes:60,errors:[]});await storage.set('localTracks',localTracks);toast('Saved locally. Recheck manually while your browser is open, or sync to the backend later.');}
  await closeDraft();await refresh();
  showView('watchlist');$('#watchlist-view').scrollIntoView({behavior:'smooth',block:'start'});
}
async function activePage(){
  if(!isExtension)throw new Error('Load the browser extension to read your active tab, or paste a URL here.');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  let result;try{[result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({title:document.title,url:location.href,text:document.body.innerText.slice(0,250000),selected:window.getSelection()?.toString()||'',links:[...document.querySelectorAll('a[href]')].filter(a=>a.origin===location.origin&&/faq|rules|updates|schedule/i.test(a.textContent+' '+a.pathname)).slice(0,12).map(a=>({url:a.href,label:a.innerText}))})});}catch{throw new Error('Page access is unavailable. Click the extension toolbar icon on the page with dates, then try again.');}
  const p=result.result;await inspect(p.url,{...p,milestones:extract(p.text,p.url)});
}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#action-dialog').showModal();}
function closeDialog(){$('#action-dialog').close();}
async function googleDialog(t,channel){
  if(t.local||!connected)throw new Error('Sync this tracked page to a running backend first.');
  if(!me.googleConnected){showView('settings');throw new Error('Connect Google in Settings, then try again.');}
  const isCalendar=channel==='calendar';
  dialog(isCalendar?'Google Calendar':'Google Tasks',`<div class="calendar-entry-card"><h3>${esc(t.title)}</h3><p id="google-entry-summary"></p></div><label for="google-milestone">Milestone</label><select id="google-milestone">${t.milestones.map(m=>`<option value="${esc(m.id)}">${esc(m.label)} · ${esc(m.date)}</option>`).join('')}</select>${isCalendar?'<label for="reminder-minutes">Remind me</label><select id="reminder-minutes"><option value="1440">1 day before</option><option value="60">1 hour before</option><option value="10080">1 week before</option><option value="0">At the deadline</option></select><p id="calendar-reminder-note" class="muted"></p>':'<p class="hint">A dated task has a date only. Use Calendar for a reminder at a specific time.</p>'}<p class="muted">The event-page link is included. Future verified date changes automatically update this entry.</p><button id="approve-google" class="button primary full"></button>`);
  function updateGoogleSummary(){
    const selected=t.milestones.find(m=>m.id===$('#google-milestone').value),linked=t.googleLinks?.some(link=>link.channel===channel&&link.milestoneId===selected.id&&link.state==='linked');
    $('#google-entry-summary').textContent=selected.label+' · '+formatDate(selected.date)+(selected.time?' · '+selected.time+' '+displayZone(selected.zone||DEFAULT_TIMEZONE):' · All day');
    $('#approve-google').textContent=isCalendar?(linked?'Update Calendar':'Add to Calendar'):(linked?'Update Google Task':'Create Google Task');
    if(isCalendar)$('#calendar-reminder-note').textContent=selected.time?'The reminder uses the milestone’s date, time, and timezone.':'All-day entry. The reminder is measured before midnight in your Google Calendar timezone.';
  }
  $('#google-milestone').onchange=updateGoogleSummary;updateGoogleSummary();
  $('#approve-google').onclick=e=>run(e.currentTarget,async()=>{await api(`/api/tracks/${t.id}/google`,'POST',{milestoneId:$('#google-milestone').value,channel,minutes:isCalendar?+$('#reminder-minutes').value:1440,approved:true});closeDialog();toast('Google entry saved.');await refresh();});

}
function manageDialog(t){
  dialog('Manage tracked page',`<label for="manage-plan">Planned action date</label><input id="manage-plan" type="date" value="${esc(t.plan||'')}"><label for="manage-interval">Background check interval</label><select id="manage-interval"><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440">Every day</option></select><p class="muted">Linked Calendar events and Google Tasks update automatically after verified date changes.</p><label for="manage-source">Add a same-site FAQ, rules or updates source</label><input id="manage-source" type="url" placeholder="https://example.com/faq"><p class="muted">Approved sources:<br>${t.sources.map(s=>`<a href="${safeLink(s)}" target="_blank" rel="noreferrer">${esc(s)}</a>`).join('<br>')}</p><button id="save-management" class="button primary full">Save preferences</button><div class="dialog-action"><button id="delete-track" class="text-button">Remove this tracked page</button><p class="muted">Linked Calendar events and Tasks remain in your Google account.</p></div>`);
  const groupBox=document.createElement('div');groupBox.innerHTML='<h3>Groups</h3>'+((dashboardPrefs.groups||[]).map(g=>'<label><input type="checkbox" data-manage-group="'+esc(g.id)+'" '+(g.trackIds.includes(t.id)?'checked':'')+'> '+esc(g.name)+'</label>').join('')||'<p>Create a group in Group View to add this page.</p>');$('#save-management').before(groupBox);
  $('#manage-interval').value=String(t.intervalMinutes||60);
  if(t.milestones.some(m=>m.manual)&&!t.local){
    const button=document.createElement('button');button.className='button secondary full';button.textContent='Verify source & enable automatic monitoring';
    $('#dialog-body').append(button);button.onclick=()=>run(button,async()=>{await api(`/api/tracks/${t.id}/monitor`,'POST',{approved:true});closeDialog();await refresh();toast('Source verified. Monitoring enabled and first recheck completed.');});
  }
  $('#save-management').onclick=e=>run(e.currentTarget,async()=>{
    const changes={plan:$('#manage-plan').value,intervalMinutes:+$('#manage-interval').value,...($('#manage-source').value?{addSource:$('#manage-source').value}:{})};
    if(t.local){Object.assign(t,changes);await storage.set('localTracks',localTracks);}else await api('/api/tracks/'+t.id,'PATCH',changes);
    await saveDashboard({groups:(dashboardPrefs.groups||[]).map(g=>({...g,trackIds:$('#dialog-body').querySelector('[data-manage-group="'+CSS.escape(g.id)+'"]')?.checked?[...new Set([...g.trackIds,t.id])]:g.trackIds.filter(id=>id!==t.id)}))});closeDialog();await refresh();toast('Preferences saved.');
  });
  $('#delete-track').onclick=e=>run(e.currentTarget,async()=>{
    workspaceEpoch++;if(!t.local)await api('/api/tracks/'+t.id,'DELETE');workspaceEpoch++;
    tracks=tracks.filter(track=>track.id!==t.id);localTracks=localTracks.filter(track=>track.id!==t.id);changes=changes.filter(change=>change.trackId!==t.id);openTracks.delete(t.id);
    await storage.set('localTracks',localTracks);await storage.set('localChanges',(await storage.get('localChanges')||[]).filter(change=>change.trackId!==t.id));await storage.set('cachedTracks',(await storage.get('cachedTracks')||[]).filter(track=>track.id!==t.id));
    closeDialog();render();await refresh();
  });
}
async function localCheck(t,button){
  if(!isExtension)throw new Error('Local checks are available in the browser extension.');
  const observations=[];
  for(const url of t.sources){if(!await chrome.permissions.request({origins:[new URL(url).origin+'/*']}))throw new Error('Page access was not granted.');const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Failed fetch. Last confirmed date kept.');const doc=new DOMParser().parseFromString(await r.text(),'text/html');doc.querySelectorAll('script,style,noscript').forEach(n=>n.remove());observations.push({milestones:extract(doc.body.textContent,url)});}
  const result=compare(t,observations);const history=await storage.get('localChanges')||[];history.push(...result.changes.map(c=>({...c,id:crypto.randomUUID(),trackId:t.id,title:t.title,at:new Date().toISOString()})));await storage.set('localChanges',history);Object.assign(t,result,{lastSuccessfulCheck:new Date().toISOString(),status:result.conflicts.length?'conflict':result.uncertain.length?'needs_review':result.changes.length?'changed':'watching'});delete t.changes;await storage.set('localTracks',localTracks);toast(result.changes.length?'Local deadline change detected. Sync to enable durable alerts.':'Local check complete.');
}
function resolveDialog(t,kind,index,milestoneId){
  const conflict=[...(t.conflicts||[]),...(t.uncertain||[])].find(c=>milestoneId?c.milestoneId===milestoneId:c.kind===kind),m=conflict.candidates[index],old=t.milestones.find(m=>milestoneId?m.id===milestoneId:m.kind===kind);
  dialog('Review source interpretation',`<p>${esc(m.quote)}</p><a href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><p class="hint">${esc((m.reasons||[]).join(' ')||'Sources disagree. Approve this candidate only after reviewing the evidence.')}</p><label>Date<input id="resolve-date" type="date" value="${esc(m.date)}"></label><label>Time (optional)<input id="resolve-time" type="time" value="${esc(m.time||'')}"></label><label>Timezone<input id="resolve-zone" value="${esc(m.zone||'')}"></label><button id="approve-resolution" class="button primary full">Approve this interpretation</button>`);
  $('#approve-resolution').onclick=e=>run(e.currentTarget,async()=>{
    if(t.local)throw new Error('Sync this tracked page to the backend before resolving source conflicts.');
    await api(`/api/tracks/${t.id}/resolve`,'POST',{milestoneId:old.id,date:$('#resolve-date').value,sourceDate:m.date,time:$('#resolve-time').value,zone:$('#resolve-zone').value,sourceUrl:m.sourceUrl,approved:true});closeDialog();await refresh();
  });
}
function paintOutbox(){
  const shown=outboxItems.slice(0,outboxVisible);$('#outbox').innerHTML=shown.map(d=>`<div class="outbox-item"><strong>${esc(d.subject||'Email alert')}</strong><p>${esc(d.to)} · ${esc(d.status)}</p><p>${esc(d.label||d.error||'Queued')}</p>${d.status==='demo'?`<pre>${esc(d.text)}</pre>`:''}</div>`).join('')||'<p class="muted">No email activity yet.</p>';
  $('#outbox-load-bar').hidden=outboxItems.length===0;$('#outbox-count').textContent=shown.length+' of '+outboxItems.length;$('#load-more-outbox').hidden=shown.length>=outboxItems.length;
}
async function renderOutbox(){const epoch=workspaceEpoch,owner=me.email;if(outboxOwner!==me.email){outboxOwner=me.email;outboxVisible=3;}const items=await api('/api/deliveries');if(epoch!==workspaceEpoch||owner!==me.email)return;outboxItems=items.filter(d=>d.channel!=='browser').sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));paintOutbox();}
$('#load-more-outbox').onclick=()=>{outboxVisible+=5;paintOutbox();};
$('#clear-account-data').onclick=e=>run(e.currentTarget,async()=>{
  if(!connected||!await storage.get('token'))throw new Error('Sign in to clear your account data.');
  workspaceEpoch++;$('#clear-data-status').textContent='Clearing…';
  try{await api('/api/account/clear-data','POST',{action:'clear-account-data'});workspaceEpoch++;for(const key of ['localTracks','localChanges','cachedTracks'])await storage.set(key,[]);await storage.set('pendingReview',null);tracks=[];localTracks=[];changes=[];openTracks.clear();outboxItems=[];outboxVisible=3;paintOutbox();if(draft)await closeDraft();await refresh();$('#clear-data-status').textContent='Account activity cleared. Your profile and Google connection are unchanged.';}catch(error){$('#clear-data-status').textContent=error.message;throw error;}
});
$('#watchlist-view').onclick=e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const id=button.closest('[data-track]').dataset.track,t=tracks.find(t=>t.id===id)||localTracks.find(t=>t.id===id);
  run(button,async()=>{
    switch(button.dataset.action){
      case 'expand':{const article=button.closest('[data-track]'),pane=article.querySelector('.track-details'),expanded=pane.hidden;pane.hidden=!expanded;article.classList.toggle('is-open',expanded);button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'Collapse':'Expand')+' milestones for '+t.title);if(expanded)openTracks.add(id);else openTracks.delete(id);break;}
      case 'check':if(t.local)await localCheck(t,button);else{const result=await api(`/api/tracks/${id}/check`,'POST',{});toast(result.status==='changed'?'A deadline changed. See the timeline.':result.status==='conflict'?'Sources disagree. Review the evidence.':result.status==='check_failed'?'Check failed. Your confirmed dates are kept.':result.status==='manual'?'This is a manual reminder. Use Manage to verify the source and enable automatic monitoring.':result.status==='date_missing'?'A tracked milestone is missing from the source. Your confirmed date is kept.':result.status==='needs_review'?'A source date needs your review. Open the tracked page card.':'Check complete.');if(isExtension)chrome.runtime.sendMessage({type:'surface-alerts'}).catch(()=>{});}await refresh();break;
      case 'calendar':case 'task':await googleDialog(t,button.dataset.action);break;
      case 'prepare-signup':location.assign('/backup.html#event='+encodeURIComponent(t.id));break;
      case 'pin':await saveDashboard({pinnedIds:(dashboardPrefs.pinnedIds||[]).includes(id)?dashboardPrefs.pinnedIds.filter(x=>x!==id):[...(dashboardPrefs.pinnedIds||[]),id]});render();break;
      case 'manage':manageDialog(t);break;
      case 'resolve':resolveDialog(t,button.dataset.kind,+button.dataset.index,button.dataset.milestone);break;
      case 'sync':await api('/api/tracks','POST',{...t,milestones:t.milestones.map(m=>({...m,confirmed:true}))});localTracks=localTracks.filter(l=>l.id!==id);await storage.set('localTracks',localTracks);await refresh();toast('Synced to the persistent backend.');break;
    }
  });
};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{showView(button.dataset.view);if(view==='settings'&&connected)renderOutbox().catch(()=>{});});
function openProfileSettings(){const popover=$('#profile-popover');if(!popover.matches(':popover-open'))popover.showPopover();$('#settings-view').hidden=false;$('#profile-settings').setAttribute('aria-expanded','true');if(connected){renderOutbox().catch(()=>{});void backgroundAlertStatus();}}
$('#profile-settings').onclick=()=>{const expanded=$('#settings-view').hidden;$('#settings-view').hidden=!expanded;$('#profile-settings').setAttribute('aria-expanded',String(expanded));if(expanded&&connected){renderOutbox().catch(()=>{});void backgroundAlertStatus();}};
function cancelProfileName(){profileNameEditing=false;profileNameDirty=false;$('#profile-name-status').textContent='';render();$('#edit-profile-name').focus();}
$('#edit-profile-name').onclick=()=>{profileNameEditing=true;profileNameDirty=false;$('#profile-name').value=me.displayName||'';$('#profile-name-status').textContent='';render();$('#profile-name').focus();};
$('#cancel-profile-name').onclick=cancelProfileName;
function extensionMessage(extensionId,message){
  return new Promise((resolve,reject)=>{
    if(!globalThis.chrome?.runtime?.sendMessage){reject(new Error('Open this page in Edge with Deadline Scout enabled, then reload the extension and choose Set up background alerts.'));return;}
    const timer=setTimeout(()=>reject(new Error('The extension did not respond. Reload Deadline Scout in Edge and try setup again.')),20000);
    try{chrome.runtime.sendMessage(extensionId,message,response=>{clearTimeout(timer);const error=chrome.runtime.lastError;if(error||!response?.ok)reject(new Error(response?.error||'Reload the Deadline Scout extension in Edge, then choose Set up background alerts again.'));else resolve(response);});}catch(error){clearTimeout(timer);reject(error);}
  });
}
async function backgroundAlertStatus(){
  const id=await storage.get('backgroundExtensionId');if(!id||!me.email)return;
  try{const result=await extensionMessage(id,{type:'scout-alerts-status'});const same=result.connected&&result.email===me.email;$('#test-background-alert').hidden=!same;$('#background-alerts-status').textContent=same?'Background alerts connected to this account.':result.connected?'The extension is connected to another account. Choose Set up background alerts in the extension to switch it.':'Choose Set up background alerts in the extension to connect this account.';}catch{/* The setup flow provides actionable errors when explicitly requested. */}
}
async function finishBackgroundSetup(flow){
  openProfileSettings();$('#background-alerts-status').textContent='Connecting background alerts…';
  if(!me.email){$('#background-alerts-status').textContent='Sign in to this dashboard to connect background alerts.';trackingStatus('Sign in once to connect background alerts to your account.',true);return;}
  try{
    if(!/^[a-p]{32}$/.test(flow.extensionId||'')||![flow.state,flow.challenge].every(v=>/^[A-Za-z0-9_-]{43}$/.test(v||'')))throw new Error('Invalid setup link. Start again from the extension.');
    await extensionMessage(flow.extensionId,{type:'scout-alerts-status',state:flow.state,challenge:flow.challenge});
    const result=await api('/api/auth/extension-session','POST',{extensionId:flow.extensionId,challenge:flow.challenge});
    const connected=await extensionMessage(flow.extensionId,{type:'scout-alerts-connect',state:flow.state,challenge:flow.challenge,code:result.code});
    await storage.set('backgroundExtensionId',flow.extensionId);await storage.set('pendingBackgroundSetup',null);$('#background-alerts-status').textContent='Background alerts connected to '+(connected.email||me.email)+'.';$('#test-background-alert').hidden=false;toast('Background alerts connected.');
  }catch(error){$('#background-alerts-status').textContent=error.message;}
}
$('#test-background-alert').onclick=e=>run(e.currentTarget,async()=>{const id=await storage.get('backgroundExtensionId');await extensionMessage(id,{type:'scout-alerts-test'});$('#background-alerts-status').textContent='Test sent. Check Edge and Windows notification settings if no banner appears.';});
$('#profile-name').oninput=()=>{profileNameDirty=true;$('#profile-name-status').textContent='';};
$('#profile-name').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelProfileName();}};
$('#profile-popover').addEventListener('toggle',async event=>{
  if(event.newState==='closed'){profileNameEditing=false;profileNameDirty=false;$('#profile-name-form').hidden=true;$('#edit-profile-name').hidden=false;return;}
  if(event.newState!=='open'||!me.email||me.displayName||!me.googleConnected||googleNamesRequested.has(me.email))return;
  const account=me.email;googleNamesRequested.add(account);try{const result=await api('/api/profile/google-name','POST',{});if(me.email!==account)return;me.displayName=result.displayName;render();}catch{/* The edit action remains available if Google cannot provide a name. */}
});
$('#profile-name-form').onsubmit=e=>{e.preventDefault();void run($('#save-profile-name'),async()=>{
  $('#profile-name-status').textContent='Saving…';try{const result=await api('/api/me','PATCH',{displayName:$('#profile-name').value});me.displayName=result.displayName;profileNameDirty=false;profileNameEditing=false;await refresh();toast('Name saved.');if($('#profile-popover').matches(':popover-open'))$('#edit-profile-name').focus();}catch(error){$('#profile-name-status').textContent=error.message;throw error;}
});};
$('#profile-signin').onclick=e=>run(e.currentTarget,signIn);
async function signOut(){workspaceEpoch++;try{await api('/api/logout','POST',{});}finally{await storage.set('token',null);tracks=[];changes=[];me={};await storage.set('cachedTracks',[]);render();}}
$('#profile-switch').onclick=e=>run(e.currentTarget,async()=>{await signOut();await signIn();});
async function signIn(){if(draft){readDraft();await storage.set('pendingReview',draft);}await connectGoogle();await refresh();}
$('#tracking-signin').onclick=e=>run(e.currentTarget,signIn);
async function inspectPastedLink(){
  const url=$('#source-url').value.trim();
  if(!url){trackingStatus('Paste a page URL in the box, then choose Find dates.');$('#source-url').focus();return;}
  try{await inspect(url);}catch(error){trackingStatus(error.message,error.status===401);throw error;}
}
function updateCaptureAction(){
  $('#track-active').innerHTML=(isExtension&&!$('#source-url').value.trim()?'Scan this page':'Find dates')+icon('arrow-right');
}
$('#track-active').onclick=e=>run(e.currentTarget,()=>$('#source-url').value.trim()||!isExtension?inspectPastedLink():activePage());
$('#inspect-url').onclick=e=>run(e.currentTarget,inspectPastedLink);
$('#source-url').oninput=updateCaptureAction;
$('#source-url').placeholder='Paste a public page URL';
$('#inspect-url').textContent='Find';
$('#inspect-url').style.fontSize='.8rem';
updateCaptureAction();
$('#source-url').onkeydown=e=>{if(e.key==='Enter')$('#inspect-url').click();};
$('#manual-start').onclick=()=>{const url=$('#source-url').value.trim();if(!/^https?:\/\//i.test(url)){toast('Paste the original page URL first, then enter its date manually.');$('#source-url').focus();return;}draft={url,title:'My tracked page',sources:[url],links:[],milestones:[manualMilestone(url)],monitoring:false};renderDraft();};
$('#close-dialog').onclick=closeDialog;
$('#connect-google').onclick=e=>run(e.currentTarget,async()=>{await signIn();toast('Google connected.');});
$('#disconnect-google').onclick=e=>run(e.currentTarget,async()=>{await api('/api/google/disconnect','POST',{});await refresh();});
function websiteNotification(title,body,tag,url){
  if(!('Notification' in window)||Notification.permission!=='granted')throw new Error('Allow notifications for Deadline Scout in Edge site permissions.');
  return new Promise((resolve,reject)=>{const notification=new Notification(title,{body,icon:'/icon128.png',tag});const timer=setTimeout(()=>reject(new Error('No notification confirmation received. Check Edge and Windows notification settings.')),15000);notification.onshow=()=>{clearTimeout(timer);resolve();};notification.onerror=()=>{clearTimeout(timer);reject(new Error('The browser could not show the notification. Check Edge and Windows notification settings.'));};notification.onclick=()=>{window.focus();if(url&&new URL(url).origin===location.origin)location.assign(url);else showView('timeline');notification.close();};});
}
async function surfaceWebsiteAlerts(){
  if(isExtension||webAlertsBusy||!connected||!me.email||!('Notification' in window)||Notification.permission!=='granted'||!await storage.get('webAlerts:'+me.email))return;
  webAlertsBusy=true;try{await deliverBrowserAlerts({load:()=>api('/api/alerts'),notify:alert=>{if(alert.notice)return websiteNotification(alert.notice.title+': '+alert.notice.label,alert.notice.message,alert.id,alert.notice.url);const c=alert.change;return websiteNotification(c.title+': '+c.label,c.before.date+' → '+c.after.date+'\n'+c.impact,alert.id);},ack:id=>api('/api/alerts/ack','POST',{id})});$('#browser-alerts-status').textContent='Website alerts connected. Keep this page open.';}catch(error){$('#browser-alerts-status').textContent=error.message;}finally{webAlertsBusy=false;}
}
$('#browser-alerts').onchange=e=>run(null,async()=>{
  const wanted=e.target.checked;$('#browser-alerts-status').textContent='';try{
    if(isExtension){
      if(wanted){await enableExtensionAlerts({browser:chrome,validateSession:()=>api('/api/me'),signIn:connectGoogle});await refresh();await chrome.runtime.sendMessage({type:'surface-alerts'});$('#browser-alerts-status').textContent='Background alerts connected to '+me.email+'.';
      }else{await chrome.permissions.remove({permissions:['notifications']});$('#browser-alerts-status').textContent='Background alerts turned off.';}
    }else{
      if(wanted){if(!me.email)throw new Error('Sign in before enabling browser alerts.');if(!('Notification' in window))throw new Error('This browser does not support desktop notifications.');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications were not allowed. Open Edge site permissions for Deadline Scout and allow notifications.');}
      await storage.set('webAlerts:'+me.email,wanted);if(wanted)await surfaceWebsiteAlerts();else $('#browser-alerts-status').textContent='Website alerts turned off.';
    }
  }catch(error){$('#browser-alerts-status').textContent=error.message;throw error;}finally{await renderSettings();}
});
$('#test-browser-alert').onclick=e=>run(e.currentTarget,async()=>{
  if(isExtension){if(!await chrome.permissions.contains({permissions:['notifications']}))throw new Error('Enable browser alerts first.');await chrome.notifications.create('scout-test',{type:'basic',iconUrl:'icon128.png',title:'Deadline Scout is connected',message:'Your browser alerts are ready.',priority:2});}
  else await websiteNotification('Deadline Scout is connected','Your browser alerts are ready.','scout-test');
  $('#browser-alerts-status').textContent='Test sent. If no banner appears, check Windows notification settings and Do not disturb.';
});
$('#email-alerts').onchange=e=>run(null,async()=>{try{await api('/api/settings','PATCH',{emailEnabled:e.target.checked});await refresh();}catch(error){e.target.checked=!e.target.checked;throw error;}});
$('#test-email').onclick=e=>run(e.currentTarget,async()=>{const d=await api('/api/email/test','POST',{});toast(d.label);await renderOutbox();});
$('#save-backend').onclick=e=>run(e.currentTarget,async()=>{
  const u=new URL($('#backend-url').value);if(!['https:','http:'].includes(u.protocol)||u.pathname!=='/'||u.username||u.password)throw new Error('Enter a backend origin, such as https://api.example.com.');
  if(u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('Hosted backends require HTTPS.');
  if(isExtension&&!await chrome.permissions.request({origins:[u.origin+'/*']}))throw new Error('Backend access was not granted.');
  await storage.set('settings',{backendUrl:u.origin});await storage.set('token',null);await refresh();toast('Backend connection saved.');
});
$('#apply-demo').onclick=e=>run(e.currentTarget,async()=>{await api('/api/demo','POST',{mode:$('#demo-mode').value});toast('Fictional source updated. Use Check now on your demo registration.');});
$('#refresh-outbox').onclick=e=>run(e.currentTarget,renderOutbox);
$('#sign-out').onclick=e=>run(e.currentTarget,async()=>{await signOut();toast('Signed out.');});
async function openCapturedReview(token){
  const captured=await api('/api/captures/'+encodeURIComponent(token));
  history.replaceState(null,'',location.pathname);
  const preview=mergeCapturedMilestones(captured.milestones,null).map(m=>({...m,confirmed:false,detected:{time:m.time??null,zone:m.zone??null}}));
  const current={url:captured.url,title:captured.title,sources:[captured.url],links:captured.links||[],verifying:true,monitoring:false,milestones:preview.length?preview:[manualMilestone(captured.url)]};
  current.catalog=structuredClone(current.milestones);draft=current;renderDraft();
  // Show the extension's evidence first. Re-reading a rendered source can be slow.
  let serverPage=null;try{serverPage=await api('/api/inspect','POST',{url:captured.url});}catch{/* Preserve captured evidence if source verification fails. */}
  if(draft!==current)return; // Closing the review must not reopen it after the request finishes.
  const all=mergeCapturedMilestones(captured.milestones,serverPage?.milestones).map(m=>({...m,confirmed:false,detected:{time:m.time??null,zone:m.zone??null}}));
  Object.assign(current,{verifying:false,monitoring:!!serverPage?.milestones.length,milestones:all.length?all:[manualMilestone(captured.url)]});
  current.catalog=structuredClone(current.milestones);renderDraft();
  trackingStatus('Page scan received from the extension. Backend-readable dates can be monitored; browser-only dates are labelled manual reminders.');
}
async function saveDashboard(update){if(connected&&me.email)dashboardPrefs=await api('/api/dashboard','PATCH',update);else{dashboardPrefs={...dashboardPrefs,...update};await storage.set('dashboard-local',dashboardPrefs);}return dashboardPrefs;}
function renderGroups(ordered){const groups=dashboardPrefs.groups||[];const assigned=new Set(groups.flatMap(g=>g.trackIds));return groups.map(g=>'<section class="watch-group"><div class="section-heading"><h3>'+esc(g.name)+'</h3><button class="text-button" data-group-edit="'+esc(g.id)+'">Edit group</button></div>'+ordered.filter(t=>g.trackIds.includes(t.id)).map(t=>renderTrack(t)).join('')+(ordered.some(t=>g.trackIds.includes(t.id))?'':'<p class="muted">No matching pages in this group.</p>')+'</section>').join('')+'<section class="watch-group"><h3>Ungrouped</h3>'+ordered.filter(t=>!assigned.has(t.id)).map(t=>renderTrack(t)).join('')+'</section>';}
function groupDialog(id){const group=(dashboardPrefs.groups||[]).find(g=>g.id===id),all=[...tracks,...localTracks];dialog(group?'Edit group':'Create group','<label>Group name<input id="group-name" maxlength="80" value="'+esc(group?.name||'')+'"></label><fieldset><legend>Choose saved pages</legend>'+all.map(t=>'<label><input type="checkbox" data-group-track="'+esc(t.id)+'" '+(group?.trackIds.includes(t.id)?'checked':'')+'> '+esc(t.title)+'</label>').join('')+'</fieldset><button id="save-group" class="button primary">Save group</button>'+(group?'<button id="remove-group" class="text-button">Remove group (keep pages)</button>':''));$('#save-group').onclick=e=>run(e.currentTarget,async()=>{const name=$('#group-name').value.trim();if(!name)throw Error('Enter a group name.');const next={id:group?.id||crypto.randomUUID(),name,trackIds:[...$('#dialog-body').querySelectorAll('[data-group-track]:checked')].map(n=>n.dataset.groupTrack)};await saveDashboard({groups:[...(dashboardPrefs.groups||[]).filter(g=>g.id!==id),next]});closeDialog();render();});if(group)$('#remove-group').onclick=e=>run(e.currentTarget,async()=>{await saveDashboard({groups:dashboardPrefs.groups.filter(g=>g.id!==id)});closeDialog();render();});}
$('#find-event').oninput=render;$('#watchlist-layout').onchange=()=>{render();};$('#new-group').onclick=()=>groupDialog();
async function showChangeMessages(){if(!me.email||!connected||document.visibilityState!=='visible')return;const seen=new Set(dashboardPrefs.seenChangeIds||[]);const pending=changes.filter(c=>!seen.has(c.id)&&!noticesShown.has(me.email+':'+c.id)).slice(0,3);for(const c of pending){noticesShown.add(me.email+':'+c.id);const t=tracks.find(t=>t.id===c.trackId);if(!t)continue;const message=document.createElement('div');message.className='change-message';message.innerHTML='<button class="message-open"><strong>'+esc(c.title)+'</strong><span>'+esc(c.label)+': '+esc(formatDate(c.before.date))+' → '+esc(formatDate(c.after.date))+'</span><small>View tracked event →</small></button><button class="message-close" aria-label="Dismiss date update">×</button>';message.querySelector('.message-close').onclick=()=>message.remove();message.querySelector('.message-open').onclick=()=>{showView('watchlist');$('#find-event').value='';$('#watchlist-layout').value='all';openTracks.add(t.id);render();document.querySelector('#tracks [data-track="'+CSS.escape(t.id)+'"]')?.scrollIntoView({behavior:'smooth',block:'center'});message.remove();};$('#change-messages').append(message);setTimeout(()=>message.remove(),7000);}if(pending.length){try{await api('/api/dashboard/seen','POST',{ids:pending.map(c=>c.id)});dashboardPrefs.seenChangeIds=[...(dashboardPrefs.seenChangeIds||[]),...pending.map(c=>c.id)];}catch{/* Already shown in this session; retry persistence on next visit. */}}}
if(location.pathname!=='/auth/done'){
  const fragment=new URLSearchParams(location.hash.slice(1));
  const captureReview=fragment.has('capture')?run(null,()=>openCapturedReview(fragment.get('capture'))):null;
  await refresh();
  if(captureReview)await captureReview;
  else if(fragment.has('alerts-setup')){const flow={extensionId:fragment.get('alerts-setup'),state:fragment.get('state'),challenge:fragment.get('challenge'),expires:Date.now()+600000};history.replaceState(null,'',location.pathname);await storage.set('pendingBackgroundSetup',flow);await finishBackgroundSetup(flow);}
  else if(fragment.has('inspect')){const url=fragment.get('inspect');history.replaceState(null,'',location.pathname);$('#source-url').value=url;await run(null,()=>inspect(url));}
  else {const setup=await storage.get('pendingBackgroundSetup');if(setup&&setup.expires>Date.now())await finishBackgroundSetup(setup);else{const pending=await storage.get('pendingReview');if(pending){draft=pending;renderDraft();}if(['#settings','#timeline'].includes(location.hash))showView(location.hash.slice(1));}}
}
let refreshing=false;
setInterval(async()=>{
  if(refreshing||document.visibilityState!=='visible'||draft||$('#action-dialog').open||view==='settings')return;
  refreshing=true;try{await refresh();}finally{refreshing=false;}
},15000);

void surfaceWebsiteAlerts();setInterval(()=>void surfaceWebsiteAlerts(),15000);
