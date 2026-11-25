import { hash } from './security.js';
import { instant, validateMilestone, DEFAULT_TIMEZONE, validDate } from '../extension/shared/dates.js';
const calendarBase='https://www.googleapis.com/calendar/v3';
const taskBase='https://tasks.googleapis.com/tasks/v1';
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function milestoneDate(m){
  const date=validDate(m.date)?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m.date+'T12:00:00Z')):String(m.date||'');
  if(!m.time)return date+' · All day';
  const match=/^(\d{2}):(\d{2})$/.exec(m.time),clock=match?`${+match[1]%12||12}:${match[2]} ${+match[1]>=12?'PM':'AM'}`:m.time;
  const zone=['Asia/Kolkata','Asia/Calcutta','IST'].includes(m.zone||DEFAULT_TIMEZONE)?'IST':m.zone;
  return date+' · '+clock+' '+zone;
}
export function calendarDescription(track,m){
  const parts=[`<b>${html(track.title)}</b>`,`${html(m.label)}`,html(milestoneDate(m))];
  const others=(track.milestones||[]).filter(other=>other.id&&m.id?other.id!==m.id:other.kind!==m.kind||other.date!==m.date||(other.time||'')!==(m.time||'')||other.label!==m.label);
  if(others.length)parts.push('','<b>Other milestones</b>',...others.map(other=>`${html(other.label)} — ${html(milestoneDate(other))}`));
  if(validDate(track.plan))parts.push('','<b>Your plan</b>','Register on '+html(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(track.plan+'T12:00:00Z'))));
  try{const url=new URL(track.url);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)parts.push('',`<a href="${html(url.href)}">View event page</a>`);}catch{}
  return parts.join('<br>');
}
export function calendarPayload(track,m,minutes,zone) {
  validateMilestone(m);
  const dateAfter=new Date(Date.parse(m.date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const start=m.time?{dateTime:instant(m)}:{date:m.date};
  const end=m.time?{dateTime:new Date(Date.parse(instant(m))+1800000).toISOString()}:{date:dateAfter};
  return {summary:`${track.title} — ${m.label}`.replace(/\s+/g,' ').trim(),description:calendarDescription(track,m),start,end,reminders:{useDefault:false,overrides:[{method:'popup',minutes}]},extendedProperties:{private:{deadlineDiff:track.id,kind:m.kind}}};
}
export function taskPayload(track,m,marker) {return {title:`${m.label}: ${track.title}`,notes:`Registration: ${track.url}\nSource: ${m.sourceUrl}\n${m.quote||''}\n${marker}`,due:`${m.date}T00:00:00.000Z`};}
export class Google {
  constructor(store,vault,env,fetcher=fetch){Object.assign(this,{store,vault,env,fetcher});}
  async refresh(owner){
    const profile=this.store.get(owner,'profile','me');
    if(!profile?.google) throw new Error('Connect Google or reconnect your account.');
    const tokens=this.vault.open(profile.google);
    if(!tokens.refresh_token || !this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET) throw new Error('Reconnect Google. Offline access and server Google client credentials are required.');
    const r=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:'refresh_token'})});
    const data=await r.json();if(!r.ok) {profile.googleError='Google authorization expired or was revoked. Reconnect Google.';this.store.put(owner,'profile','me',profile);throw new Error(profile.googleError);}
    Object.assign(tokens,{access_token:data.access_token,expires_at:Date.now()+data.expires_in*1000});profile.google=this.vault.seal(tokens);delete profile.googleError;this.store.put(owner,'profile','me',profile);return tokens;
  }
  async api(owner,url,options={},retry=true) {
    const profile=this.store.get(owner,'profile','me');if(!profile?.google) throw new Error('Connect Google to use Calendar and Tasks.');
    let token=this.vault.open(profile.google);if(token.expires_at<Date.now()+60000) token=await this.refresh(owner);
    const r=await this.fetcher(url,{...options,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',...options.headers}});
    if(r.status===401&&retry){await this.refresh(owner);return this.api(owner,url,options,false);}
    const data=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(`Google HTTP ${r.status}: ${data.error?.message||'Action failed; reconnect if permission is missing.'}`);e.status=r.status;throw e;}return data;
  }
  async preview(owner,m,minutes) {
    if(!Number.isInteger(minutes)||minutes<0||minutes>40320) throw new Error('Reminder must be between 0 and 40320 minutes.');
    const setting=await this.api(owner,calendarBase+'/users/me/settings/timezone');
    const zone=setting.value;
    const start=m.time?instant(m):instant({...m,time:'00:00',zone});
    return {zone,at:new Date(Date.parse(start)-minutes*60000).toISOString(),dateOnly:!m.time,explanation:!m.time?'All-day event: reminder is measured before midnight in your primary Calendar timezone.':'Reminder is measured before the exact deadline time.'};
  }
  async perform(owner,track,m,channel,minutes=1440) {
    if(track.conflicts?.some(c=>c.kind===m.kind)||track.uncertain?.some(c=>c.kind===m.kind)) throw new Error('Resolve this milestone’s conflicting or uncertain sources first.');
    const key=`${track.id}:${m.id}:${channel}`;
    const marker=`[deadline-diff:${hash(owner+key)}]`;
    let link=this.store.get(owner,'googleLink',key);
    const calendar=channel==='calendar';
    const collection=calendar?`${calendarBase}/calendars/primary/events`:`${taskBase}/lists/@default/tasks`;
    const payload=calendar?calendarPayload(track,m,minutes):taskPayload(track,m,marker);
    // Tasks has no client-selected ID. Persist intent BEFORE POST; after an
    // uncertain request, reconcile its marker instead of blindly posting again.
    if(link?.state==='pending'||link?.state==='uncertain') {
      if(calendar) {
        try{const found=await this.api(owner,collection+'/'+link.googleId);link={...link,state:'linked',url:found.htmlLink};}
        catch(e){if(e.status!==404)throw e;link=null;}
      } else {
        let pageToken,found;
        do {
          const query=new URLSearchParams({maxResults:'100',showCompleted:'true',showHidden:'true',...(pageToken?{pageToken}:{})});
          const list=await this.api(owner,collection+'?'+query);
          found=list.items?.find(t=>t.notes?.includes(marker));pageToken=list.nextPageToken;
        }while(pageToken&&!found);
        if(!found) throw new Error('Previous Task creation has an uncertain outcome. No matching Task was found. Check Google Tasks before resetting this operation; no duplicate was created by retry.');
        link={...link,googleId:found.id,state:'linked'};
      }
      if(link)this.store.put(owner,'googleLink',key,link);
    }
    if(link?.state==='linked') {
      const result=await this.api(owner,collection+'/'+encodeURIComponent(link.googleId),{method:'PATCH',body:JSON.stringify(payload)});
      link={...link,date:m.date,time:m.time,zone:m.zone,minutes,state:'linked',url:result.htmlLink||link.url,updatedAt:new Date().toISOString()};
      return this.store.put(owner,'googleLink',key,link);
    }
    const googleId=calendar?'dd'+hash(owner+key):null;
    link={id:key,trackId:track.id,milestoneId:m.id,channel,googleId,state:'pending',minutes};
    this.store.put(owner,'googleLink',key,link);
    try {
      let result;
      try{result=await this.api(owner,collection,{method:'POST',body:JSON.stringify({...payload,...(calendar?{id:googleId}:{})})});}
      catch(e){if(calendar&&e.status===409)result=await this.api(owner,collection+'/'+googleId);else throw e;}
      link={...link,googleId:result.id,state:'linked',url:result.htmlLink||null,date:m.date,time:m.time,zone:m.zone,updatedAt:new Date().toISOString()};
      return this.store.put(owner,'googleLink',key,link);
    } catch(e){this.store.put(owner,'googleLink',key,{...link,state:e.status>=400&&e.status<500&&e.status!==408&&e.status!==429?'rejected':'uncertain',error:e.message});throw e;}
  }
}
