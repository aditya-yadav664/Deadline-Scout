import {evidenceIdentity} from './milestone-selection.js';
import { scheduleKey, impact } from './dates.js';
export const observationKey = candidates => candidates.map(m=>`${m.sourceUrl}|${scheduleKey(m)}`).sort().join('\n');
export function compare(track, observations) {
  const changes=[], conflicts=[], missing=[], uncertain=[];
  const milestones=track.milestones.map(old=>{
    if(old.manual) return old;
    let candidates=observations.flatMap(o=>o.milestones).filter(m=>m.kind===old.kind);
    if(track.milestones.filter(m=>m.kind===old.kind&&!m.manual).length>1){
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
    if(all.some(m=>m.uncertain)){uncertain.push({kind:old.kind,candidates:all});return old;}
    const unique=[...new Map(all.map(m=>[scheduleKey(m),m])).values()];
    let chosen;
    if(unique.length===1) chosen=unique[0];
    else if(track.resolutions?.[old.kind]?.observation===observationKey(all)) chosen=all.find(m=>scheduleKey(m)===track.resolutions[old.kind].chosen && m.sourceUrl===track.resolutions[old.kind].sourceUrl);
    if(!chosen && unique.length>1) {
      const updated=unique.filter(m=>m.explicitUpdate && (!m.previousDates?.length || m.previousDates.includes(old.date) || scheduleKey(m)===scheduleKey(old)));
      if(updated.length===1) chosen=updated[0];
      else {conflicts.push({kind:old.kind,candidates:unique});return old;}
    }
    if(scheduleKey(chosen)!==scheduleKey(old)) changes.push({kind:old.kind,label:old.label,before:old,after:chosen,impact:impact(track.plan,chosen)});
    return {...old,...chosen,id:old.id,manual:old.manual};
  });
  return {milestones,changes,conflicts,missing,uncertain};
}
