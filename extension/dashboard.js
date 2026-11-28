import {renderReadiness} from './readiness.js?v=2';
import {renderAnswers,renderMemory,renderHeatmap,renderProductivity} from './assistant-ui.js?v=tools-1';
import {renderApplication,renderPassport} from './applications.js?v=tools-1';
import {renderOverview,renderOpportunity,renderRisk,renderIntelligence} from './opportunities.js?v=tools-1';
import {deliverBrowserAlerts,enableExtensionAlerts} from './shared/browser-alerts.js';
import './shared/signup-success-notices.js?v=egress-1';
import {api,storage,settings,isExtension,connectGoogle} from './api.js';
import {extract,labels} from './shared/extract.js';
import {compare} from './shared/compare.js';
import {pretty,validateMilestone,instant,scheduleKey,DEFAULT_TIMEZONE} from './shared/dates.js';
import {selectMilestone,dedupeMilestones,milestoneKey,mergeCapturedMilestones,nearestUpcomingTrack} from './shared/milestone-selection.js';
const $=s=>document.querySelector(s);
const icon=name=>'<img class="ui-icon" src="/assets/icons/'+name+'.svg" alt="">';
const openTracks=new Set();
const googleNamesRequested=new Set();
let profileNameDirty=false,profileNameEditing=false,workspaceEpoch=0,outboxCursor=null,outboxOwner=null,outboxItems=[],outboxAt=0,outboxRequest=0,webAlertsBusy=false;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
$('#today-label').textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date())+' · IST';
function nextMilestone(t){const dates=[...t.milestones].sort((a,b)=>a.date.localeCompare(b.date));return dates.find(m=>m.date>=today)||dates.at(-1);}
function dateTile(m){const d=new Date(m.date+'T12:00:00Z');return '<time class="date-tile" datetime="'+esc(m.date)+'"><span>'+new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'}).format(d)+'</span><strong>'+d.getUTCDate()+'</strong><small>'+d.getUTCFullYear()+'</small></time>';}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}};
let dashboardPrefs={groups:[],pinnedIds:[],seenChangeIds:[]},noticesShown=new Set();
let timelineEntries=[],timelineCursor=null,timelineRequest=0,timelineLoading=false,timelineStatus='';
let tracks=[],localTracks=[],changes=[],priorities=[],overview={},me={},config={},connected=false,draft=null,view='overview',toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
function trackingStatus(message,signIn=false){$('#scan-feedback').hidden=!/reading|scanning/i.test(message||'');$('#tracking-status').hidden=!message;$('#tracking-status-text').textContent=message;$('#tracking-signin').hidden=!signIn;}
async function run(button,fn){if(button?.disabled)return;try{if(button)button.disabled=true;await fn();}catch(e){toast(e.message);}finally{if(button)button.disabled=false;}}
function formatDate(date){if(!date)return 'No date';try{return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}catch{return date;}}
function compactDate(date){return new Intl.DateTimeFormat('en',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
function displayZone(zone){return ['Asia/Kolkata','Asia/Calcutta'].includes(zone)?'IST':zone;}
function relative(value){if(!value)return 'Not checked yet';const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return minutes===0?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hr ago`:new Date(value).toLocaleDateString();}
const mobileNavigation=matchMedia('(max-width:800px)');
const navButton=$('#toggle-workspace-nav'),sidebar=$('#workspace-sidebar');
function setNavigation(open){
  document.body.classList.toggle('navigation-open',open);
  navButton.setAttribute('aria-expanded',String(open));
  sidebar.inert=!open;
  $('#drawer-backdrop').hidden=!(open&&mobileNavigation.matches);
}
setNavigation(!mobileNavigation.matches);
mobileNavigation.addEventListener('change',()=>setNavigation(!mobileNavigation.matches));
navButton.onclick=()=>setNavigation(!document.body.classList.contains('navigation-open'));
$('#drawer-backdrop').onclick=()=>{setNavigation(false);navButton.focus();};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&mobileNavigation.matches&&document.body.classList.contains('navigation-open')){
    setNavigation(false);navButton.focus();
  }
});
const viewNames=['overview','watchlist','timeline','opportunity','intelligence','risk','applications','passport','settings','assistant','heatmap','productivity','memory','backup','readiness'];
let detailRequest=0,intelligenceRequest=0,readinessRequest=0;
function showView(name,options={}){
  if(!viewNames.includes(name))return;
  view=name;
  document.body.dataset.workspaceView=name;
  for(const id of ['profile-popover','notification-menu'])if($('#'+id).matches(':popover-open'))$('#'+id).hidePopover();
  if(mobileNavigation.matches)setNavigation(false);
  if(name==='settings'&&connected){renderOutbox().catch(()=>{});void backgroundAlertStatus();}

  const navigation=document.querySelector('.workspace-navigation [data-view="'+name+'"]');
  if(navigation?.closest('.nav-more'))navigation.closest('.nav-more').open=true;
  $('.topbar-search').hidden=name!=='watchlist';
  $('#current-view-name').textContent=navigation?.querySelector('.rail-label')?.textContent||navigation?.textContent.trim()||'Opportunity details';
  $('#radar-title').textContent=name==='watchlist'?'Track a page':'Your deadlines';
  $('.workspace-hero').hidden=!['overview','watchlist'].includes(name);
  if(name==='passport')void loadPassport();
  if(['assistant','heatmap','productivity','memory'].includes(name))void loadPlanning(name);
  if(name==='timeline')void loadTimeline();
  if(name==='backup')void mountBackup();
  if(name==='readiness'){
    if(location.hash.startsWith('#opportunity='))history.replaceState(null,'',location.pathname+location.search);
    void openReadiness(options.readinessTrack);
  }

  intelligenceRequest++;
  for(const page of viewNames)$('#'+page+'-view').hidden=page!==name;
  document.querySelectorAll('.workspace-navigation [data-view]').forEach(button=>{
    const active=button.dataset.view===name;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  if(['intelligence','risk'].includes(name))void loadIntelligence(name);
  if(name!=='opportunity'){
    detailRequest++;
    if(name==='settings')history.replaceState(null,'',location.pathname+location.search+'#settings');
    else if(location.hash.startsWith('#opportunity=')||location.hash==='#settings')history.replaceState(null,'',location.pathname+location.search);
  }
}
async function loadIntelligence(name){
  const request=++intelligenceRequest,epoch=workspaceEpoch;
  const target=$('#'+name+'-content');
  target.textContent='Loading '+(name==='risk'?'risk assessments':'website changes')+'…';
  target.setAttribute('aria-busy','true');
  try{
    const {risk,changes:websiteChanges}=await api('/api/intelligence');
    if(request!==intelligenceRequest||epoch!==workspaceEpoch)return;
    if(name==='risk')renderRisk(target,risk,{esc});
    else renderIntelligence(target,websiteChanges,{esc,safeLink});
  }catch(error){if(request===intelligenceRequest&&epoch===workspaceEpoch)target.textContent=error.message;}
  finally{if(request===intelligenceRequest)target.setAttribute('aria-busy','false');}
}
async function openReadiness(preferred){
  const request=++readinessRequest,epoch=workspaceEpoch;
  const select=$('#readiness-opportunity'),target=$('#readiness-content');
  const available=tracks.filter(track=>!track.cached);
  const selected=available.find(track=>track.id===(preferred||select.value))?.id||available[0]?.id;
  select.replaceChildren(...available.map(track=>new Option(track.title,track.id)));
  select.disabled=!selected;
  if(!selected){target.textContent='Save an opportunity to start planning.';return;}
  select.value=selected;
  target.textContent='Loading application plan…';
  try{
    const detail=await api('/api/opportunities/'+encodeURIComponent(selected)+'?view=readiness');
    if(view==='readiness'&&request===readinessRequest&&epoch===workspaceEpoch){
      renderReadiness(target,detail,today,{esc,formatDate});
    }
  }catch(error){
    if(view==='readiness'&&request===readinessRequest&&epoch===workspaceEpoch)target.textContent=error.message;
  }
}
$('#readiness-opportunity').onchange=()=>void openReadiness();
async function openOpportunity(id,{focus=true,plan=false}={}){
  const request=++detailRequest;
  const epoch=workspaceEpoch;
  const local=[...localTracks,...tracks.filter(track=>track.cached)].find(track=>track.id===id);
  showView('opportunity');
  history.replaceState(null,'','#opportunity='+encodeURIComponent(id));
  const title=$('#opportunity-title'),target=$('#opportunity-detail');
  title.textContent='Opportunity details';
  target.textContent='Loading opportunity…';
  if(focus)title.focus();
  try{
    const detail=local?{
      ...local,
      sources:(local.sources||[local.url]).map(url=>({url,history:[]})),
      changes:changes.filter(change=>change.trackId===id).map(change=>({
        ...change,detectedAt:change.at,sourceUrl:change.after.sourceUrl
      }))
    }:await api('/api/opportunities/'+encodeURIComponent(id));
    if(request!==detailRequest||epoch!==workspaceEpoch)return;
    title.textContent=detail.title;
    renderOpportunity(target,detail,{esc,safeLink,formatDate});
    if(detail.application){
      const workspace=document.createElement('section');
      workspace.dataset.workspaceId=detail.id;
      renderApplication(workspace,detail,{esc,safeLink});
      target.append(workspace);
      if(plan){
        const heading=workspace.querySelector('h3');
        heading.tabIndex=-1;
        heading.focus({preventScroll:true});
        heading.scrollIntoView({block:'start'});
      }
    }
  }catch(error){
    if(request===detailRequest&&epoch===workspaceEpoch)target.textContent=error.message;
  }
}
async function refresh(initial){
  const epoch=workspaceEpoch;
  localTracks=await storage.get('localTracks')||[];
  try{
    config=initial?.config||await api('/api/config');connected=true;
    if(!await storage.get('token')&&config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);}
    if(await storage.get('token')){
      try{const workspace=initial?.workspace||await api('/api/workspace?compact=1');if(epoch!==workspaceEpoch)return;({tracks,changes,me}=workspace);priorities=workspace.priorities||[];overview=workspace.overview||{};dashboardPrefs=workspace.dashboard||{groups:[],pinnedIds:[],seenChangeIds:[]};}
      catch(e){if(e.status===401){await storage.set('token',null);tracks=[];priorities=[];overview={};me={};if(config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);return refresh();}}else throw e;}
    }else{tracks=[];priorities=[];overview={};me={};}
    await storage.set('cachedTracks',tracks);
  }catch(e){connected=false;priorities=[];overview={};tracks=(await storage.get('cachedTracks')||[]).map(t=>({...t,cached:true}));}
  if(connected&&config.auth==='supabase'&&!await storage.get('token')){location.replace('/');return;}
  if(!me.email)dashboardPrefs=await storage.get('dashboard-local')||{groups:[],pinnedIds:[],seenChangeIds:[]};
  const activeTrackIds=new Set([...tracks,...localTracks].map(t=>t.id));
  changes=[...new Map([...changes,...await storage.get('localChanges')||[]].filter(c=>activeTrackIds.has(c.trackId)).map(c=>[c.id,c])).values()].sort((a,b)=>b.at.localeCompare(a.at));render();
  if(view==='timeline')void loadTimeline();
}
const statusLabels={watching:['Watching',''],changed:['Date updated','warn'],conflict:['Sources disagree','warn'],needs_review:['Review date','warn'],check_failed:['Check failed','warn'],date_missing:['Date missing','warn'],manual:['Manual reminder','neutral']};
async function loadTimeline({more=false}={}){
  if(timelineLoading||!connected||!me.email||more&&!timelineCursor)return;
  const request=++timelineRequest,epoch=workspaceEpoch,cursor=more?timelineCursor:null;
  timelineLoading=true;
  timelineStatus='Loading date changes…';
  $('#timeline-status').textContent=timelineStatus;
  $('#timeline-more').disabled=true;
  try{
    const page=await api('/api/changes?limit=20'+(cursor?'&after='+encodeURIComponent(cursor):''));
    if(request!==timelineRequest||epoch!==workspaceEpoch)return;
    const known=new Set(timelineEntries.map(entry=>entry.id));
    const keepOlder=more||timelineEntries.length>20&&page.entries.some(entry=>known.has(entry.id));
    timelineEntries=[...new Map([...(keepOlder?timelineEntries:[]),...page.entries].map(entry=>[entry.id,entry])).values()];
    if(more||!keepOlder)timelineCursor=page.next;
    timelineStatus='';
  }catch(error){if(request===timelineRequest&&epoch===workspaceEpoch)timelineStatus=error.message;}
  finally{
    if(request===timelineRequest){timelineLoading=false;if(view==='timeline')render();}
  }
}
$('#timeline-more').onclick=()=>void loadTimeline({more:true});
function render(){
  $('#tracks').setAttribute('aria-busy','false');
  const all=[...tracks,...localTracks.map(t=>({...t,local:true}))];
  const overviewQuestion=$('#scout-overview-question')?.value;
  renderOverview($('#opportunity-overview'),all,priorities,today,{esc,formatDate,overview});
  if(overviewQuestion)$('#scout-overview-question').value=overviewQuestion;
  const applicationTracks=tracks.filter(track=>!track.cached);
  const progressByTrack=new Map((overview.progress||[]).map(item=>[item.trackId,item]));
  $('#application-list').innerHTML=applicationTracks.length
    ? '<ul class="workspace-list application-index">'+applicationTracks.map(track=>{
      const progress=progressByTrack.get(track.id);
      return `<li><div><a data-opportunity="${esc(track.id)}" href="#opportunity=${encodeURIComponent(track.id)}">${esc(track.title)}</a>
        <small>${progress?progress.done+' of '+progress.total+' plan items complete':'Add tasks and a checklist'}</small></div>
        <button type="button" class="text-button" data-workspace-jump="readiness" data-readiness-track="${esc(track.id)}">Check readiness</button></li>`;
    }).join('')+'</ul>'
    : '<p class="muted">Track a page to start an application plan.</p><button class="button secondary" data-workspace-jump="watchlist" data-focus-scan>Track a page</button>';
  $('#profile-email').textContent=me.email||'Not signed in';$('#profile-status').textContent=me.email?(me.googleConnected?'Google Calendar & Tasks connected':'Google account signed in'):'Sign in to connect your Google account.';$('#profile-avatar').innerHTML=me.email?esc((me.displayName||me.email)[0].toUpperCase()):icon('user');$('#profile-signin').hidden=!!me.email;$('#profile-switch').hidden=!me.email;$('#sign-out').hidden=!me.email;
  if(!me.email){profileNameDirty=false;profileNameEditing=false;}
  $('#profile-identity').hidden=!me.email;$('#profile-display-name').textContent=me.displayName||'Your profile';$('#edit-profile-name').hidden=profileNameEditing;$('#profile-name-form').hidden=!me.email||!profileNameEditing;if(!profileNameEditing&&!profileNameDirty)$('#profile-name').value=me.displayName||'';
  if(outboxOwner!==me.email){outboxOwner=me.email;outboxCursor=null;outboxAt=0;outboxItems=[];paintOutbox();}
  $('#notification-summary').textContent=changes.length?'Date updates are available in your timeline.':'No date updates yet.';
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
  const timelineHistory=[...new Map([...(connected&&me.email?timelineEntries:changes),
    ...changes.filter(change=>localTracks.some(track=>track.id===change.trackId))]
    .filter(change=>all.some(track=>track.id===change.trackId)).map(change=>[change.id,change])).values()]
    .sort((a,b)=>b.at.localeCompare(a.at));
  $('#timeline-more').hidden=!timelineCursor;
  $('#timeline-more').disabled=timelineLoading;
  $('#timeline-status').textContent=timelineStatus;
  const history=timelineHistory.length?timelineHistory.map(c=>`<article class="event"><time>${esc(new Date(c.at).toLocaleString())}</time><h3>${esc(c.title)}</h3><p>${esc(c.label)}</p><div class="diff-box"><div><small>Before</small><strong>${esc(formatDate(c.before.date))}</strong><span class="date-meta">${esc(c.before.time?c.before.time+' '+c.before.zone:'Date only')}</span></div><div><small>After</small><strong>${esc(formatDate(c.after.date))}</strong><span class="date-meta">${esc(c.after.time?c.after.time+' '+c.after.zone:'Date only')}</span></div></div><p class="impact">${esc(c.impact)}</p><blockquote class="evidence">${esc(c.after.quote)}</blockquote><a href="${safeLink(c.after.sourceUrl)}" target="_blank" rel="noreferrer">View source</a></article>`).join(''):'<div class="empty"><div class="empty-symbol">'+icon('list-details')+'</div><h3>No changes. No noise.</h3><p>When a tracked date changes, you’ll see the before, after, and evidence here.</p></div>';
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
 return `<article class="card track-row ${featured?'featured-track':''} ${expanded?'is-open':''}" data-track="${esc(t.id)}"><div class="track-overview">${dateTile(next)}<div class="track-identity"><h3 class="card-title"><a class="opportunity-title-link" href="#opportunity=${encodeURIComponent(t.id)}" data-opportunity="${esc(t.id)}">${esc(t.title)}</a></h3><a class="domain" href="${safeLink(t.url)}" target="_blank" rel="noreferrer">${icon('external-link')}${esc(domain)}</a><span class="badge ${tone}">${esc(status)}</span>${recent?`<div class="change-chip">${icon('refresh')}${esc(compactDate(recent.before.date))} <span>→</span> ${esc(compactDate(recent.after.date))}</div>`:''}</div><div class="schedule-preview">${summary}</div><div class="row-actions"><button class="button secondary pin-action" data-action="pin" aria-pressed="${(dashboardPrefs.pinnedIds||[]).includes(t.id)}" title="${(dashboardPrefs.pinnedIds||[]).includes(t.id)?'Unpin':'Pin'}">${(dashboardPrefs.pinnedIds||[]).includes(t.id)?'Unpin':'Pin'}</button><button class="button secondary" data-action="prepare-signup">Prepare a Signup</button><button class="button secondary check-action" data-action="check">${icon('refresh')}<span>Check now</span></button><button class="button secondary icon-action" data-action="calendar" aria-label="${needsUpdate(t,'calendar')?'Update Calendar event':'Add to Calendar'}" title="${needsUpdate(t,'calendar')?'Update Calendar event':'Add to Calendar'}">${icon('calendar')}</button><button class="button secondary icon-action" data-action="task" aria-label="${needsUpdate(t,'task')?'Update Google Task':'Create Google Task'}" title="${needsUpdate(t,'task')?'Update Google Task':'Create Google Task'}">${icon('check')}</button><button class="expand-action" data-action="expand" aria-label="${expanded?'Collapse':'Expand'} milestones for ${esc(t.title)}" aria-expanded="${expanded}" aria-controls="milestones-${esc(t.id)}">${icon('chevron-down')}</button></div></div><div class="track-details" id="milestones-${esc(t.id)}" ${expanded?'':'hidden'}>${t.signupDrafts?.length?`<div class="signup-card-links"><h4>Signup drafts</h4>${t.signupDrafts.map(d=>`<p><a href="/backup.html#draft=${esc(d.id)}">${esc(d.title)}</a> · ${esc(d.status)}<br><a href="${safeLink(d.formUrl)}" target="_blank" rel="noreferrer">Registration page ↗</a></p>`).join('')}</div>`:''}<h4>Milestones</h4>${t.milestones.map(m=>`<div class="milestone"><div><span class="milestone-label">${esc(m.label)}</span>${m.manual?'<span class="date-meta">Manual reminder · not monitored</span>':''}</div><div class="milestone-date">${esc(formatDate(m.date))}<span class="date-meta">${esc(m.time?m.time+' '+displayZone(m.zone):'Date only')}</span></div></div>`).join('')}${t.local&&connected?'<button class="text-button" data-action="sync">Sync to backend</button>':''}</div><div class="track-notices">${t.plan?`<div class="plan">Your plan: act on <strong>${esc(formatDate(t.plan))}</strong></div>`:''}${(t.errors||[]).map(e=>`<p class="error-list">${esc(e.message)}<br>Last confirmed dates kept.</p>`).join('')}${t.missing?.length?'<p class="error-list">A tracked date is missing from the sources. Last confirmed date kept.</p>':''}${conflicts.map(c=>`<div class="review"><h4>${esc(c.label||labels[c.kind])}: review the sources</h4>${c.candidates.map((m,i)=>`<p><strong>${esc(pretty(m))}</strong></p><blockquote class="evidence">${esc(m.quote)}</blockquote><a class="muted" href="${safeLink(m.sourceUrl)}" target="_blank" rel="noreferrer">View source</a><br><button class="text-button" data-action="resolve" data-kind="${esc(c.kind)}" data-milestone="${esc(c.milestoneId||'')}" data-index="${i}">Review this interpretation</button>`).join('')}</div>`).join('')}${t.googleError?`<p class="error-list">${esc(t.googleError)}</p>`:''}</div><div class="card-foot"><span>${t.lastSuccessfulCheck?'Checked '+esc(relative(t.lastSuccessfulCheck)):'Not checked yet'}${t.local?' · saved locally':' · every '+t.intervalMinutes+' min'}</span><button class="text-button" data-action="manage">Manage</button></div></article>`;
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
  $('#browser-alerts-help').textContent=isExtension?'Background alerts while your browser is running. Sign in here and allow notifications.':'Alerts while this website is open. In the extension, choose Set up background alerts to receive them without this page.';
  $('#test-browser-alert').disabled=!$('#browser-alerts').checked;

}
async function inspect(url,captured){
  url=url.trim();if(url&&!/^[a-z][a-z0-9+.-]*:/i.test(url))url='https://'+url;
  if(!/^https?:\/\//i.test(url))throw new Error('Use a public HTTP(S) page. Browser settings and local files cannot be tracked.');
  trackingStatus('Reading the page with dates…');
  let page,monitoring=true;
  if(connected){try{page=await api('/api/inspect','POST',{url,summary:true});}catch(e){if(!captured)throw e;page=captured;monitoring=false;toast(e.message+' Captured dates can be saved as manual reminders.');}}
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
    readDraft();if(!connected)throw new Error('Start the backend to add a monitored supporting source.');const page=await api('/api/inspect','POST',{url:button.dataset.addSource,summary:true});draft.sources.push(button.dataset.addSource);const added=page.milestones.map(m=>({...m,detected:{time:m.time??null,zone:m.zone??null},confirmed:false}));draft.milestones=dedupeMilestones([...draft.milestones,...added]);draft.catalog.push(...structuredClone(added));renderDraft();toast('Supporting source added. Repeated copies are filtered; distinct milestones can share a date.');
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
  $('#outbox').innerHTML=outboxItems.map(d=>`<div class="outbox-item"><strong>${esc(d.subject||'Email alert')}</strong><p>${esc(d.to)} · ${esc(d.status)}</p><p>${esc(d.label||d.error||'Queued')}</p>${d.status==='demo'?`<pre>${esc(d.text)}</pre>`:''}</div>`).join('')||'<p class="muted">No email activity yet.</p>';
  $('#outbox-load-bar').hidden=!outboxItems.length;
  $('#outbox-count').textContent=outboxItems.length+' shown';
  $('#load-more-outbox').hidden=!outboxCursor;
}
async function renderOutbox({more=false,force=false}={}){
  if(!more&&!force&&outboxAt>Date.now()-30000)return;
  const epoch=workspaceEpoch,owner=me.email,request=++outboxRequest;
  const cursor=more?outboxCursor:null;
  if(more&&!cursor)return;
  const page=await api('/api/deliveries?limit='+(more?5:3)+(cursor?'&after='+encodeURIComponent(cursor):''));
  if(epoch!==workspaceEpoch||owner!==me.email||request!==outboxRequest)return;
  outboxItems=more?[...outboxItems,...page.entries]:page.entries;
  outboxCursor=page.next;
  outboxAt=Date.now();
  paintOutbox();
}
$('#load-more-outbox').onclick=event=>void run(event.currentTarget,()=>renderOutbox({more:true}));
$('#clear-account-data').onclick=e=>run(e.currentTarget,async()=>{
  if(!connected||!await storage.get('token'))throw new Error('Sign in to clear your account data.');
  workspaceEpoch++;timelineRequest++;timelineEntries=[];timelineCursor=null;timelineLoading=false;timelineStatus='';showView('overview');$('#opportunity-detail').replaceChildren();$('#passport-content').replaceChildren();for(const id of ['assistant-results','memory-content','heatmap-content','productivity-content'])$('#'+id).replaceChildren();answerEntries=[];$('#intelligence-content').replaceChildren();$('#risk-content').replaceChildren();$('#clear-data-status').textContent='Clearing…';
  try{await api('/api/account/clear-data','POST',{action:'clear-account-data'});workspaceEpoch++;for(const key of ['localTracks','localChanges','cachedTracks'])await storage.set(key,[]);await storage.set('pendingReview',null);tracks=[];localTracks=[];changes=[];priorities=[];overview={};openTracks.clear();outboxItems=[];outboxCursor=null;outboxAt=0;paintOutbox();if(draft)await closeDraft();await refresh();$('#clear-data-status').textContent='Account activity cleared. Your profile and Google connection are unchanged.';}catch(error){$('#clear-data-status').textContent=error.message;throw error;}
});
$('#watchlist-view').onclick=e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const id=button.closest('[data-track]').dataset.track,t=tracks.find(t=>t.id===id)||localTracks.find(t=>t.id===id);
  run(button,async()=>{
    switch(button.dataset.action){
      case 'expand':{const article=button.closest('[data-track]'),pane=article.querySelector('.track-details'),expanded=pane.hidden;pane.hidden=!expanded;article.classList.toggle('is-open',expanded);button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'Collapse':'Expand')+' milestones for '+t.title);if(expanded)openTracks.add(id);else openTracks.delete(id);break;}
      case 'check':if(t.local)await localCheck(t,button);else{const result=await api(`/api/tracks/${id}/check`,'POST',{});toast(result.status==='changed'?'A deadline changed. See the timeline.':result.status==='conflict'?'Sources disagree. Review the evidence.':result.status==='check_failed'?'Check failed. Your confirmed dates are kept.':result.status==='manual'?'This is a manual reminder. Use Manage to verify the source and enable automatic monitoring.':result.status==='date_missing'?'A tracked milestone is missing from the source. Your confirmed date is kept.':result.status==='needs_review'?'A source date needs your review. Open the tracked page card.':'Check complete.');if(isExtension)chrome.runtime.sendMessage({type:'surface-alerts'}).catch(()=>{});}await refresh();break;
      case 'calendar':case 'task':await googleDialog(t,button.dataset.action);break;
      case 'prepare-signup':await openBackup(new URLSearchParams({event:t.id}));break;
      case 'pin':await saveDashboard({pinnedIds:(dashboardPrefs.pinnedIds||[]).includes(id)?dashboardPrefs.pinnedIds.filter(x=>x!==id):[...(dashboardPrefs.pinnedIds||[]),id]});render();break;
      case 'manage':manageDialog(t);break;
      case 'resolve':resolveDialog(t,button.dataset.kind,+button.dataset.index,button.dataset.milestone);break;
      case 'sync':await api('/api/tracks','POST',{...t,milestones:t.milestones.map(m=>({...m,confirmed:true}))});localTracks=localTracks.filter(l=>l.id!==id);await storage.set('localTracks',localTracks);await refresh();toast('Synced to the persistent backend.');break;
    }
  });
};
let planningRequest=0,answerEntries=[],backupMount;
function mountBackup(){
  const target=$('#backup-embedded');
  if(!backupMount){
    target.textContent='Opening Backup Signup…';
    backupMount=(async()=>{
      const response=await fetch('/backup.html');
      if(!response.ok)throw Error('Could not load Backup Signup.');
      const markup=new DOMParser().parseFromString(await response.text(),'text/html');
      const editor=markup.querySelector('.backup-shell');
      if(!editor)throw Error('Backup Signup editor is unavailable.');
      editor.querySelector('.backup-header')?.remove();
      const section=document.createElement('section');
      section.className='backup-shell embedded-backup';
      section.append(...editor.childNodes);
      const stylesheet=document.createElement('link');
      stylesheet.rel='stylesheet';stylesheet.href='/backup.css?v=link-scan-1';
      document.head.append(stylesheet);
      target.replaceChildren(section);
      return await import('./backup.js?v=link-scan-1');
    })().catch(error=>{target.textContent=error.message;backupMount=null;});
  }
  return backupMount;
}

async function openBackup(target){
  showView('backup');
  const editor=await mountBackup();
  if(view==='backup')await editor?.openBackupTarget(target);
}
let followUp = null;
function setFollowUp(entry){
  const track=tracks.find(item=>item.id===entry?.trackId&&!item.cached);
  followUp=track?entry:null;
  const context=$('#assistant-context');
  context.hidden=!followUp;
  context.querySelector('span').textContent=track?'Continuing with '+track.title:'';
}
$('#assistant-new-topic').onclick=()=>{
  setFollowUp(null);
  $('#assistant-question').focus();
};
async function loadPlanning(name){
  const request=++planningRequest,epoch=workspaceEpoch;
  const target=$('#'+(name==='assistant'?'assistant-results':name+'-content'));
  const route={assistant:'/api/assistant/history',memory:'/api/assistant/memory',heatmap:'/api/productivity',productivity:'/api/productivity'}[name];
  target.textContent='Loading…';
  try{
    const data=await api(route);
    if(request!==planningRequest||epoch!==workspaceEpoch||view!==name)return;
    if(name==='assistant'){
      if(!$('#clear-assistant').disabled)answerEntries=data.entries;
      renderAnswers(target,answerEntries);
      setFollowUp(answerEntries[0]);
      $('#assistant-gemini').disabled=!data.geminiConfigured;
      $('#assistant-gemini').closest('label').hidden=!data.geminiConfigured;
      $('#assistant-availability').textContent=data.geminiConfigured
        ? 'When enabled, your question and verified public excerpts are sent to Gemini.'
        : 'Answers use your saved dates, changes, and application plans.';
    }else if(name==='memory')renderMemory(target,data.entries,esc,tracks.filter(track=>!track.cached));
    else if(name==='heatmap')renderHeatmap(target,data,esc);
    else renderProductivity(target,data,esc);
  }catch(error){if(request===planningRequest&&epoch===workspaceEpoch&&view===name)target.textContent=error.message;}
}
$('#suggested-questions').onclick=event=>{
  if(event.target.tagName!=='BUTTON')return;
  $('#assistant-question').value=event.target.textContent;
  $('#assistant-question').focus();
};
$('#assistant-form').onsubmit=event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector('[type=submit]');
  void run(button,async()=>{
    const epoch=workspaceEpoch, status=$('#assistant-status'), clear=$('#clear-assistant');
    if(clear.disabled)return;
    clear.disabled=true;
    status.textContent=$('#assistant-gemini').checked?'Checking your workspace and public sources…':'Checking your workspace…';
    try{
      const {answer,receipt}=await api('/api/assistant/answer','POST',{
        question:$('#assistant-question').value,previousId:followUp?.id,useGemini:!$('#assistant-gemini').disabled&&$('#assistant-gemini').checked
      });
      if(epoch!==workspaceEpoch)return;
      answerEntries=[answer,...answerEntries].slice(0,15);
      if(view==='assistant'){
        const results=$('#assistant-results');
        renderAnswers(results,answerEntries);
        results.querySelector('article')?.scrollIntoView({block:'nearest'});
      }
      $('#assistant-question').value='';
      $('#assistant-gemini').checked=false;
      try{const saved=await api('/api/assistant/history','PATCH',{action:'save',receipt});if(epoch===workspaceEpoch){answerEntries=saved.entries;setFollowUp(saved.entries[0]);}}
      catch{status.textContent='Answer shown. History could not be saved.';return;}
      status.textContent='';
    }catch(error){if(epoch===workspaceEpoch)status.textContent=error.message;}
    finally{clear.disabled=false;}
  });
};
$('#clear-assistant').onclick=event=>void run(event.currentTarget,async()=>{
  await api('/api/assistant/history','PATCH',{action:'clear'});
  answerEntries=[];setFollowUp(null);renderAnswers($('#assistant-results'),answerEntries);$('#assistant-status').textContent='History cleared.';
});
async function saveMemory(input){
  const epoch=workspaceEpoch,{entries}=await api('/api/assistant/memory','PATCH',input);
  if(epoch===workspaceEpoch&&view==='memory'){planningRequest++;renderMemory($('#memory-content'),entries,esc,tracks.filter(track=>!track.cached));}
}
$('#memory-content').addEventListener('submit',event=>{
  const form=event.target.closest('[data-scout-memory]');
  if(!form)return;
  event.preventDefault();
  void run(form.querySelector('[type=submit]'),()=>saveMemory({action:'save',id:form.dataset.id,...Object.fromEntries(new FormData(form)),pinned:form.elements.pinned.checked}));
});
$('#memory-content').addEventListener('click',event=>{
  const button=event.target.closest('[data-delete-memory]');
  if(button)void run(button,()=>saveMemory({action:'delete',id:button.dataset.deleteMemory}));
});

let passportRequest=0;
async function loadPassport(){
  const request=++passportRequest,epoch=workspaceEpoch,target=$('#passport-content');
  target.textContent='Loading passport…';
  try{
    const entries=await api('/api/application-passport');
    if(request===passportRequest&&epoch===workspaceEpoch)renderPassport(target,entries,esc);
  }catch(error){if(request===passportRequest&&epoch===workspaceEpoch)target.textContent=error.message;}
}
async function savePassport(input){
  const epoch=workspaceEpoch,entries=await api('/api/application-passport','PATCH',input);
  if(epoch===workspaceEpoch&&view==='passport'){passportRequest++;renderPassport($('#passport-content'),entries,esc);}
}
async function saveApplication(section,input){
  const id=section.dataset.workspaceId;
  await api('/api/opportunities/'+encodeURIComponent(id)+'/application','PATCH',input);
  await refresh();
  if(view==='opportunity'&&section.isConnected)await openOpportunity(id,{focus:false});
  toast('Application workspace saved.');
}
document.querySelector('main').addEventListener('submit',event=>{
  const form=event.target;
  if(form.matches('[data-scout-shortcut]')){
    event.preventDefault();
    showView('assistant');
    $('#assistant-question').value=$('#scout-overview-question').value.trim();
    $('#assistant-question').focus();
    return;
  }
  if(form.matches('[data-change-task]')){
    event.preventDefault();
    void run(form.querySelector('button[type=submit]'),async()=>{
      const {trackId,changeTask}=form.dataset;
      await api('/api/opportunities/'+encodeURIComponent(trackId)+'/changes/'+encodeURIComponent(changeTask),'PATCH',
        {action:'createTask',...Object.fromEntries(new FormData(form))});
      form.querySelector('[role=status]').textContent='Follow-up task saved in the application plan.';
      await refresh();
    });
  }
  if(form.matches('[data-passport-form]')){
    event.preventDefault();
    const values=Object.fromEntries(new FormData(form));
    void run(form.querySelector('[type=submit]'),()=>savePassport({action:'save',id:form.dataset.id,...values}));
  }
  if(form.matches('[data-application-action]')){
    event.preventDefault();
    const fields=new FormData(form),values=Object.fromEntries(fields);
    void run(form.querySelector('[type=submit]'),()=>saveApplication(form.closest('[data-workspace-id]'),{
      ...values,action:form.dataset.applicationAction,id:form.dataset.itemId,dependencies:fields.getAll('dependencies'),
      done:fields.has('done'),required:fields.has('required')
    }));
  }
});
document.querySelector('main').addEventListener('click',event=>{
  const jump=event.target.closest('[data-workspace-jump]');
  if(jump){
    const page=jump.dataset.workspaceJump;
    showView(page,{readinessTrack:jump.dataset.readinessTrack});
    if(jump.dataset.question){
      $('#assistant-question').value=jump.dataset.question;
      $('#assistant-question').focus();
    }else if(page==='watchlist'&&jump.hasAttribute('data-focus-scan'))$('#source-url').focus();
    return;
  }
  const copy=event.target.closest('[data-copy-answer]');
  if(copy){
    void run(copy,async()=>{
      await navigator.clipboard.writeText(copy.closest('details').querySelector('.library-preview').textContent);
      toast('Answer copied.');
    });
    return;
  }
  const removePassport=event.target.closest('[data-passport-remove]');
  if(removePassport){void run(removePassport,()=>savePassport({action:'remove',id:removePassport.dataset.passportRemove}));return;}
  const applicationAction=event.target.closest('[data-application-remove],[data-import-evidence]');
  if(applicationAction){
    const data=applicationAction.dataset;
    void run(applicationAction,()=>saveApplication(applicationAction.closest('[data-workspace-id]'),{
      action:data.applicationRemove||'importRequirement',id:data.itemId,evidence:data.importEvidence,sourceUrl:data.importUrl
    }));
    return;
  }

  const backupLink=event.target.closest('a[href^="/backup.html#"]');
  if(backupLink&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){
    event.preventDefault();
    void openBackup(new URLSearchParams(new URL(backupLink.href).hash.slice(1)));
    return;
  }
  const review=event.target.closest('[data-review-change]');
  if(review){
    void run(review,async()=>{
      await api('/api/opportunities/'+encodeURIComponent(review.dataset.trackId)+'/changes/'+encodeURIComponent(review.dataset.reviewChange),'PATCH',{reviewed:true});
      const card=review.closest('[data-reviewed]');
      card.dataset.reviewed='true';
      const badge=document.createElement('span');badge.className='badge';badge.textContent='Reviewed';review.replaceWith(badge);
      const filter=$('#intelligence-content [data-change-status]');
      if(filter.value==='open')filter.dispatchEvent(new Event('change'));
    });
    return;
  }
  if(event.target.closest('[data-reload-intelligence]')){void loadIntelligence(view);return;}
  const removeSource=event.target.closest('[data-remove-verification-source]');
  if(removeSource){
    const id=removeSource.dataset.trackId;
    void run(removeSource,async()=>{
      await api('/api/tracks/'+encodeURIComponent(id),'PATCH',{removeVerificationSource:removeSource.dataset.removeVerificationSource});
      await checkOpportunitySources(id);
    });
    return;
  }
  const check=event.target.closest('[data-check-opportunity]');
  if(check){
    const id=check.dataset.checkOpportunity;
    void run(check,()=>checkOpportunitySources(id));
    return;
  }

  const link=event.target.closest('a[data-opportunity]');
  if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  void openOpportunity(link.dataset.opportunity,{plan:link.hasAttribute('data-open-plan')});
});
async function checkOpportunitySources(id){
  toast('Checking the available evidence…');
  try{await api('/api/tracks/'+encodeURIComponent(id)+'/check','POST',{});}
  finally{await refresh();if(view==='opportunity'&&location.hash==='#opportunity='+encodeURIComponent(id))await openOpportunity(id,{focus:false});}
}
$('#opportunity-detail').addEventListener('submit',event=>{
  const form=event.target.closest('[data-add-verification-source]');
  if(!form)return;
  event.preventDefault();
  const id=form.dataset.trackId;
  void run(form.querySelector('button'),async()=>{
    await api('/api/tracks/'+encodeURIComponent(id),'PATCH',{verificationSource:new FormData(form).get('url')});
    await checkOpportunitySources(id);
  });
});
$('#find-event').addEventListener('input',()=>{
  if($('#find-event').value.trim()&&view!=='watchlist')showView('watchlist');
});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{showView(button.dataset.view);});
document.querySelector('.workspace-navigation>.brand').onclick=event=>{
  event.preventDefault();
  showView('overview');
};
function openProfileSettings(){showView('settings');}
$('#profile-settings').onclick=openProfileSettings;
function cancelProfileName(){profileNameEditing=false;profileNameDirty=false;$('#profile-name-status').textContent='';render();$('#edit-profile-name').focus();}
$('#edit-profile-name').onclick=()=>{profileNameEditing=true;profileNameDirty=false;$('#profile-name').value=me.displayName||'';$('#profile-name-status').textContent='';render();$('#profile-name').focus();};
$('#cancel-profile-name').onclick=cancelProfileName;
function extensionMessage(extensionId,message){
  return new Promise((resolve,reject)=>{
    if(!globalThis.chrome?.runtime?.sendMessage){reject(new Error('Open this page in the browser where you installed Deadline Scout, then reload the extension and choose Set up background alerts.'));return;}
    const timer=setTimeout(()=>reject(new Error('The extension did not respond. Reload the Deadline Scout extension and try setup again.')),20000);
    try{chrome.runtime.sendMessage(extensionId,message,response=>{clearTimeout(timer);const error=chrome.runtime.lastError;if(error||!response?.ok)reject(new Error(response?.error||'Reload the Deadline Scout extension, then choose Set up background alerts again.'));else resolve(response);});}catch(error){clearTimeout(timer);reject(error);}
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
$('#test-background-alert').onclick=e=>run(e.currentTarget,async()=>{const id=await storage.get('backgroundExtensionId');await extensionMessage(id,{type:'scout-alerts-test'});$('#background-alerts-status').textContent='Test sent. Check your browser and system notification settings if no banner appears.';});
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
async function signOut(){workspaceEpoch++;timelineRequest++;timelineEntries=[];timelineCursor=null;timelineLoading=false;timelineStatus='';showView('overview');$('#opportunity-detail').replaceChildren();$('#passport-content').replaceChildren();for(const id of ['assistant-results','memory-content','heatmap-content','productivity-content'])$('#'+id).replaceChildren();answerEntries=[];$('#intelligence-content').replaceChildren();$('#risk-content').replaceChildren();try{await api('/api/logout','POST',{});}finally{await storage.set('token',null);tracks=[];changes=[];priorities=[];me={};await storage.set('cachedTracks',[]);location.replace('/');}}
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
$('#source-url').placeholder='Paste a public page link';
$('#inspect-url').textContent='Find';
$('#inspect-url').style.fontSize='.8rem';
updateCaptureAction();
$('#source-url').onkeydown=e=>{if(e.key==='Enter'){$('#track-active').click();}};
$('#manual-start').onclick=()=>{const url=$('#source-url').value.trim();if(!/^https?:\/\//i.test(url)){toast('Paste the original page URL first, then enter its date manually.');$('#source-url').focus();return;}draft={url,title:'My tracked page',sources:[url],links:[],milestones:[manualMilestone(url)],monitoring:false};renderDraft();};
$('#close-dialog').onclick=closeDialog;
$('#connect-google').onclick=e=>run(e.currentTarget,async()=>{await signIn();toast('Google connected.');});
$('#disconnect-google').onclick=e=>run(e.currentTarget,async()=>{await api('/api/google/disconnect','POST',{});await refresh();});
function websiteNotification(title,body,tag,url){
  if(!('Notification' in window)||Notification.permission!=='granted')throw new Error('Allow notifications for Deadline Scout in your browser’s site permissions.');
  return new Promise((resolve,reject)=>{const notification=new Notification(title,{body,icon:'/icon128.png',tag});const timer=setTimeout(()=>reject(new Error('No notification confirmation received. Check your browser and system notification settings.')),15000);notification.onshow=()=>{clearTimeout(timer);resolve();};notification.onerror=()=>{clearTimeout(timer);reject(new Error('The browser could not show the notification. Check your browser and system notification settings.'));};notification.onclick=()=>{window.focus();if(url&&new URL(url).origin===location.origin)location.assign(url);else showView('timeline');notification.close();};});
}
async function surfaceWebsiteAlerts(){
  if(document.visibilityState!=='visible'||isExtension||webAlertsBusy||!connected||!me.email||!('Notification' in window)||Notification.permission!=='granted'||!await storage.get('webAlerts:'+me.email))return;
  webAlertsBusy=true;try{await deliverBrowserAlerts({load:()=>api('/api/alerts'),notify:alert=>{if(alert.notice)return websiteNotification(alert.notice.title+': '+alert.notice.label,alert.notice.message,alert.id,alert.notice.url);const c=alert.change;return websiteNotification(c.title+': '+c.label,c.before.date+' → '+c.after.date+'\n'+c.impact,alert.id);},ack:id=>api('/api/alerts/ack','POST',{id})});$('#browser-alerts-status').textContent='Website alerts connected. Keep this page open.';}catch(error){$('#browser-alerts-status').textContent=error.message;}finally{webAlertsBusy=false;}
}
$('#browser-alerts').onchange=e=>run(null,async()=>{
  const wanted=e.target.checked;$('#browser-alerts-status').textContent='';try{
    if(isExtension){
      if(wanted){await enableExtensionAlerts({browser:chrome,validateSession:()=>api('/api/me'),signIn:connectGoogle});await refresh();await chrome.runtime.sendMessage({type:'surface-alerts'});$('#browser-alerts-status').textContent='Background alerts connected to '+me.email+'.';
      }else{await chrome.permissions.remove({permissions:['notifications']});$('#browser-alerts-status').textContent='Background alerts turned off.';}
    }else{
      if(wanted){if(!me.email)throw new Error('Sign in before enabling browser alerts.');if(!('Notification' in window))throw new Error('This browser does not support desktop notifications.');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications were not allowed. Open your browser’s site permissions for Deadline Scout and allow notifications.');}
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
$('#test-email').onclick=e=>run(e.currentTarget,async()=>{const d=await api('/api/email/test','POST',{});toast(d.label);await renderOutbox({force:true});});
$('#save-backend').onclick=e=>run(e.currentTarget,async()=>{
  const u=new URL($('#backend-url').value);if(!['https:','http:'].includes(u.protocol)||u.pathname!=='/'||u.username||u.password)throw new Error('Enter a backend origin, such as https://api.example.com.');
  if(u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw new Error('Hosted backends require HTTPS.');
  if(isExtension&&!await chrome.permissions.request({origins:[u.origin+'/*']}))throw new Error('Backend access was not granted.');
  await storage.set('settings',{backendUrl:u.origin});await storage.set('token',null);await refresh();toast('Backend connection saved.');
});
$('#apply-demo').onclick=e=>run(e.currentTarget,async()=>{await api('/api/demo','POST',{mode:$('#demo-mode').value});toast('Fictional source updated. Use Check now on your demo registration.');});
$('#refresh-outbox').onclick=e=>run(e.currentTarget,()=>renderOutbox({force:true}));
$('#sign-out').onclick=e=>run(e.currentTarget,async()=>{await signOut();toast('Signed out.');});
async function openCapturedReview(token){
  trackingStatus('Opening the dates found by your extension…');
  const captured=await api('/api/captures/'+encodeURIComponent(token));
  history.replaceState(null,'',location.pathname);
  const preview=mergeCapturedMilestones(captured.milestones,null).map(m=>({...m,confirmed:false,detected:{time:m.time??null,zone:m.zone??null}}));
  const current={url:captured.url,title:captured.title,sources:[captured.url],links:captured.links||[],verifying:true,monitoring:false,milestones:preview.length?preview:[manualMilestone(captured.url)]};
  current.catalog=structuredClone(current.milestones);draft=current;renderDraft();
  // Show the extension's evidence first. Re-reading a rendered source can be slow.
  let serverPage=null;try{serverPage=await api('/api/inspect','POST',{url:captured.url,summary:true});}catch{/* Preserve captured evidence if source verification fails. */}
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
export async function startDashboard(initial){
  const fragment=new URLSearchParams(location.hash.slice(1));
  config=initial.config;connected=true;
  const captureReview=fragment.has('capture')?run(null,()=>openCapturedReview(fragment.get('capture'))):null;
  const inspectReview=fragment.has('inspect')?run(null,async()=>{
    const url=fragment.get('inspect');
    history.replaceState(null,'',location.pathname);
    $('#source-url').value=url;
    await inspect(url);
  }):null;
  await refresh(initial);
  void surfaceWebsiteAlerts();
  if(captureReview)await captureReview;
  else if(fragment.has('alerts-setup')){const flow={extensionId:fragment.get('alerts-setup'),state:fragment.get('state'),challenge:fragment.get('challenge'),expires:Date.now()+600000};history.replaceState(null,'',location.pathname);await storage.set('pendingBackgroundSetup',flow);await finishBackgroundSetup(flow);}
  else if(inspectReview)await inspectReview;
  else {const setup=await storage.get('pendingBackgroundSetup');if(setup&&setup.expires>Date.now())await finishBackgroundSetup(setup);else{const pending=await storage.get('pendingReview');if(pending){draft=pending;renderDraft();}if(['#settings','#timeline','#watchlist'].includes(location.hash))showView(location.hash.slice(1));else if(fragment.has('opportunity'))await openOpportunity(fragment.get('opportunity'),{focus:false});}}
}
let refreshing=false;
async function refreshVisibleWorkspace(){
  if(refreshing||document.visibilityState!=='visible'||draft||document.activeElement?.id==='scout-overview-question'||$('#action-dialog').open||!['overview','watchlist','timeline','applications'].includes(view))return;
  refreshing=true;try{await refresh();}finally{refreshing=false;}
}
setInterval(()=>void refreshVisibleWorkspace(),60000);
setInterval(()=>void surfaceWebsiteAlerts(),30000);
document.addEventListener('visibilitychange',()=>{
  void refreshVisibleWorkspace();
  void surfaceWebsiteAlerts();
});
