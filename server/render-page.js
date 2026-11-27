import {existsSync} from 'node:fs';
import http from 'node:http';
import {safeUrl} from './security.js';
import {fetchPublicPage} from './fetch-page.js';
import {readHtml,extract} from '../extension/shared/extract.js';
function browserPath(env){return [env.BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&existsSync(p));}
export async function rendererAvailable(env=process.env){try{await import('playwright-core');return !!browserPath(env);}catch{return false;}}
let occupied=false;
export async function renderPublicPage(url,initialHtml,env=process.env,resourceReader=fetchPublicPage){
  safeUrl(url);if(occupied)throw new Error('Browser recheck is busy. Retry shortly.');
  occupied=true;let browser,denyProxy;
  try{
    const {chromium}=await import('playwright-core');const executablePath=browserPath(env);if(!executablePath)throw new Error('Install Edge/Chromium or configure BROWSER_EXECUTABLE for browser rechecks.');
    // Deny fallback network traffic. All permitted HTTP reads are fulfilled by
    // our DNS-pinned public fetcher; unhandled requests cannot bypass it.
    denyProxy=http.createServer((_q,r)=>{r.writeHead(403);r.end();});denyProxy.on('connect',(_q,s)=>{s.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
    await new Promise(r=>denyProxy.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({executablePath,headless:true,proxy:{server:'http://127.0.0.1:'+denyProxy.address().port},args:['--proxy-bypass-list=<-loopback>','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking']});
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
    await context.routeWebSocket('**/*',socket=>socket.close());
    let requests=0,bytes=0;const failures=[];
    const pageOrigin=new URL(url).origin;
    const reserveRequest=()=>{if(++requests>75)throw new Error('Rendered page request limit exceeded.');};
    const account=body=>{bytes+=Buffer.byteLength(body);if(bytes>16_000_000)throw new Error('Rendered page resource limit exceeded.');};
    await context.route('**/*',async route=>{
      const req=route.request();
      const requestUrl=new URL(req.url()),listen=req.method()==='POST'&&requestUrl.protocol==='https:'&&requestUrl.hostname==='firestore.googleapis.com'&&requestUrl.pathname==='/google.firestore.v1.Firestore/Listen/channel';
      if(listen){try{reserveRequest();const data=await fetchPublicPage(req.url(),0,'resource',{method:'POST',body:req.postData()||'',contentType:req.headers()['content-type']||'application/x-www-form-urlencoded'});account(data.body);return await route.fulfill({status:data.status,headers:{'content-type':data.headers['content-type']||'text/plain','access-control-allow-origin':'*'},body:data.body});}catch(e){failures.push('Read-only Firestore Listen failed: '+e.message);return route.abort();}}
      if(req.method()!=='GET'){
        const target=new URL(req.url()),background=target.origin!==pageOrigin&&(/(?:^|[.-])(?:telemetry|analytics)(?:[.-]|$)|(?:^|\.)google-analytics\.com$/i.test(target.hostname)||/^(?:firebaseinstallations|identitytoolkit|securetoken)\.googleapis\.com$/i.test(target.hostname));
        if(!background&&['document','script','xhr','fetch'].includes(req.resourceType()))failures.push('This source requires a non-GET request to '+target.hostname+target.pathname+'; automatic monitoring is read-only.');return route.abort();
      }
      if(['image','font','media'].includes(req.resourceType()))return route.abort();
      try{
        reserveRequest();
        const target=safeUrl(req.url()).href;
        const data=target===url&&req.isNavigationRequest()?{body:initialHtml,headers:{'content-type':'text/html'},status:200}:await resourceReader(target,0,'resource');
        account(data.body);
        if(data.url&&data.url!==target)return route.fulfill({status:302,headers:{location:data.url}});
        const headers=Object.fromEntries(Object.entries(data.headers||{}).filter(([key])=>/^(content-type|access-control-allow-origin|access-control-allow-credentials|cross-origin-resource-policy)$/i.test(key)));
        await route.fulfill({status:data.status||200,headers,body:data.body});
      }catch(e){if(['document','script','xhr','fetch'].includes(req.resourceType()))failures.push(e.message);await route.abort().catch(()=>{});}
    });
    const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
    // Wait for an asynchronously loaded schedule to stop changing. Polling is
    // bounded and happens in an isolated, cookie-free browser context per read.
    await page.evaluate(async()=>{
      let previous='',stable=0;
      for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,300));const text=document.body?.innerText||'';stable=text===previous?stable+1:0;previous=text;if(text.length>150&&stable>=4)break;}
    });
    const finalUrl=page.url(),result=readHtml(await page.content(),finalUrl);
    const visibleText=await page.evaluate(()=>document.body?.innerText||'');
    const visibleMilestones=extract(visibleText,finalUrl);
    result.text=visibleText;
    if(visibleMilestones.length)result.milestones=visibleMilestones;
    if(failures.length)throw new Error('Browser source read incomplete: '+failures[0]);
    if(!result.milestones.length&&result.text.length<100)throw new Error('Browser could not read the schedule. The source may require sign-in or unsupported network access.');
    return {...result,url:page.url(),rendered:true,readability:'readable',notice:'Live page read in an isolated browser. Dates are re-extracted on each backend check.'};
  }finally{await browser?.close().catch(()=>{});denyProxy?.closeAllConnections();if(denyProxy)await new Promise(r=>denyProxy.close(r));occupied=false;}
}
