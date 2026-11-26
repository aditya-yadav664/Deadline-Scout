import {api,storage,connectGoogle} from './api.js';
import './shared/signup-success-notices.js';
import {suggestField,validateFiles,validateAnswer,selectedChoices} from './shared/signup.js';
import {isLegacyGoogleCapture,sameSignupForm} from './shared/google-forms.js';
import {instant,validDate} from './shared/dates.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let liveExtensionId=null;
window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.type==='deadline-scout-extension-ready'&&/^[a-p]{32}$/.test(event.data.extensionId)){liveExtensionId=event.data.extensionId;}});
window.postMessage({type:'deadline-scout-find-extension'},location.origin);
let me={},tracks=[],drafts=[],profile={links:[]},editing=null,captured=null,epoch=0,busy=false,stage=1,lastDeletedId=null,answersDirty=false,targetEvent=null;
function status(message){
  const inEditor=!$('#signup-editor').hidden;
  $('#backup-feedback').textContent=inEditor?'':message;
  $('#signup-feedback').textContent=inEditor?message:'';
}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>{if(b.id!=='close-signup'){b.dataset.wasDisabled=b.disabled?'1':'0';b.disabled=true;}});try{await fn();}catch(e){status(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>{if(b.dataset.wasDisabled!==undefined){b.disabled=b.dataset.wasDisabled==='1';delete b.dataset.wasDisabled;}});}}
function links(){return [...$('#saved-links').children].map(row=>({kind:row.querySelector('select').value,name:row.querySelector('[name=link-name]').value,url:row.querySelector('[name=link-url]').value})).filter(l=>l.url);}
function addLink(l={}){const row=document.createElement('div');row.className='link-row';row.innerHTML=`<select aria-label="Link type">${['github','repository','portfolio','video','deck'].map(k=>`<option ${l.kind===k?'selected':''}>${k}</option>`).join('')}</select><input name="link-name" aria-label="Link name" placeholder="Link name" value="${esc(l.name)}"><input name="link-url" type="url" aria-label="Saved URL" placeholder="https://" value="${esc(l.url)}"><button type="button" class="text-button">Remove link</button>`;row.querySelector('button').onclick=()=>row.remove();$('#saved-links').append(row);}
$('#add-link').onclick=()=>addLink();
$('#signup-profile').onsubmit=e=>{e.preventDefault();action(async()=>{const f=new FormData(e.currentTarget);profile=await api('/api/signup-profile','POST',{name:f.get('name'),phone:f.get('phone'),college:f.get('college'),links:links()});status('Signup profile saved. Armed snapshots are unchanged.');});};

function suggestStep(step){
 const {capturedAnswers={},...schema}=step;
 const draft={...schema,answers:{},sources:{},files:{},sharing:{}};
 for(const field of schema.fields){
  const captured=Object.hasOwn(capturedAnswers,field.key)?capturedAnswers[field.key]:'';
  const hint=captured?{value:captured,source:'Captured from form'}:suggestField(field,{...profile,email:me.email},profile.links);
  draft.answers[field.key]=hint.value;draft.sources[field.key]=hint.source;
 }
 return draft;
}
async function refresh(){({me,tracks}=await api('/api/workspace'));[drafts,profile]=await Promise.all([api('/api/signups'),api('/api/signup-profile')]);$('#backup-account').textContent=me.email?'Your Google account is connected.':'';for(const k of ['name','phone','college'])$('#signup-profile').elements[k].value=profile[k]||(k==='name'?me.displayName:'');$('#saved-links').innerHTML='';profile.links.forEach(addLink);paintList();groupDraftCards();}
function showStage(n){stage=n;for(let i=1;i<=3;i++){$('#stage-'+i).hidden=i!==n;const stepButton=$('#flow-'+i);stepButton.classList.toggle('current',i===n);if(i===n)stepButton.setAttribute('aria-current','step');else stepButton.removeAttribute('aria-current');}$('#signup-feedback').textContent='';if(n===3){previewTime();showPickerFiles(editing);}}
function filterDrafts(){
  const query=$('#draft-search').value.trim().toLowerCase();
  let visible=0;
  for(const group of $('#signup-list').querySelectorAll('.signup-event-group')){
    for(const card of group.querySelectorAll('[data-draft]')){
      card.hidden=!card.dataset.search.includes(query);
      if(!card.hidden)visible++;
    }
    group.hidden=!group.querySelector('[data-draft]:not([hidden])');
  }
  $('#draft-no-results').hidden=!drafts.length||visible>0;
}
$('#draft-search').addEventListener('input',filterDrafts);
function paintList(){
  const box=$('#signup-list');
  const expanded=new Set([...box.querySelectorAll('[data-draft] details[open]')].map(item=>item.closest('[data-draft]').dataset.draft));
  $('#draft-count').textContent=drafts.length;
  box.innerHTML=drafts.map(d=>{
    const track=tracks.find(t=>t.id===d.trackId);
    const tone=/needs review|waiting for browser|cancelled/i.test(d.status)?'attention':'normal';
    const search=[d.title,d.status,track?.title].join(' ').toLowerCase();
    return `<article class="signup-row" data-draft="${esc(d.id)}" data-search="${esc(search)}">
      <div class="signup-row-head"><h3>${esc(d.title)}</h3><span class="badge" data-tone="${tone}">${esc(d.status)}</span></div>
      ${d.notice?`<p>${esc(d.notice)}</p>`:''}
      <div class="backup-actions">
        <button class="button secondary" data-open="${esc(d.id)}">Open signup →</button>
        <button class="text-button backup-danger" data-delete="${esc(d.id)}">Delete draft</button>
      </div>
      <details class="backup-details draft-form-steps" ${expanded.has(d.id)?'open':''}>
        <summary>Captured pages (${d.steps.length})</summary>
        <ol class="draft-step-order">${d.steps.map((step,i)=>`<li><span>Step ${i+1} · ${esc(step.title||'Form page')}<small>${esc(step.url)}</small></span>
          <button type="button" data-move="${i}" data-dir="-1" aria-label="Move step ${i+1} up" ${i===0?'disabled':''}>↑</button>
          <button type="button" data-move="${i}" data-dir="1" aria-label="Move step ${i+1} down" ${i===d.steps.length-1?'disabled':''}>↓</button></li>`).join('')}</ol>
      </details>
    </article>`;
  }).join('')||'<p class="draft-empty">No saved signups yet. Open a form and choose <strong>Prepare signup</strong> in the extension.</p>';
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>action(async()=>{
    const openEpoch=++epoch,d=await api('/api/signups/'+b.dataset.open);
    if(openEpoch!==epoch)return;
    showStage(d.reviewedAll?3:1);openDraft(d);
    $('#signup-title').focus({preventScroll:true});
  }));
  box.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>action(async()=>{
    const id=b.dataset.delete;
    await api('/api/signups/'+id,'DELETE');lastDeletedId=id;
    if(editing?.id===id)closeEditor();
    await refresh();$('#undo-delete').hidden=false;
    status('Draft deleted. Its backup is stopped. You can undo this deletion.');
  }));
  box.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>action(async()=>{
    const d=drafts.find(d=>d.id===b.closest('[data-draft]').dataset.draft);
    const order=d.steps.map((_,i)=>i),from=+b.dataset.move,to=from + +b.dataset.dir;
    [order[from],order[to]]=[order[to],order[from]];
    await api('/api/signups/'+d.id+'/reorder','POST',{order,revision:d.revision||0});
    await refresh();status('Step order saved. Review the answers before turning the backup on again.');
  }));
}
function groupDraftCards(){const box=$('#signup-list'),cards=[...box.querySelectorAll('[data-draft]')];if(!cards.length){filterDrafts();return;}const grouped=new Map();for(const d of drafts){if(!grouped.has(d.trackId))grouped.set(d.trackId,[]);grouped.get(d.trackId).push(d);}const fragment=document.createDocumentFragment();for(const [trackId,items]of grouped){const section=document.createElement('section');section.className='signup-event-group';const h=document.createElement('h3');h.textContent=tracks.find(t=>t.id===trackId)?.title||'Event no longer tracked';section.append(h);for(const d of items){const card=cards.find(c=>c.dataset.draft===d.id);if(card)section.append(card);}fragment.append(section);}box.replaceChildren(fragment);filterDrafts();}
const NEW_EVENT='new-custom-event';
function readEditor(){
  if(!editing)return;
  const title=$('#signup-name').value;
  const track=$('#signup-track').value;
  const trackId=track===NEW_EVENT?'':track;
  if(editing.id&&(editing.title!==title||editing.trackId!==trackId)){
    answersDirty=true;
    editing.reviewedAll=false;
  }
  editing.title=title;
  editing.trackId=trackId;
  $('#signup-steps').querySelectorAll('[data-step]').forEach(box=>{
    const step=editing.steps[+box.dataset.step];
    for(const input of box.querySelectorAll('[data-key]')){
      step.answers[input.dataset.key]=input.value;
      if(input.dataset.edited)step.sources[input.dataset.key]='Enter manually';
    }
    for(const group of box.querySelectorAll('[data-choice-key]')){
      const key=group.dataset.choiceKey;
      const checked=[...group.querySelectorAll('input:checked')].map(input=>input.value);
      step.answers[key]=group.dataset.multiple==='true'?JSON.stringify(checked):checked[0]||'';
      if(group.dataset.edited)step.sources[key]='Enter manually';
    }
  });
}
function renderAnswer(f,value){
  const key=esc(f.key);
  if(f.type==='file')return `<input type="file" data-file="${key}" ${f.multiple?'multiple':''} accept="${esc(f.accept)}">`;
  if(f.type==='textarea')return `<textarea data-key="${key}" rows="3">${esc(value)}</textarea>`;
  if(f.options?.length)return `<select data-key="${key}"><option value="">Choose an answer</option>${f.options.map(o=>`<option value="${esc(o.value)}" ${o.value===value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
  const type=['email','url','tel','date','number'].includes(f.type)?f.type:'text';
  return `<input data-key="${key}" type="${type}" value="${esc(value)}">`;
}
function renderChoices(f,value,stepIndex){
  const multiple=f.type==='checkbox';
  const selected=multiple?selectedChoices(value)||[]:[value];
  const options=multiple||f.required?f.options:[...f.options,{value:'',label:'No answer'}];
  const limit=f.maxChoices;
  const rule=f.minChoices===limit&&limit!==undefined?'Choose exactly '+limit:f.minChoices!==undefined&&limit!==undefined?'Choose '+f.minChoices+' to '+limit:limit!==undefined?'Choose up to '+limit:f.minChoices!==undefined?'Choose at least '+f.minChoices:'';
  return `<fieldset class="answer-choices" data-choice-key="${esc(f.key)}" data-multiple="${multiple}" ${limit===undefined?'':`data-max-choices="${limit}"`}>
    <legend>${esc(f.label)}${f.required?' *':''}</legend>
    ${rule?`<small class="choice-rule">${esc(rule)}.</small>`:''}
    ${options.map(o=>`<label class="answer-option"><input type="${multiple?'checkbox':'radio'}" name="choice-${stepIndex}-${esc(f.key)}" value="${esc(o.value)}" ${selected.includes(o.value)?'checked':''}><span>${esc(o.label)}</span></label>`).join('')}
  </fieldset>`;
}
function showCustomEventFields(){
  const show=$('#signup-track').value===NEW_EVENT;
  $('#custom-event-fields').hidden=!show;
  if(show&&!$('#custom-event-name').value)$('#custom-event-name').value=$('#signup-name').value.trim();
  milestoneOptions();previewTime();
}
async function ensureDraftEvent(){
  if(editing.trackId)return;
  if($('#signup-track').value!==NEW_EVENT)throw Error('Choose an event or create one for this signup.');
  const title=$('#custom-event-name').value.trim();
  const date=$('#custom-event-date').value;
  if(!title||!validDate(date))throw Error('Enter an event name and a deadline date.');
  const url=editing.formUrl;
  const draft=editing;
  const track=await api('/api/tracks','POST',{url,title,milestones:[{kind:'custom',label:'Signup deadline',date,manual:true,confirmed:true,sourceUrl:url}]});
  if(editing!==draft)throw Error('Reopen the signup to choose the new event.');
  tracks=[...tracks.filter(item=>item.id!==track.id),track];
  $('#signup-track').append(new Option(track.title,track.id));
  $('#signup-track').value=track.id;
  editing.trackId=track.id;
  showCustomEventFields();
}
function milestoneOptions(){const track=tracks.find(t=>t.id===$('#signup-track').value);$('#signup-milestone').innerHTML=(track?.milestones||[]).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.label)+' · '+esc(m.date)+'</option>').join('');if(editing?.milestoneId)$('#signup-milestone').value=editing.milestoneId;if(!$('#signup-milestone').value&&track?.milestones.length)$('#signup-milestone').selectedIndex=0;}
function previewTime(){$('#offset-label').hidden=$('#signup-rule').value!=='relative';$('#time-label').hidden=$('#signup-rule').value!=='fixed';try{const m=tracks.find(t=>t.id===$('#signup-track').value)?.milestones.find(m=>m.id===$('#signup-milestone').value);const ms=$('#signup-rule').value==='relative'&&m?(m.time?Date.parse(instant(m)):Date.parse(m.date+'T23:59:00+05:30'))-Number($('#signup-offset').value)*60000:+new Date($('#signup-time').value);$('#backup-exact-time').textContent=Number.isFinite(ms)?'Backup time: '+new Date(ms).toLocaleString()+' ('+Intl.DateTimeFormat().resolvedOptions().timeZone+')':'Choose a deadline and time.';}catch(e){$('#backup-exact-time').textContent=e.message;}}
$('#signup-rule').onchange=previewTime;$('#signup-offset').oninput=previewTime;$('#signup-time').onchange=previewTime;$('#signup-milestone').onchange=previewTime;$('#signup-track').onchange=showCustomEventFields;
function openDraft(d){editing=d;$('#signup-editor').hidden=false;$('#backup-feedback').textContent='';$('#signup-title').textContent=d.id?d.title:'Prepare your signup';$('#signup-name').value=d.title;$('#signup-track').innerHTML='<option value="">Choose an event</option>'+tracks.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.title)+'</option>').join('')+'<option value="'+NEW_EVENT+'">+ Create a custom event</option>';$('#signup-track').value=d.trackId||(tracks.length===1?tracks[0].id:tracks.length?'':NEW_EVENT);$('#custom-event-name').value='';$('#custom-event-date').value='';showCustomEventFields();answersDirty=false;$('#signup-destination').textContent=d.steps.length+' captured step(s) · '+d.formUrl;
 $('#signup-steps').innerHTML=d.steps.map((step,i)=>`<fieldset data-step="${i}"><legend>Captured step ${i+1} · ${esc(step.title)}</legend><p>${esc(step.url)} · ${esc(step.capturedAt)}</p><p>Terms snapshot: ${esc(step.terms||'No terms text detected; review on the site.')}</p>${isLegacyGoogleCapture(step)?'<p class="error-list">Older Google Forms capture. If you have recaptured this page, remove this copy before saving.</p>':[...new Set(step.warnings||[])].map(w=>`<p class="error-list">${esc(w)}</p>`).join('')}${d.steps.length>1?`<button type="button" class="text-button backup-danger" data-remove-step="${i}">Remove captured page</button>`:''}${step.fields.map(f=>{const value=step.answers?.[f.key]||'';return `<div class="field-review">${(f.type==='checkbox'||f.type==='radio')&&f.options?.length?renderChoices(f,value,i):`<label>${esc(f.label)}${f.required?' *':''}${renderAnswer(f,value)}</label>`}<small>Source: ${esc(step.sources?.[f.key]||'Enter manually')}\n${esc(f.help||'')}${f.type==='file'?'\nFormats: '+(f.accept||'unknown')+' · Max size: '+(f.maxBytes?f.maxBytes+' bytes':'unknown')+' · Count: '+(f.multiple?'multiple; exact maximum unknown':'1'):''}</small>${f.type==='file'?`<div class="file-state" data-files="${esc(f.key)}">${(step.files?.[f.key]||[]).map(file=>esc(file.name)+' · '+file.size+' bytes · '+esc(file.type)+' · '+(file.id?(f.manualUpload?'Saved PDF · attaches when the form supports it':'Saved PDF · ready for autofill'):'Manual attachment pending')).join('<br>')||(f.manualUpload?'Choose a PDF to save it with this draft. Some upload controls need manual attachment.':'No file chosen. Manual attachment pending.')}</div>`:''}</div>`;}).join('')}</fieldset>`).join('');
 $('#signup-steps').querySelectorAll('[data-step]').forEach(box=>{const step=editing.steps[+box.dataset.step];for(const field of step.fields){const input=[...box.querySelectorAll('[data-key]')].find(n=>n.dataset.key===field.key);if(!input)continue;const suggestion=suggestField(field,{...profile,email:me.email},profile.links);if(suggestion.choices?.length){const choose=document.createElement('select');choose.setAttribute('aria-label','Saved link for '+field.label);choose.innerHTML='<option value="">Choose a saved link</option>'+suggestion.choices.map(l=>'<option value="'+esc(l.url)+'">'+esc(l.name||l.kind)+' · '+esc(l.url)+'</option>').join('');choose.onchange=()=>{input.value=choose.value;delete input.dataset.edited;step.sources[field.key]='Saved link';answersDirty=true;editing.reviewedAll=false;};input.after(choose);}if(/anyone with (?:the )?link|publicly (?:viewable|accessible)/i.test(field.help||'')){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!step.sharing?.[field.key];check.onchange=()=>{step.sharing||={};step.sharing[field.key]=check.checked;answersDirty=true;editing.reviewedAll=false;};label.append(check,document.createTextNode('I confirmed the required sharing access for this link.'));input.after(label);}}});
 $('#signup-steps').querySelectorAll('[data-remove-step]').forEach(button=>button.onclick=()=>{
  readEditor();
  editing.steps.splice(Number(button.dataset.removeStep),1);
  editing.formUrl=editing.steps[0].url;
  editing.reviewedAll=false;
  openDraft(editing);answersDirty=true;
  status('Page removed from this draft. Save your answers to keep the change.');
 });
 $('#signup-steps').querySelectorAll('[data-choice-key]').forEach(group=>{
  const updateLimit=()=>{
   if(group.dataset.maxChoices===undefined)return;
   const full=group.querySelectorAll('input:checked').length>=Number(group.dataset.maxChoices);
   for(const option of group.querySelectorAll('input'))option.disabled=full&&!option.checked;
  };
  updateLimit();
  group.onchange=()=>{updateLimit();group.dataset.edited='true';answersDirty=true;editing.reviewedAll=false;};
 });
 $('#signup-steps').querySelectorAll('[data-key]').forEach(input=>input.oninput=()=>{input.dataset.edited='true';answersDirty=true;editing.reviewedAll=false;});
 $('#signup-steps').querySelectorAll('input[type=file]').forEach(input=>input.onchange=()=>action(async()=>{const fileEpoch=epoch;readEditor();const step=editing.steps[+input.closest('[data-step]').dataset.step],field=step.fields.find(f=>f.key===input.dataset.file),files=[...input.files],meta=files.map(f=>({name:f.name,size:f.size,type:f.type}));const err=validateFiles(field,meta);if(err)throw Error(field.label+': '+err);step.files[field.key]=[];for(const [i,file]of files.entries()){
  if(file.name.toLowerCase().endsWith('.pdf')){const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length>2*1024*1024)throw Error('Saved PDF limit: 2 MB');let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);step.files[field.key].push(await api('/api/signup-files','POST',{name:file.name,data:btoa(binary)}));}else step.files[field.key].push(meta[i]);
 }if(fileEpoch!==epoch)return;editing.reviewedAll=false;openDraft(editing);answersDirty=true;status(field.manualUpload?'File saved. Save & continue to approve this PDF for autofill.':'File saved. Save & continue to approve this exact PDF for attachment. Other file types need manual attachment.');}));

$('#submit-demo-now').hidden=d.formUrl!==location.origin+'/signup-demo.html';$('#signup-mode').value=d.mode||'reminder';$('#signup-rule').value=d.rule||'relative';$('#signup-offset').value=d.offsetMinutes??15;const time=new Date(d.backupAt&&d.backupAt>Date.now()?d.backupAt:Date.now()+3600000);$('#signup-time').value=new Date(+time-time.getTimezoneOffset()*60000).toISOString().slice(0,16);$('#saved-draft-actions').hidden=!d.id;$('#resume-instructions').textContent='On the form, open the extension, select a captured step and choose Restore approved answers. Saved PDFs can attach to matching file inputs. Complete upload pickers, sign-in and consent on the form.';showStage(stage);$('#signup-editor').scrollIntoView({block:'start',behavior:'instant'});}
function showPickerFiles(draft){
 const panel=$('#signup-picker-files');
 panel.replaceChildren();
 const questions=(draft?.steps||[]).flatMap(step=>step.fields.filter(field=>field.type==='file'&&field.manualUpload)
  .map(field=>({label:field.label,files:(step.files?.[field.key]||[]).filter(file=>file.id)})));
 panel.hidden=!questions.length;
 if(panel.hidden)return;
 const help=document.createElement('p');
 help.textContent='Deadline Scout tries to attach your saved PDF through Google’s picker. If the form does not confirm it, download the PDF here and choose it under Add file.';
 panel.append(help);
 if(!draft.reviewedAll)return;
 const buttons=document.createElement('div');
 buttons.className='backup-actions';
 for(const {label,files} of questions)for(const file of files){
  const button=document.createElement('button');
  button.type='button';
  button.className='button secondary';
  button.textContent='Download '+file.name;
  button.setAttribute('aria-label','Download '+file.name+' for '+label);
  button.onclick=()=>action(async()=>{
   const current=await reviewedDraft();
   if(!current)return;
   const saved=await api('/api/signups/'+current.id+'/files/'+file.id);
   const bytes=Uint8Array.from(atob(saved.data),c=>c.charCodeAt(0));
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
   const download=document.createElement('a');
   download.href=url;
   download.download=saved.name;
   download.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  buttons.append(button);
 }
 panel.append(buttons);
}
function closeEditor(){epoch++;editing=null;$('#signup-editor').hidden=true;$('#signup-list').scrollIntoView({block:'start',behavior:'instant'});status('Editor closed.');}
$('#close-signup').onclick=closeEditor;
for(let i=1;i<=3;i++)$('#flow-'+i).onclick=()=>{readEditor();if(stage===2&&answersDirty){status('Save your answers before leaving Review answers.');return;}if(i>1&&!tracks.some(t=>t.id===$('#signup-track').value)){showStage(1);status('Choose an event or use Continue to answers to create one.');return;}if(i===3&&!editing.reviewedAll){showStage(2);status('Save answers in Review answers before setting a backup.');return;}showStage(i);};

$('#next-review').onclick=()=>action(async()=>{const saved=await saveDraft(false);if(saved){showStage(2);openDraft(saved);status('Captured page saved. Review the answers below; you can add the next form page later.');}});$('#back-event').onclick=()=>{$('#flow-1').onclick();};$('#back-answers').onclick=()=>{readEditor();showStage(2);};
function updateSavedDraft(saved){
 drafts=drafts.some(d=>d.id===saved.id)?drafts.map(d=>d.id===saved.id?saved:d):[...drafts,saved];
 paintList();groupDraftCards();
}
async function saveDraft(requireReview){
 readEditor();
 const token=epoch;
 if(requireReview){for(const s of editing.steps)for(const f of s.fields){
  const error=f.type==='file'?validateFiles(f,s.files?.[f.key]||[]):validateAnswer(f,s.answers?.[f.key]);
  if(error)throw Error(f.label+': '+error);
 }}
 await ensureDraftEvent();
 if(token!==epoch)return null;
 const saved=await api('/api/signups','POST',{...editing,reviewedAll:requireReview});
 if(token===epoch){editing=saved;answersDirty=false;}
 updateSavedDraft(saved);
 return token===epoch?saved:null;
}
async function reviewedDraft(){
 if(!editing?.id||answersDirty||!editing.reviewedAll){
  showStage(2);
  throw Error('Save & continue in Review answers first.');
 }
 const token=epoch;
 const current=await api('/api/signups/'+editing.id);
 if(token!==epoch)return null;
 if(!current.reviewedAll||current.revision!==editing.revision){
  showStage(2);openDraft(current);
  throw Error('The saved draft changed. Review the latest answers and click Save & continue.');
 }
 return current;
}
$('#draft-form').onsubmit=e=>{e.preventDefault();action(async()=>{const saved=await saveDraft(true);if(saved){showStage(3);openDraft(saved);status('Answers saved. Choose when to send your backup reminder.');}});};
$('#save-progress').onclick=()=>action(async()=>{const saved=await saveDraft(false);if(saved){openDraft(saved);status('Progress saved. You can return to finish the answers later.');}});
async function connectScheduledSignup(d){
 const extensionId=liveExtensionId||d.extensionId||await storage.get('backgroundExtensionId');
 if(!extensionId||!globalThis.chrome?.runtime?.sendMessage)throw Error('Reload the Deadline Scout extension, then reload this page.');
 const grant=await api('/api/signups/'+d.id+'/browser-session','POST',{});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Extension did not respond. Reload it and try again.')),10000);chrome.runtime.sendMessage(extensionId,{type:'scout-signup-schedule',...grant,formUrl:d.formUrl},reply=>{clearTimeout(timer);if(chrome.runtime.lastError||!reply?.ok)reject(Error(reply?.error||'Reload the extension and try again.'));else resolve(reply);});});
}
async function armBrowserSignup(immediate=false){
 const saved=await reviewedDraft();if(!saved)return;
 const timing=immediate?{mode:'browser-auto',runNow:true}:{
  mode:$('#signup-mode').value,rule:$('#signup-rule').value,
  offsetMinutes:+$('#signup-offset').value,backupAt:+new Date($('#signup-time').value),
 };
 const token=epoch,d=await api('/api/signups/'+saved.id+'/arm','POST',{approved:true,revision:saved.revision,milestoneId:$('#signup-milestone').value,...timing});
 if(token===epoch)editing=d;
 if(d.mode==='browser-auto'){
  try{await connectScheduledSignup(d);}
  catch(error){
   const latest=await api('/api/signups/'+d.id+'/cancel','POST',{revision:d.revision}).catch(()=>api('/api/signups/'+d.id).catch(()=>null));
   if(latest){if(token===epoch)editing=latest;updateSavedDraft(latest);}
   throw error;
  }
 }
 updateSavedDraft(d);
 if(token===epoch){openDraft(d);status(d.mode==='browser-auto'?(immediate?'Background signup queued now. It runs in an inactive tab; keep your browser open.':'Background signup approved for '+new Date(d.backupAt).toLocaleString()+'. Keep your browser running with the extension enabled, and stay signed in on the organizer’s site.'):('Backup reminder is on for '+new Date(d.backupAt).toLocaleString()+'.'));}
}
$('#arm-signup').onclick=()=>action(()=>armBrowserSignup(false));
$('#submit-demo-now').onclick=()=>action(async()=>{const saved=await saveDraft(true);if(!saved)return;const result=await api('/api/signups/'+saved.id+'/submit-now','POST',{approved:true,milestoneId:$('#signup-milestone').value});await refresh();openDraft(result);status(result.status+': '+(result.receipt||result.notice||'Review required'));});
async function stop(kind){if(!editing?.id){closeEditor();return;}const id=editing.id,token=epoch;await api('/api/signups/'+id+'/'+kind,'POST',{});await refresh();if(token===epoch)closeEditor();status(kind==='cancel'?'Backup cancelled. No future signup reminders will be sent.':'Marked already registered. Backup stopped.');}
$('#cancel-signup').onclick=()=>action(()=>stop('cancel'));$('#registered-signup').onclick=()=>action(()=>stop('registered'));
function startFormFill(autoSubmit=false){return action(async()=>{const current=await reviewedDraft();if(!current)return;const id=liveExtensionId||captured?.extensionId||current.extensionId||await storage.get('backgroundExtensionId');if(!id||!globalThis.chrome?.runtime?.sendMessage)throw Error('Open this page in the browser where you installed Deadline Scout. Reload the extension, prepare this form once, and save its draft. Autofill needs that extension connection.');const filePayload=[];let fileBytes=0;for(const [stepIndex,step]of current.steps.entries())for(const field of step.fields.filter(f=>f.type==='file'))for(const ref of step.files?.[field.key]||[]){if(!ref.id)continue;const file=await api('/api/signups/'+current.id+'/files/'+ref.id);fileBytes+=file.size;if(fileBytes>4*1024*1024)throw Error('Attach at most 4 MB of saved PDFs per session.');filePayload.push({stepIndex,key:field.key,id:ref.id,...file});}const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Extension did not respond. Reload it from your browser’s extensions page and try again.')),10000);chrome.runtime.sendMessage(id,{type:'scout-signup-resume',draft:current,autoSubmit,filePayload},r=>{clearTimeout(timer);if(chrome.runtime.lastError||!r?.ok)reject(Error(r?.error||'Reload the extension and try again.'));else resolve(r);});});status(result.needsPermission?(autoSubmit?'Form opened for approved filling and submission. Click the extension and enable this site; missing files, consent or CAPTCHA will pause it.':'Form opened. Click the extension → Enable autofill on this site once. Saved answers will fill on matching steps. Complete any upload picker on the form.'):(autoSubmit?'Approved fill-and-submit session started. Verify the organizer’s confirmation; no automatic retry after a submission attempt.':'Form opened. Saved answers fill now and on matching subsequent steps. Check the form for any PDF upload picker, consent, and submission.'));});}
$('#resume-signup').onclick=()=>startFormFill(false);
$('#fill-submit-signup').onclick=()=>action(()=>armBrowserSignup(true));

async function continueCapture(id){const token=++epoch;let d;for(const step of captured.steps||[captured.step])d=await api('/api/signups/'+id+'/steps','POST',{step:suggestStep(step),extensionId:captured.extensionId});await refresh();if(token!==epoch)return;captured=null;$('#capture-choice').hidden=true;showStage(2);openDraft(d);status('Captured pages added to the same signup. Review and save the answers.');}
$('#append-step').onclick=()=>action(()=>continueCapture($('#append-draft').value));$('#new-signup').onclick=()=>{epoch++;$('#capture-choice').hidden=true;showStage(1);openDraft({trackId:tracks.some(t=>t.id===targetEvent)?targetEvent:'',title:captured.step.title,formUrl:captured.step.url,steps:(captured.steps||[captured.step]).map(suggestStep),extensionId:captured.extensionId,reviewedAll:false});};
$('#undo-delete').onclick=()=>action(async()=>{if(!lastDeletedId)return;await api('/api/signups/'+lastDeletedId+'/restore','POST',{});lastDeletedId=null;$('#undo-delete').hidden=true;await refresh();status('Draft restored. Review it before turning its backup on again.');});
$('#run-backups').onclick=()=>action(async()=>{await api('/api/signups/run','POST',{});await refresh();status('Due backups checked.');});
await action(async()=>{const config=await api('/api/config');if(!await storage.get('token')&&config.auth==='local'){const s=await api('/api/local-session','POST',{});await storage.set('token',s.token);}await refresh();targetEvent=await storage.get('signup-target-event:'+me.email);const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('capture')){captured=await api('/api/signup-captures/'+hash.get('capture'));if(/^[a-p]{32}$/.test(captured.extensionId))await storage.set('backgroundExtensionId',captured.extensionId);history.replaceState(null,'',location.pathname);const matches=drafts.filter(d=>!['Confirmed','Already registered','Cancelled'].includes(d.status)&&sameSignupForm(d.formUrl,captured.step.url));if(matches.length){$('#capture-choice').hidden=false;$('#capture-choice').scrollIntoView({block:'start',behavior:'instant'});$('#capture-summary').textContent='Captured: '+captured.step.title+'. Continue an existing signup to keep its earlier steps.';$('#append-draft').innerHTML=matches.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.title)+' · '+d.steps.length+' saved step(s)</option>').join('');}else $('#new-signup').onclick();}else if(hash.has('event')){const event=tracks.find(t=>t.id===hash.get('event'));if(event){await storage.set('signup-target-event:'+me.email,event.id);status('Open the registration form for '+event.title+', then click Prepare signup in the extension.');const a=document.createElement('a');a.href=event.url;a.target='_blank';a.rel='noopener';a.className='button primary';a.textContent='Open registration page';$('#backup-feedback').append(a);}}else if(hash.has('draft')){showStage(1);openDraft(await api('/api/signups/'+hash.get('draft')));}});
if(!me.email){$('#backup-account').textContent='Sign in on the dashboard, then return here.';const b=document.createElement('button');b.className='button primary';b.textContent='Sign in with Google';b.onclick=()=>action(async()=>{await storage.set('pendingBackupUrl',location.href);await connectGoogle();});$('#backup-account').append(b);}

setInterval(async()=>{if(busy||!me.email)return;try{const latest=await api('/api/signups');if(JSON.stringify(latest)!==JSON.stringify(drafts)){drafts=latest;paintList();groupDraftCards();}}catch{}},15000);
