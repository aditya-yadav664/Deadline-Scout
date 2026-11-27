import {evidenceIdentity} from './milestone-selection.js';
import { instant, scheduleKey, impact } from './dates.js';
function verificationKey(milestone) {
  try { return milestone.time ? instant(milestone) : milestone.date; }
  catch { return scheduleKey(milestone); }
}
export const observationKey = candidates => candidates.map(m=>`${m.sourceUrl}|${scheduleKey(m)}`).sort().join('\n');
export function compare(track, observations) {
  const changes=[], conflicts=[], missing=[], uncertain=[];
  const milestones=track.milestones.map(old=>{
    if(old.manual) return old;
    let candidates=observations.flatMap(o=>o.milestones).filter(m=>m.kind===old.kind);
    if(old.kind==='custom'){
      const name=String(old.sourceLabel||old.label||'').toLowerCase().trim();
      candidates=candidates.filter(m=>String(m.sourceLabel||m.label||'').toLowerCase().trim()===name);
    }
    if(track.milestones.filter(m=>m.kind===old.kind&&!m.manual).length>1&&(old.kind!=='custom'||candidates.length>1)){
      const identity=evidenceIdentity(old);
      const matched=candidates.filter(m=>identity&&evidenceIdentity(m)===identity);
      if(matched.length)candidates=matched;
      else {missing.push(old.kind);return old;}
    }
    const all=candidates.map(m=>{
      const sameClock=m.time===(old.confirmedDetectedTime??null)&&m.zone===(old.confirmedDetectedZone??null);
      if((m.raw && m.raw===old.confirmedRaw && sameClock)||(m.model&&m.quote===old.confirmedQuote&&m.date===old.date&&m.time===old.time)) return {...m,date:old.date,time:old.time,zone:old.zone,uncertain:false,reasons:[]};
      return m;
    });
    if(!all.length){missing.push(old.kind);return old;}
    if(all.some(m=>m.uncertain)){uncertain.push({kind:old.kind,milestoneId:old.id,label:old.label,candidates:all});return old;}
    const key=track.verificationSources?.length?verificationKey:scheduleKey;
    const unique=[...new Map(all.map(m=>[key(m),m])).values()];
    let chosen;
    const resolution=track.resolutions?.[old.id]||track.resolutions?.[old.kind];
    if(unique.length===1) chosen=all.find(m=>scheduleKey(m)===scheduleKey(old))||unique[0];
    else if(resolution?.observation===observationKey(all)) chosen=all.find(m=>scheduleKey(m)===resolution.chosen && m.sourceUrl===resolution.sourceUrl);
    if(!chosen && unique.length>1) {
      const updated=unique.filter(m=>m.explicitUpdate && (!m.previousDates?.length || m.previousDates.includes(old.date) || scheduleKey(m)===scheduleKey(old)));
      if(updated.length===1 && !track.verificationSources?.length) chosen=updated[0];
      else {conflicts.push({kind:old.kind,milestoneId:old.id,label:old.label,candidates:track.verificationSources?.length?all:unique});return old;}
    }
    if(scheduleKey(chosen)!==scheduleKey(old)) changes.push({kind:old.kind,label:old.label,before:old,after:chosen,impact:impact(track.plan,chosen)});
    return {...old,...chosen,id:old.id,label:old.label,sourceLabel:old.sourceLabel||chosen.label,manual:old.manual};
  });
  return {milestones,changes,conflicts,missing,uncertain};
}
