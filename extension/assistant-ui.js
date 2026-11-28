const dayMs=86400000;
const iso=value=>new Date(value).toISOString().slice(0,10);
const addDays=(date,days)=>iso(Date.parse(date)+days*dayMs);
const safeLink=value=>{
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
};

function appendLink(parent,label,href){
  const link=document.createElement('a');
  link.textContent=label;
  link.href=href;
  parent.append(link);
  return link;
}

export function renderAnswers(target,entries){
  target.replaceChildren();
  if(!entries.length){target.textContent='Your answers will appear here.';return;}
  const history=document.createElement('details');
  history.className='assistant-history';
  const historyLabel=document.createElement('summary');
  historyLabel.textContent='Previous questions ('+(entries.length-1)+')';
  history.append(historyLabel);
  for(const [index,entry] of entries.entries()){
    const article=document.createElement('article');
    article.className='card workspace-card assistant-answer';
    const question=document.createElement('p'),heading=document.createElement('h3'),summary=document.createElement('p');
    question.className='assistant-question-label';question.textContent=entry.question;
    heading.textContent=entry.heading;
    summary.className='assistant-summary';
    summary.textContent=entry.summary||(!entry.items.length?'No saved records match this question.':'');
    article.append(question,heading,summary);
    if(entry.sourceSummary){
      const block=document.createElement('div'),label=document.createElement('strong'),body=document.createElement('p');
      block.className='assistant-source-summary';label.textContent='Gemini source summary';body.textContent=entry.sourceSummary;
      block.append(label,body);article.append(block);
    }
    if(entry.note){
      const note=document.createElement('p');note.className='muted';note.textContent=entry.note;article.append(note);
    }
    if(entry.items.length){
      const list=document.createElement('ul');
      list.className='workspace-list';
      for(const item of entry.items){
        const row=document.createElement('li'),body=document.createElement('div'),fact=document.createElement('p');
        const link=appendLink(body,item.title,'#opportunity='+encodeURIComponent(item.trackId));
        link.dataset.opportunity=item.trackId;
        fact.textContent=item.text;
        body.append(fact);
        if(item.quote){
          const sourceDetails=document.createElement('details'),label=document.createElement('summary'),quote=document.createElement('blockquote');
          label.textContent=item.cited?'Source used by Gemini':'Source excerpt';quote.className='evidence';quote.textContent=item.quote;
          sourceDetails.append(label,quote);body.append(sourceDetails);
        }
        const url=safeLink(item.url);
        if(url&&item.quote){const source=appendLink(body,'Open source',url);source.target='_blank';source.rel='noopener noreferrer';}
        row.append(body);list.append(row);
      }
      article.append(list);
      if(entry.total>entry.items.length){
        const more=document.createElement('p');more.className='muted';
        more.textContent='Showing '+entry.items.length+' of '+entry.total+' matches. Include an opportunity name to narrow the results.';
        article.append(more);
      }
    }
    if(index)history.append(article);else target.append(article);
  }
  if(entries.length>1)target.append(history);
}

export function filterLibrary(target){
  const search=target.querySelector('[data-library-search]');
  if(!search)return;
  const filter=target.querySelector('[data-library-filter]');
  function apply(){
    const terms=search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows=[...target.querySelectorAll('[data-library-entry]')];
    for(const row of rows)row.hidden=!!(filter?.value&&row.dataset.category!==filter.value)||
      !terms.every(term=>row.dataset.libraryEntry.includes(term));
    target.querySelector('[data-library-empty]').hidden=rows.some(row=>!row.hidden);
  }
  search.oninput=apply;
  if(filter)filter.onchange=apply;
  apply();
}

export function renderMemory(target,entries,esc,tracks=[]){
  const form=(item={})=>`<form data-scout-memory data-id="${esc(item.id||'')}" class="application-form">
    <label>Label<input name="label" required maxlength="100" value="${esc(item.label)}"></label>
    <label>Note<textarea name="value" required maxlength="600">${esc(item.value)}</textarea></label>
    <label>Opportunity<select name="trackId" aria-label="Opportunity"><option value="">General note</option>${tracks.map(track=>
       `<option value="${esc(track.id)}" ${item.trackId===track.id?'selected':''}>${esc(track.title)}</option>`).join('')}</select></label>
    <label><input name="pinned" type="checkbox" ${item.pinned?'checked':''}> Pin to the top</label>
    <button class="button secondary" type="submit">${item.id?'Save note':'Add note'}</button>
    ${item.id?`<button class="text-button" type="button" data-delete-memory="${esc(item.id)}">Delete note</button>`:''}
  </form>`;
  const sorted=[...entries].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  target.innerHTML=`<div class="tools-library"><section>
    <div class="tools-bar"><label>Search notes<input type="search" data-library-search placeholder="Search by title, text, or opportunity"></label></div>
    <p class="tools-empty" data-library-empty>${entries.length?'No notes match this search.':'No saved notes yet.'}</p>
    <div class="tools-stack">${sorted.map(item=>{
      const track=tracks.find(entry=>entry.id===item.trackId);
      const name=track?.title||(item.trackId?'Removed opportunity':'General note');
      return `<details class="tools-library-entry" data-library-entry="${esc((item.label+' '+item.value+' '+name).toLowerCase())}">
        <summary><strong>${esc(item.label)}</strong><small>${item.pinned?'Pinned · ':''}${esc(name)}</small></summary>
        <p class="library-preview">${esc(item.value)}</p>
        ${track?`<a data-opportunity="${esc(track.id)}" href="#opportunity=${encodeURIComponent(track.id)}">Open opportunity</a>`:''}
        ${form(item)}</details>`;
    }).join('')}</div></section>
    <section class="tools-editor"><h3>New note</h3>${form()}</section></div>`;
  filterLibrary(target);
}

export function renderProductivity(target,data,esc){
  const days=86400000;
  const now=Date.parse(data.today);
  const dateFmt=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
  const events=data.events.filter(item=>item.type==='deadline'||item.type==='task');
  target.innerHTML=`<div class="tools-bar"><label>Look ahead <select data-workload-range>
    <option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option>
    <option value="late">Overdue tasks</option></select></label>
    <button class="text-button" type="button" data-workspace-jump="heatmap">Open calendar</button></div>
    <div data-workload-results></div>`;
  const range=target.querySelector('[data-workload-range]');
  function draw(){
    const late=range.value==='late';
    const rows=events.filter(item=>late?item.type==='task'&&item.date<data.today:
      item.date>=data.today&&Date.parse(item.date)<now+Number(range.value)*days).sort((a,b)=>a.date.localeCompare(b.date));
    const grouped=Map.groupBy(rows,item=>item.date);
    const collisions=[...grouped.values()].filter(items=>items.length>1).length;
    target.querySelector('[data-workload-results]').innerHTML=`<p class="tools-report">
      <strong>${rows.length}</strong> ${late?'overdue '+(rows.length===1?'task':'tasks'):(rows.length===1?'dated item':'dated items')}
      ${!late&&collisions?` · <strong>${collisions}</strong> ${collisions===1?'day':'days'} with overlapping work`:''}</p>
      ${rows.length?`<div class="tools-stack">${[...grouped].map(([date,items])=>`<section class="tools-day">
      <h3><time datetime="${esc(date)}">${dateFmt.format(new Date(date))}</time>${items.length>1?' <small>'+items.length+' items</small>':''}</h3>
      <ul class="plan-list">${items.map(item=>`<li><div><a ${item.type==='task'?'data-open-plan':''} data-opportunity="${esc(item.trackId)}" href="#opportunity=${encodeURIComponent(item.trackId)}">${esc(item.label)}</a>
      <small>${esc(item.title)}</small></div><span>${item.type==='task'?'Task':'Milestone'}</span></li>`).join('')}</ul></section>`).join('')}</div>`
      :`<p class="tools-empty">${late?'You have no overdue tasks.':'No deadlines or due tasks in this window.'}</p>`}`;
  }
  range.onchange=draw;
  draw();
}

export function renderHeatmap(target,data,esc){
  target.innerHTML=`<div class="calendar-toolbar">
    <label>Period<select aria-label="Period" data-cal-period><option value="month">Month</option><option value="week">Week</option></select></label>
    <label>Opportunity<select aria-label="Opportunity" data-cal-track><option value="">All opportunities</option>${data.opportunities.map(track=>
      `<option value="${esc(track.id)}">${esc(track.title)}</option>`).join('')}</select></label>
    <label>Category<select aria-label="Category" data-cal-kind><option value="">Everything</option><option value="deadline">Milestones</option><option value="task">Tasks</option><option value="change">Changes</option><option value="risk">High or critical risk</option></select></label>
  </div><div class="calendar-period"><button type="button" class="icon-button" data-cal-shift="-1" aria-label="Previous period">‹</button>
    <strong data-cal-title></strong><button type="button" class="icon-button" data-cal-shift="1" aria-label="Next period">›</button>
    <button type="button" class="text-button" data-cal-today>Today</button></div>
  <p class="muted calendar-help">Select a date to see its items. The number shows how many are scheduled or recorded that day.</p><div class="calendar-grid" data-cal-grid></div><section class="card workspace-card" data-cal-details aria-live="polite"></section>`;
  const nearest=data.events.filter(event=>event.date>=data.today&&event.type!=='change')
    .map(event=>event.date).sort()[0];
  let selected=nearest||data.today,anchor=selected;
  const period=target.querySelector('[data-cal-period]'),track=target.querySelector('[data-cal-track]'),kind=target.querySelector('[data-cal-kind]');
  const grid=target.querySelector('[data-cal-grid]'),detail=target.querySelector('[data-cal-details]');
  const month=new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'});
  const fullDate=new Intl.DateTimeFormat('en',{dateStyle:'full',timeZone:'UTC'});
  function draw(){
    const weekly=period.value==='week',first=weekly?anchor:anchor.slice(0,7)+'-01';
    const start=addDays(first,-((new Date(first).getUTCDay()+6)%7));
    const shortDate=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
    const title=weekly?shortDate.format(new Date(start))+' – '+shortDate.format(new Date(addDays(start,6))):month.format(new Date(first));
    target.querySelector('[data-cal-title]').textContent=title;
    const filtered=data.events.filter(event=>(!track.value||track.value===event.trackId)&&
      (!kind.value||kind.value===event.type||kind.value==='risk'&&['Critical','High'].includes(event.risk)));
    const indexed=Map.groupBy(filtered,event=>event.date);
    const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<span class="calendar-weekday">${day}</span>`);
    for(let i=0;i<(weekly?7:42);i++){
      const date=addDays(start,i),count=indexed.get(date)?.length||0;
      days.push(`<button type="button" class="calendar-day" data-cal-day="${date}" data-density="${Math.min(count,4)}"
        aria-label="${fullDate.format(new Date(date))}, ${count} item(s)" aria-pressed="${date===selected}"
        ${!weekly&&date.slice(0,7)!==first.slice(0,7)?'data-outside':''}><span>${Number(date.slice(-2))}</span>${count?`<small>${count}</small>`:''}</button>`);
    }
    grid.innerHTML=days.join('');
    const list=(indexed.get(selected)||[]).map(event=>`<li><div><a data-opportunity="${esc(event.trackId)}" href="#opportunity=${encodeURIComponent(event.trackId)}">${esc(event.label)}</a>
      <small>${esc(event.title)} · ${esc({deadline:'Milestone',task:'Task',change:'Change'}[event.type]||event.type)}${event.risk&&['High','Critical'].includes(event.risk)?' · '+esc(event.risk)+' risk':''}</small></div></li>`);
    detail.innerHTML=`<h3>${fullDate.format(new Date(selected))}</h3>${list.length?`<ul class="workspace-list">${list.join('')}</ul>`:'<p class="muted">No matching items on this date.</p>'}`;
  }
  target.onchange=draw;
  target.onclick=event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.calDay){
      selected=button.dataset.calDay;
      draw();
      grid.querySelector('[aria-pressed=true]')?.focus();
    }else if(button.hasAttribute('data-cal-today')){anchor=selected=data.today;draw();}
    else if(button.dataset.calShift){
      const step=Number(button.dataset.calShift);
      if(period.value==='week')anchor=addDays(anchor,step*7);
      else{const date=new Date(anchor.slice(0,7)+'-01');date.setUTCMonth(date.getUTCMonth()+step);anchor=iso(date);}
      selected=anchor;draw();
    }
  };
  draw();
}
