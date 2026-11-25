import {dedupeMilestones} from './milestone-selection.js';
import { findDates, findTimes, DEFAULT_TIMEZONE } from './dates.js';
export const labels={registration_closes:'Registration closes',registration_opens:'Registration opens',payment:'Payment deadline',documents:'Document submission',event:'Event date',event_end:'Event ends',doors_open:'Doors open',submissions:'Submission deadline',results:'Results announced',custom:'Other milestone'};
// Prefer the page's own short heading over a fixed event vocabulary.
export function contextualLabel(text,kind,referenceYear){
  const date=findDates(text,referenceYear)[0];
  let context=(date?text.slice(0,date.index):text).trim().replace(/[:·•—–-]+\s*$/,'').replace(/\b(?:is|due|on|at|by|before|scheduled for|scheduled|for|from|until)\s*$/i,'').trim();
  context=context.replace(/\b(?:is|due|on|at|by|before)\s*$/i,'').trim();
  context=context.replace(/\b(?:has been |was |is )?(?:moved|extended|brought forward|rescheduled|changed|revised)(?:\s+(?:from|to))?\s*$/i,'').trim().replace(/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?),?\s*$/i,'').trim();
  if(context&&context.length<=100&&context.split(/\s+/).length<=12&&!/^(?:copyright|all rights reserved|last updated|updated|published|posted|today|yesterday|in \d+)\b/i.test(context))return context[0].toUpperCase()+context.slice(1);
  return labels[kind]||labels.custom;
}
export function identifyKind(text) {
  if(/doors?\s+open|check.?in\s+(?:opens?|starts?)/i.test(text))return 'doors_open';
  if(/(?:project|paper|abstract|idea|hackathon)\s+submission|submission\s+(?:deadline|closes?|cutoff)|submit\s+(?:project|paper|abstract)/i.test(text))return 'submissions';
  if(/results?\s+(?:announced|announcement|date)|winners?\s+(?:announced|announcement)/i.test(text))return 'results';
  if(/(?:event|hackathon|ceremony)\s+(?:ends?|finish|concludes?)|end\s+date/i.test(text))return 'event_end';
  if(/payment|pay\b|fee deadline/i.test(text)) return 'payment';
  if(/document|transcript|upload|portfolio/i.test(text)) return 'documents';
  if(/(?:registration|applications?|admissions?|sign.?ups?)\s+(?:opens?|begins?|starts?)/i.test(text)) return 'registration_opens';
  if(/(?:registration|applications?|admissions?|sign.?ups?|register|apply)\b.*(?:deadline|last|closes?|closing|ends|by)|(?:deadline|last\s+(?:date|time|day))\b.*(?:register|apply|registration)|register by|apply by/i.test(text)) return 'registration_closes';
  if(/event|hackathon|ceremony|takes place|held on|starts? on/i.test(text)) return 'event';
  return null;
}
export function extract(text, sourceUrl, referenceYear) {
  const results=[];
  const lines=text.replace(/\r/g,'').replace(/\s*(?=doors?\s+open)/gi,'\n').split(/\n+|[;|]\s*|(?<=[!?])\s+|(?<=\.)\s+(?=[A-Z])|,\s*(?=(?:registration|applications?|payment|documents?|event|hackathon)\b)/i).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  let heading=null;const timeRows=[];
  for(const line of lines) {
    let quote=line,kind=identifyKind(line);
    const lineDates=findDates(line,referenceYear);
    if(!kind&&lineDates.length&&contextualLabel(line,'custom',referenceYear)!==labels.custom)kind='custom';
    if(!kind&&heading&&lineDates.length){kind=heading.kind;quote=heading.text+'\n'+line;}
    if(!kind&&!lineDates.length&&line.length<=100&&/^[\p{L}][\p{L}\p{N}\s&()/'’:.,-]*:?$/u.test(line)){heading={text:line,kind:'custom'};continue;}
    if(/event\s+time|doors?\s+open/i.test(line)&&findTimes(line).length&&!findDates(line,referenceYear).length){timeRows.push({quote:line,kind:/doors?\s+open/i.test(line)?'doors_open':'event'});heading=null;continue;}
    if(heading&&/event\s+time|doors?\s+open/i.test(heading.text)&&findTimes(line).length&&!findDates(line,referenceYear).length){timeRows.push({quote:heading.text+'\n'+line,kind:heading.kind});heading=null;continue;}
    if(kind&&!findDates(line,referenceYear).length){heading={text:line,kind};continue;}
    if(!kind&&heading&&findDates(line,referenceYear).length){kind=heading.kind;quote=heading.text+'\n'+line;}
    heading=null;if(!kind)continue;
    const dates=findDates(quote,referenceYear); if(!dates.length) continue;
    const explicitUpdate=/\b(?:moved|extended|brought forward|rescheduled|changed|revised|now closes|now ends|new deadline)\b/i.test(quote);
    // "changed from X to Y" should never be interpreted as two milestones.
    const candidates=explicitUpdate?[dates.at(-1)]:dates;
    for(const d of candidates) results.push({kind,label:contextualLabel(quote,kind,referenceYear),sourceLabel:contextualLabel(quote,kind,referenceYear),...d,quote,sourceUrl,explicitUpdate,previousDates:explicitUpdate?dates.slice(0,-1).map(d=>d.date):[],uncertain:!!d.reasons.length});
  }
  const foundEvent=results.find(m=>m.kind==='event');const event=foundEvent?{...foundEvent}:null;
  if(event)for(const row of timeRows){
    const times=findTimes(row.quote);const zone=times.find(t=>t.zone)?.zone||DEFAULT_TIMEZONE;
    for(const [i,t] of times.entries()){
      const kind=row.kind==='doors_open'?'doors_open':i===0?'event':'event_end';
      const m={...event,kind,label:labels[kind],time:t.time,zone:t.zone||zone,raw:`${event.raw}|${row.quote}`,quote:event.quote+'\n'+row.quote,contextual:true};
      if(kind==='event'){Object.assign(foundEvent,m);}else results.push(m);
    }
  }
  return dedupeMilestones(results);
}
export function decode(text) {
  return text.replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi,(m,num,name)=>num?String.fromCodePoint(Math.min(0x10ffff,num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—'}[name]||m));
}
export function readHtml(html,url) {
  const title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).hostname);
  const json=[];
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { json.push(JSON.parse(match[1])); } catch { /* Malformed optional schema is ignored. */ }
  }
  const text=decode(html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<(?:br|\/?(?:p|div|li|h[1-6]|tr|section|article|dt|dd))\b[^>]*>/gi,'\n').replace(/<\/?t[dh]\b[^>]*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
  const links=[];
  for(const a of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {const link=new URL(decode(a[1]),url); const label=decode(a[2].replace(/<[^>]*>/g,'')).trim(); if(link.origin===new URL(url).origin && /faq|rules|updates|schedule|dates/i.test(label+' '+link.pathname)) links.push({url:link.href,label});}catch{}
  }
  const structured=[];
  function walk(v) {
    if(!v || typeof v!=='object') return;
    if(v['@type']==='Event' && v.startDate) {
      const raw=String(v.startDate), d=raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})?)?/);
      if(d) structured.push({kind:'event',label:'Event date',date:d[1],time:d[2]||null,zone:d[3]==='Z'?'UTC':d[3]?'UTC'+d[3]:d[2]?DEFAULT_TIMEZONE:null,quote:raw,sourceUrl:url,explicitUpdate:false,reasons:[],uncertain:false,structured:true});
    }
    Object.values(v).forEach(x=>Array.isArray(x)?x.forEach(walk):walk(x));
  }
  json.forEach(walk);
  return {title,text,links:[...new Map(links.map(l=>[l.url,l])).values()].slice(0,12),milestones:dedupeMilestones([...structured,...extract(text,url)])};
}
