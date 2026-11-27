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

export function renderMemory(target,entries,esc){
  const form=(item={})=>`<form data-scout-memory data-id="${esc(item.id||'')}" class="application-form">
    <label>Label<input name="label" required maxlength="100" value="${esc(item.label)}"></label>
    <label>Note<textarea name="value" required maxlength="600">${esc(item.value)}</textarea></label>
    <button class="button secondary" type="submit">${item.id?'Save note':'Add note'}</button>
    ${item.id?`<button class="text-button" type="button" data-delete-memory="${esc(item.id)}">Delete note</button>`:''}
  </form>`;
  target.innerHTML=`<div class="overview-grid"><article class="card workspace-card"><h3>New note</h3>${form()}</article>
    <article class="card workspace-card"><h3>Saved notes</h3>${entries.length?entries.map(item=>`<details>
      <summary>${esc(item.label)}</summary><p class="muted">${esc(item.source)} · ${esc(item.updatedAt.slice(0,10))}</p>${form(item)}
    </details>`).join(''):'<p class="muted">No notes saved.</p>'}</article></div>`;
}

const insightLabels={activeOpportunities:'Tracked opportunities',upcomingDeadlines:'Upcoming milestones',pendingTasks:'Open tasks',
  completedRequirements:'Checklist items complete',recentlyUpdated:'Updated in the last 7 days',needsAttention:'High or critical risk'};
export function renderProductivity(target,data,esc){
  const links={activeOpportunities:['watchlist','Open watchlist'],upcomingDeadlines:['heatmap','Open calendar'],
    pendingTasks:['applications','Open applications'],completedRequirements:['applications','View checklists'],
    recentlyUpdated:['intelligence','View source changes'],needsAttention:['risk','Review priorities']};
  target.innerHTML=`<ul class="overview-grid productivity-grid">${Object.entries(insightLabels).map(([key,label])=>
    `<li class="card workspace-card"><strong>${esc(data.insights[key])}</strong><span>${label}</span>
      <button type="button" class="text-button" data-workspace-jump="${links[key][0]}">${links[key][1]}</button></li>`).join('')}</ul>`;
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
