import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { safeUrl, publicAddress } from './security.js';
import { readHtml } from '../extension/shared/extract.js';
export async function fetchPublicPage(value, redirects=0, mode='page',request={}) {
  const url=safeUrl(value);
  const listening=url.protocol==='https:'&&url.hostname==='firestore.googleapis.com'&&url.pathname==='/google.firestore.v1.Firestore/Listen/channel';
  if(request.method&&request.method!=='GET'&&!(listening&&request.method==='POST'&&mode==='resource'))throw new Error('Only public reads and Firestore Listen requests are allowed.');
  if(Buffer.byteLength(request.body||'')>65536)throw new Error('Read request exceeds 64 KB.');
  if(redirects>4) throw new Error('Too many redirects.');
  if(url.port && !['80','443'].includes(url.port)) throw new Error('Only public web ports 80 and 443 are allowed.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  let addresses;
  for(let attempt=0;attempt<3;attempt++){
    try{addresses=await lookup(hostname,{all:true});break;}
    catch(error){if(!['ENOTFOUND','EAI_AGAIN','ETIMEOUT'].includes(error.code)||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
  }
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('Blocked URL: private, local, and reserved destinations are not allowed.');
  // Pin the validated DNS result; do not resolve again at connection time.
  const chosen=addresses.find(a=>a.family===4)||addresses[0];
  const result=await new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).request(url,{
      method:request.method||'GET',
      headers:{'User-Agent':'DeadlineScout/1.1 (user-requested schedule monitor)','Accept':mode==='json'?'application/json':'text/html,application/xhtml+xml,text/plain,*/*','Cache-Control':'no-cache','Pragma':'no-cache',...(request.contentType?{'Content-Type':request.contentType}:{})},
      lookup:(_name,options,cb)=>options.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)
    },res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {res.resume();return resolve({redirect:res.headers.location});}
      if([401,403].includes(res.statusCode)) {res.resume();return reject(new Error(res.statusCode===401?'Login required: this page cannot be monitored by the backend.':'Blocked page (403): use a manual reminder or a public source.'));}
      if(res.statusCode<200||res.statusCode>=300){res.resume();return reject(new Error(`Page fetch failed: HTTP ${res.statusCode}.`));}
      if(mode!=='resource'&&!(mode==='json'?/application\/(?:[a-z.+-]*\+)?json/i:/text\/(html|plain)|application\/xhtml\+xml/i).test(res.headers['content-type']||'')){res.resume();return reject(new Error('Unsupported source content type.'));}
      let size=0,chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>2_000_000){res.destroy();reject(new Error('Page exceeds 2 MB limit.'));}else chunks.push(chunk);});
      res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),headers:res.headers,status:res.statusCode}));res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(new Error('Page fetch timed out (15 seconds).')),15000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);
    req.end(request.body||undefined);
  });
  if(result.redirect){if(request.method==='POST')throw new Error('Firestore Listen redirects are not followed.');return fetchPublicPage(new URL(result.redirect,url).href,redirects+1,mode);}
  if(mode==='json')return {data:JSON.parse(result.html),raw:result.html,url:url.href};
  if(mode==='resource')return {body:result.html,headers:result.headers,status:result.status,url:url.href};
  const page=readHtml(result.html,url.href);
  if(!page.milestones.length && /sign in to continue|log in to continue|enable javascript|checking your browser|verify you are human/i.test(page.text)) throw new Error('Login, JavaScript, or browser verification required. Backend cannot read the schedule; use a manual reminder.');
  const requiresBrowser=!page.milestones.length&&page.text.length<300&&/<script\b[^>]*\bsrc\s*=/i.test(result.html);
  return {...page,url:url.href,rawHtml:result.html,hasScripts:/<script\b(?![^>]*type=["']application\/ld\+json)/i.test(result.html),readability:requiresBrowser?'requires_browser':'readable',notice:requiresBrowser?'This page needs browser rendering to read its live schedule.':null};
}
