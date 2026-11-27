import {hash,randomToken,safeUrl} from './security.js';
import {labels} from '../extension/shared/extract.js';
import {validDate} from '../extension/shared/dates.js';
export function saveCapture(store,vault,input,base){
  const url=safeUrl(input.url).href,origin=new URL(url).origin;
  const milestones=(Array.isArray(input.milestones)?input.milestones:[]).slice(0,30).map(m=>{
    if(!Object.hasOwn(labels,m.kind)||!validDate(m.date)||typeof m.quote!=='string'||!m.quote.trim())throw new Error('Invalid captured milestone. Scan the page again.');
    const sourceUrl=safeUrl(m.sourceUrl||url).href;if(new URL(sourceUrl).origin!==origin)throw new Error('Captured evidence must belong to the scanned site.');
    return {kind:m.kind,label:String(m.label||labels[m.kind]).slice(0,100),sourceLabel:String(m.sourceLabel||m.label||labels[m.kind]).slice(0,100),date:m.date,time:m.time||null,zone:m.zone||null,raw:typeof m.raw==='string'?m.raw:null,quote:m.quote.slice(0,2500),sourceUrl,uncertain:!!m.uncertain,reasons:Array.isArray(m.reasons)?m.reasons.map(String).slice(0,8):[],structured:!!m.structured};
  });
  const links=(Array.isArray(input.links)?input.links:[]).slice(0,10).flatMap(l=>{try{const u=safeUrl(l.url);return u.origin===origin?[{url:u.href,label:String(l.label||'Supporting source').slice(0,100)}]:[];}catch{return [];}});
  for(const old of store.list('_system','capture'))if(old.expires<Date.now())store.remove('_system','capture',old.id);
  const token=randomToken(),id=hash(token);
  store.put('_system','capture',id,{id,expires:Date.now()+15*60000,payload:vault.seal({url,title:String(input.title||'Registration').slice(0,200),milestones,links})});
  return {reviewUrl:base+'/dashboard#capture='+token};
}
export function consumeCapture(store,vault,token){
  const id=hash(token),capture=store.get('_system','capture',id);
  if(!capture||capture.expires<Date.now())throw new Error('This page scan expired or was already opened. Scan the page again in the extension.');
  const payload=vault.open(capture.payload);store.remove('_system','capture',id);return payload;
}
