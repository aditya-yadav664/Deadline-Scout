export function selectMilestone(current,kind,catalog){
  const matches=catalog.filter(m=>m.kind===kind);
  if(matches.length===1)return {...current,...structuredClone(matches[0]),kind,selected:current.selected,confirmed:false,variants:current.variants};
  return {...current,kind,date:'',time:null,zone:null,quote:'',raw:null,detected:null,confirmed:false,manual:matches.length===0,sourceChoice:null,reasons:[matches.length?'Several source dates match this milestone. Choose the evidence below.':'No date was found for this milestone. Enter it manually; no date is copied from another milestone.']};
}

// Keep distinct event descriptions, even when their kind and date match.
export function milestoneKey(m){return [m.kind,m.date,m.time||'',m.time?m.zone||'':'',String(m.quote||'').toLowerCase().replace(/\s+/g,' ').trim(),!!m.manual].join('|');}
export function dedupeMilestones(items){
 const unique=[...new Map(items.map(m=>[milestoneKey(m),m])).values()];
 return unique.filter(m=>!m.structured||!unique.some(other=>!other.structured&&other.kind===m.kind&&other.date===m.date&&(other.time||'')===(m.time||'')&&(other.zone||'')===(m.zone||'')));
}
export function evidenceIdentity(m){return String(m.quote||'').toLowerCase().replace(/\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|am|pm)\b/g,' ').replace(/[\d\W_]+/g,' ').trim();}

// A server read is the fresh baseline; an earlier browser scan must not add stale copies.
export function mergeCapturedMilestones(captured,server){
 if(!server?.length)return dedupeMilestones(captured).map(m=>({...m,manual:true}));
 const group=m=>m.kind==='custom'?m.kind+':'+String(m.sourceLabel||m.label||'').toLowerCase().trim():m.kind;
 const kinds=new Set(server.map(group));
 return dedupeMilestones([...server.map(m=>({...m,manual:false})),...captured.filter(m=>!kinds.has(group(m))).map(m=>({...m,manual:true}))]);
}

// Narrow repair for the old mixed-snapshot bug, not a general same-kind merge.
export function repairMixedSnapshot(track,observations){
 const old=track.milestones;
 const doors=old.filter(m=>m.kind==='doors_open'&&!m.manual);
 if(doors.length!==3||new Set(doors.map(m=>m.quote)).size!==1||!/doors?\s+open/i.test(doors[0].quote)||!old.some(m=>m.manual&&m.kind==='event_end'))return false;
 const kinds=['event','registration_closes','event_end','doors_open'];
 if(!kinds.every(kind=>old.some(m=>m.kind===kind)))return false;
 const fresh=dedupeMilestones(observations.flatMap(o=>o.milestones));
 if(!kinds.every(kind=>fresh.filter(m=>m.kind===kind&&!m.uncertain).length===1))return false;
 if(new Set(old.map(m=>m.sourceUrl)).size!==1)return false;
 track.milestoneRepairs=[...(track.milestoneRepairs||[]),{at:new Date().toISOString(),reason:'mixed-browser-server-snapshot',milestones:structuredClone(old)}];
 track.milestones=kinds.map(kind=>{
   const baseline=old.find(m=>m.kind===kind&&!m.manual)||old.find(m=>m.kind===kind);
   return {...baseline,manual:false};
 });
 // Other legitimate milestone types survive the repair.
 track.milestones.push(...old.filter(m=>!kinds.includes(m.kind)));
 return true;
}
