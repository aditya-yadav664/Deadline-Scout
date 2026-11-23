import {fetchPublicPage} from './fetch-page.js';
import {validDate,findDates} from '../extension/shared/dates.js';
import {renderPublicPage,rendererAvailable} from './render-page.js';
// Source-specific readers use public data used by the registration site itself.
// Every request still passes the public-address, redirect, size and timeout guard.
export async function readRegistrationSource(url,reader=fetchPublicPage){
  const u=new URL(url),match=u.pathname.match(/^\/events?\/([a-zA-Z0-9_-]+)\/?$/);
  if(u.hostname!=='devnovate.co'||!match){
    const page=await reader(url);
    if(page.hasScripts&&await rendererAvailable())return renderPublicPage(page.url,page.rawHtml);
    return page;
  }
  const endpoint=new URL('/api/v1/events/name/'+encodeURIComponent(match[1]),u.origin).href;
  const {data,raw}=await reader(endpoint,0,'json');const event=data.hackathon;
  if(!event||typeof event.name!=='string')throw new Error('Devnovate returned no public event details.');
  const milestones=[];
  for(const [key,kind,label] of [['registrationDeadline','registration_closes','Registration closes'],['startDate','event','Event date']]){
    const value=event[key];if(typeof value!=='string')continue;
    const quote=raw.match(new RegExp('"'+key+'"\\s*:\\s*"[^"\\n]*"'))?.[0];if(!quote)continue;
    let date=value,time=null,zone=null,reasons=[];
    if(!validDate(value)){
      const parsed=findDates(value.replace(/^(\d{2})-(\d{2})-(\d{4})$/,'$1/$2/$3'))[0];
      if(!parsed)continue;({date,time,zone,reasons}=parsed);
    }
    if(!validDate(date))continue;
    milestones.push({kind,label,date,time,zone,raw:value,quote,sourceUrl:endpoint,uncertain:reasons.length>0,reasons,explicitUpdate:false});
  }
  return {title:event.name,url,text:raw,milestones,links:[],readability:'readable',notice:'Schedule read from Devnovate’s public event data. Confirm the dates below to track them automatically.'};
}
