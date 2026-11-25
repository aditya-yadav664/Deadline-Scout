import {Signups} from './signups.js';
import {dedupeMilestones,milestoneKey} from '../extension/shared/milestone-selection.js';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from './store.js';
import { vault, randomToken, hash, safeUrl } from './security.js';
import { fetchPublicPage } from './fetch-page.js';
import { createEmailAdapter, changeEmail, emailGreeting, welcomeEmail } from './email.js';
import { Google } from './google.js';
import { Engine } from './engine.js';
import { demoHtml } from './demo.js';
import { readHtml, labels } from '../extension/shared/extract.js';
import { validateMilestone, validDate, instant, scheduleKey, impact } from '../extension/shared/dates.js';
import { observationKey } from '../extension/shared/compare.js';
import { modelExtract } from './model.js';
import { readRegistrationSource } from './source-adapters.js';
import {saveCapture,consumeCapture} from './captures.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha256url=s=>createHash('sha256').update(s).digest('base64url');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function isPublicFilePath(path){const relative=path==='/'||path==='/auth/done'?'panel.html':path.slice(1);return /^(?:panel\.(?:html|css|js)|dashboard\.js|backup\.(?:html|js|css)|signup-demo\.(?:html|js)|popup\.(?:html|css|js)|auth-done\.js|worker\.js|api\.js|icon\.svg|icon(?:16|32|48|128)\.png|assets\/(?:logo-(?:symbol|wordmark)\.png|scout-symbol\.svg|orbit-glow\.png|inter\.woff2|icons\/(?:calendar|refresh|external-link|check|chevron-down|arrow-right|link|scan|clock|user|x|list-details)\.svg)|shared\/(?:dates|extract|compare|milestone-selection|page-scanner|backend-url|copied-link|browser-alerts|alert-connection|signup)\.js)$/.test(relative);}
export function createApp(options={}) {
  const env=options.env||process.env;
  const port=Number(env.PORT||4317),host=env.HOST||'127.0.0.1';
  const base=env.APP_URL||`http://localhost:${port}`;
  const dataDir=resolve(env.DATA_DIR||join(root,'data'));
  const store=options.store||new Store(join(dataDir,'deadline-diff.sqlite'));
  const secrets=options.vault||vault(dataDir,env.TOKEN_ENCRYPTION_KEY);
  const email=options.email||createEmailAdapter(env);
  const google=options.google||new Google(store,secrets,env);
  const oauthFetch=options.oauthFetch||fetch;
  const liveAuth=!!(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY);
  const loopback=['localhost','127.0.0.1','::1'].includes(host);
  if(!loopback&&(!liveAuth||!env.TOKEN_ENCRYPTION_KEY))throw new Error('Remote hosting requires Supabase auth and TOKEN_ENCRYPTION_KEY.');
  if(!loopback&&!base.startsWith('https://'))throw new Error('Remote hosting requires an HTTPS APP_URL.');
  const extensionIds=(env.EXTENSION_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  function allowedOrigin(origin) {return origin===new URL(base).origin||/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'')&&(extensionIds.length?extensionIds.includes(origin.slice(19)):loopback);}
  function allowedRedirect(value) {
    let u;try{u=new URL(value);}catch{throw fail('Invalid auth redirect.');}
    const ext=u.hostname.match(/^([a-p]{32})\.chromiumapp\.org$/);
    return u.href===base+'/auth/done'||u.protocol==='https:'&&ext&&u.pathname==='/'&&!u.search&&!u.hash&&(extensionIds.length?extensionIds.includes(ext[1]):loopback);
  }
  async function readPage(url) {
    const u=safeUrl(url);
    // This exact fixture is generated in-process, never fetched over a network.
    if(u.origin===new URL(base).origin&&/^\/demo\/(registration|faq)$/.test(u.pathname)&&!u.search){const state=store.get('_system','demo','state')||{mode:'original'};return {...readHtml(demoHtml(u.pathname,state),u.href),url:u.href};}
    const page=await readRegistrationSource(u.href);
    if(env.GEMINI_API_KEY){
      const assisted=await modelExtract(page.text,u.href,env);
      page.milestones.push(...assisted.filter(m=>!page.milestones.some(existing=>existing.kind===m.kind&&scheduleKey(existing)===scheduleKey(m)&&(m.kind!=='custom'||existing.label===m.label))));
    }
    return page;
  }
  const signups=new Signups({store,secrets,base});
  const engine=options.engine||new Engine({store,readPage:options.readPage||readPage,email,google});
  engine.backups=signups;
  function session(owner,scope,parentSession) {const token=randomToken();store.put('_system','session',hash(token),{owner,...(scope?{scope}:{}),...(parentSession?{parentSession}:{}),expires:Date.now()+30*86400000});return token;}
  async function body(req) {let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>300000)throw fail('Request too large.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw fail('Invalid JSON.');}}
  function profileFor(owner) {return store.get(owner,'profile','me')||{email:'',emailEnabled:false,emailVerified:false};}
  function changesFor(owner){const active=new Set(store.list(owner,'track').map(t=>t.id));return store.list(owner,'change').filter(c=>active.has(c.trackId)).sort((a,b)=>b.at.localeCompare(a.at));}
  function enrich(owner,t) {return {...t,googleLinks:store.list(owner,'googleLink').filter(l=>l.trackId===t.id)};}
  const buckets=new Map();
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:* https:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const send=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    const redirect=(url,cookie)=>{if(cookie)res.setHeader('Set-Cookie',cookie);res.writeHead(302,{Location:url});res.end();};
    try {
      if(origin&&!allowedOrigin(origin))throw fail('Origin not allowed.',403);
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');}
      if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
      const u=new URL(req.url,base),path=u.pathname;
      if(path==='/api/config')return send({name:'Deadline Scout',auth:liveAuth?'supabase':'local',email:email.mode,model:!!env.GEMINI_API_KEY,base,googleConfigured:liveAuth&&!!env.GOOGLE_CLIENT_ID&&!!env.GOOGLE_CLIENT_SECRET});
      if(path==='/api/demo-organizer/schema'&&req.method==='GET')return send(signups.schema());
      if(path==='/api/signup-captures'&&req.method==='POST'){const key='signup-capture:'+req.socket.remoteAddress,q=buckets.get(key)||{count:0,until:Date.now()+60000};if(q.until<Date.now()){q.count=0;q.until=Date.now()+60000;}q.count++;buckets.set(key,q);if(q.count>20)throw fail('Too many form captures. Wait one minute.',429);for(const old of store.list('_system','signupCapture'))if(old.expires<Date.now())store.remove('_system','signupCapture',old.id);const b=await body(req),step=signups.capture(b.step),token=randomToken();store.put('_system','signupCapture',hash(token),{id:hash(token),expires:Date.now()+600000,sealed:secrets.seal({step,extensionId:b.extensionId})});return send({url:base+'/backup.html#capture='+token});}
      if(path==='/health')return send({ok:true});
      if(path==='/api/captures'&&req.method==='POST'){
        const key='capture:'+req.socket.remoteAddress,b=buckets.get(key)||{count:0,until:Date.now()+60000};if(b.until<Date.now()){b.count=0;b.until=Date.now()+60000;}b.count++;buckets.set(key,b);if(b.count>20)throw fail('Too many scans. Wait one minute.',429);
        return send(saveCapture(store,secrets,await body(req),base),201);
      }
      if(/^\/api\/captures\/[A-Za-z0-9_-]{43}$/.test(path)&&req.method==='GET')return send(consumeCapture(store,secrets,path.split('/').at(-1)));
      if(path==='/api/inspect'&&req.method==='POST'){
        const key='preview:'+req.socket.remoteAddress;
        const bucket=buckets.get(key)||{count:0,until:Date.now()+60000};
        if(bucket.until<Date.now()){bucket.count=0;bucket.until=Date.now()+60000;}
        bucket.count++;buckets.set(key,bucket);
        if(bucket.count>20)throw fail('Too many URL previews. Wait one minute.',429);
        const b=await body(req);return send(await readPage(b.url));
      }
      if(path==='/api/local-session'&&req.method==='POST'){
        if(liveAuth||!loopback)throw fail('Local demo sign-in is disabled.',403);
        const owner='local-demo';if(!store.get(owner,'profile','me'))store.put(owner,'profile','me',{email:'demo@localhost',emailVerified:false,emailEnabled:email.mode==='demo',local:true});
        return send({token:session(owner)});
      }
      if(path==='/api/auth/prepare'&&req.method==='POST'){
        if(!liveAuth)throw fail('Configure Supabase before connecting Google.');
        const b=await body(req);if(!allowedRedirect(b.redirect)||!/^[A-Za-z0-9_-]{43}$/.test(b.challenge||''))throw fail('Invalid OAuth redirect or PKCE challenge.');
        const id=randomToken();store.put('_system','oauth',hash(id),{redirect:b.redirect,challenge:b.challenge,verifier:secrets.seal(randomToken()),expires:Date.now()+600000});
        return send({url:base+'/auth/start?flow='+id});
      }
      if(path==='/auth/start'){
        const flow=u.searchParams.get('flow'),state=store.get('_system','oauth',hash(flow||''));if(!state||state.expires<Date.now())throw fail('Sign-in expired. Start again.');
        const callback=base+'/auth/callback?flow='+encodeURIComponent(flow);
        const url=new URL(env.SUPABASE_URL+'/auth/v1/authorize');
        url.search=new URLSearchParams({provider:'google',redirect_to:callback,scopes:'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.settings.readonly https://www.googleapis.com/auth/tasks',code_challenge:sha256url(secrets.open(state.verifier)),code_challenge_method:'s256',access_type:'offline',prompt:'select_account consent'});
        return redirect(url.href,`dd_oauth=${hash(flow)}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${base.startsWith('https:')?'; Secure':''}`);
      }
      if(path==='/auth/callback'){
        const flow=u.searchParams.get('flow'),key=hash(flow||''),state=store.get('_system','oauth',key);
        if(!state||state.expires<Date.now()||!req.headers.cookie?.split(';').some(c=>c.trim()===`dd_oauth=${key}`))throw fail('Sign-in state expired or browser cookie missing. Start again.');
        store.remove('_system','oauth',key);
        if(!u.searchParams.get('code'))throw fail('Google sign-in was cancelled or not authorized.');
        const r=await oauthFetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=pkce',{method:'POST',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({auth_code:u.searchParams.get('code'),code_verifier:secrets.open(state.verifier)})});
        const s=await r.json();if(!r.ok)throw fail('Supabase code exchange failed. Check the callback allowlist and Google provider configuration.');
        const userResponse=await oauthFetch(env.SUPABASE_URL+'/auth/v1/user',{signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${s.access_token}`}});
        const user=await userResponse.json();if(!userResponse.ok||!user.id||!user.email_confirmed_at)throw fail('Google account email could not be verified.',401);
        const existing=store.get(user.id,'profile','me'),p=existing||{},old=p.google?secrets.open(p.google):{};
        Object.assign(p,{email:user.email,googleEmail:user.email,emailVerified:true,local:false,emailEnabled:p.emailEnabled??true});
        const googleName=user.user_metadata?.full_name||user.user_metadata?.name;if(typeof googleName==='string')p.googleName=googleName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80);
        if(s.provider_token)p.google=secrets.seal({access_token:s.provider_token,refresh_token:s.provider_refresh_token||old.refresh_token,expires_at:Date.now()+45*60000});
        delete p.googleError;
        store.transaction(()=>{
          if(!existing){
            const now=Date.now();p.welcomeQueuedAt=new Date(now).toISOString();
            store.put(user.id,'delivery','welcome:email',{id:'welcome:email',channel:'email',type:'welcome',status:'queued',to:p.email,...welcomeEmail(p,base),attempts:0,createdAt:now,nextTry:now,at:p.welcomeQueuedAt});
          }
          store.put(user.id,'profile','me',p);
        });
        await engine.deliver(user.id);
        const code=randomToken();store.put('_system','redeem',hash(code),{owner:user.id,challenge:state.challenge,expires:Date.now()+60000});
        return redirect(state.redirect+'#code='+code,'dd_oauth=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0');
      }
      if(path==='/api/auth/redeem'&&req.method==='POST'){
        const b=await body(req),key=hash(b.code||''),r=store.get('_system','redeem',key);
        if(!r||r.expires<Date.now()||sha256url(b.verifier||'')!==r.challenge||r.extensionId&&(b.extensionId!==r.extensionId||origin&&origin!=='chrome-extension://'+r.extensionId))throw fail('Invalid sign-in exchange.',401);
        if(r.parentSession){const parent=store.get('_system','session',r.parentSession);if(!parent||parent.owner!==r.owner||parent.expires<Date.now())throw fail('Website sign-in expired. Sign in and restart alert setup.',401);}
        store.remove('_system','redeem',key);return send({token:session(r.owner,r.scope,r.parentSession),...(r.scope==='browser-alerts'?{email:profileFor(r.owner).email}:{})});
      }
      if(path.startsWith('/api/')){
        const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];const auth=token&&store.get('_system','session',hash(token));
        if(!auth||auth.expires<Date.now()||liveAuth&&auth.owner==='local-demo')throw fail('Sign in to continue.',401);
        const owner=auth.owner;
        if(auth.scope==='browser-alerts'&&auth.parentSession){const parent=store.get('_system','session',auth.parentSession);if(!parent||parent.owner!==owner||parent.expires<Date.now())throw fail('Sign in to the dashboard and reconnect background alerts.',401);}
        if(auth.scope==='browser-alerts'&&!['GET /api/me','GET /api/alerts','POST /api/alerts/ack','POST /api/logout'].includes(req.method+' '+path))throw fail('This session is limited to browser alerts.',403);
        const bucket=buckets.get(owner)||{count:0,until:Date.now()+60000};if(bucket.until<Date.now()){bucket.count=0;bucket.until=Date.now()+60000;}bucket.count++;buckets.set(owner,bucket);if(bucket.count>180)throw fail('Too many requests. Wait one minute.',429);
        if(path==='/api/auth/extension-session'&&req.method==='POST'){
          const b=await body(req);if(!/^[a-p]{32}$/.test(b.extensionId||'')||!(extensionIds.length?extensionIds.includes(b.extensionId):loopback)||!/^[A-Za-z0-9_-]{43}$/.test(b.challenge||''))throw fail('Invalid extension alert setup.');
          const code=randomToken();store.put('_system','redeem',hash(code),{owner,challenge:b.challenge,extensionId:b.extensionId,scope:'browser-alerts',parentSession:hash(token),expires:Date.now()+60000});return send({code});
        }
        if(path.startsWith('/api/signup')||path.startsWith('/api/signups')){
          if(path.startsWith('/api/signup-captures/')&&req.method==='GET'){const key=hash(path.split('/').at(-1)),c=store.get('_system','signupCapture',key);if(!c||c.expires<Date.now())throw fail('Capture expired. Scan the form again.',404);store.remove('_system','signupCapture',key);return send(secrets.open(c.sealed));}
          return send(await signups.route(owner,path,req.method,req.method==='GET'?{}:await body(req)));
        }
        if(path==='/api/account/clear-data'&&req.method==='POST'){
          const b=await body(req);if(b.action!=='clear-account-data')throw fail('Choose Clear account data to continue.');
          if([...engine.locks].some(key=>key.startsWith(owner+':'))||engine.delivering.has(owner))throw fail('A check or delivery is running. Try again when it finishes.',409);
          const deleted=store.transaction(()=>{for(const r of store.list('_system','demoSignup'))if(r.owner===owner&&r.key)store.remove('_system','demoSignup',r.key);return store.clearKinds(owner,['track','change','delivery','googleLink','signup','signupFile','signupProfile','dashboard']);});return send({ok:true,deleted});
        }
        if(path==='/api/logout'&&req.method==='POST'){store.remove('_system','session',hash(token));return send({ok:true});}
        if(['/api/me','/api/workspace'].includes(path)&&req.method==='GET') {const p=profileFor(owner),me={displayName:p.displayName||p.googleName||'',email:p.email,emailVerified:p.emailVerified,emailEnabled:p.emailEnabled,googleConnected:!!p.google,googleError:p.googleError,local:!!p.local};return send(path==='/api/me'?me:{me,tracks:store.list(owner,'track').map(t=>enrich(owner,t)),changes:changesFor(owner),dashboard:store.get(owner,'dashboard','preferences')||{groups:[],pinnedIds:[],seenChangeIds:[]}});}
        if(path==='/api/dashboard'&&req.method==='PATCH'){
          const b=await body(req),p=store.get(owner,'dashboard','preferences')||{groups:[],pinnedIds:[],seenChangeIds:[]},active=new Set(store.list(owner,'track').map(t=>t.id));
          if(b.groups!==undefined){if(!Array.isArray(b.groups)||b.groups.length>50)throw fail('Maximum 50 groups.');const names=new Set(),ids=new Set();p.groups=b.groups.map(g=>{const name=String(g.name||'').trim().slice(0,80),id=String(g.id||'');if(!name||names.has(name.toLowerCase())||!id||ids.has(id)||id.length>100||!Array.isArray(g.trackIds))throw fail('Each group needs a unique name.');names.add(name.toLowerCase());ids.add(id);return {id,name,trackIds:[...new Set(g.trackIds)].filter(id=>active.has(id))};});}
          if(b.pinnedIds!==undefined){if(!Array.isArray(b.pinnedIds))throw fail('Invalid pins.');p.pinnedIds=[...new Set(b.pinnedIds)].filter(id=>active.has(id));}store.put(owner,'dashboard','preferences',p);return send(p);
        }
        if(path==='/api/dashboard/seen'&&req.method==='POST'){
          const b=await body(req),p=store.get(owner,'dashboard','preferences')||{groups:[],pinnedIds:[],seenChangeIds:[]},active=new Set(changesFor(owner).map(c=>c.id));if(!Array.isArray(b.ids)||b.ids.length>100)throw fail('Invalid notification list.');p.seenChangeIds=[...new Set([...(p.seenChangeIds||[]),...b.ids.filter(id=>active.has(id))])].slice(-2000);store.put(owner,'dashboard','preferences',p);return send({ok:true});
        }
        if(path==='/api/profile/google-name'&&req.method==='POST'){
          let p=profileFor(owner);if(!p.googleName&&p.google){const info=await google.api(owner,'https://openidconnect.googleapis.com/v1/userinfo');p=profileFor(owner);if(typeof info.name==='string'){p.googleName=info.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,80);store.put(owner,'profile','me',p);}}
          return send({displayName:p.displayName||p.googleName||''});
        }
        if(path==='/api/me'&&req.method==='PATCH'){
          const b=await body(req);if(typeof b.displayName!=='string'||b.displayName.trim().length>80||/[\u0000-\u001f\u007f]/.test(b.displayName))throw fail('Use a name of up to 80 characters without line breaks.');
          const p=profileFor(owner);p.displayName=b.displayName.trim();store.put(owner,'profile','me',p);return send({displayName:p.displayName||p.googleName||''});
        }
        if(path==='/api/settings'&&req.method==='PATCH') {
          const b=await body(req),p=profileFor(owner);if(b.emailEnabled&&!p.emailVerified&&!(email.mode==='demo'&&p.local))throw fail('Verify the recipient email before enabling alerts.');p.emailEnabled=!!b.emailEnabled;store.put(owner,'profile','me',p);return send({ok:true});
        }
        if(path==='/api/google/disconnect'&&req.method==='POST'){const p=profileFor(owner);delete p.google;delete p.googleError;store.put(owner,'profile','me',p);return send({ok:true});}
        if(path==='/api/email/verify/request'&&req.method==='POST'){
          const b=await body(req);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email||''))throw fail('Enter a valid email address.');
          const old=store.get(owner,'verification','email');if(old?.sentAt>Date.now()-60000)throw fail('Wait a minute before requesting another code.',429);
          const code=String((await import('node:crypto')).randomInt(100000,1000000));
          store.put(owner,'verification','email',{email:b.email,codeHash:hash(code),expires:Date.now()+600000,attempts:0,sentAt:Date.now(),mode:email.mode});
          const delivery={id:randomUUID(),channel:'verification',to:b.email,subject:'Verify your Deadline Scout email',text:`Your verification code is ${code}. It expires in 10 minutes.`,at:new Date().toISOString()};
          Object.assign(delivery,await email.send({...delivery,id:delivery.id}));if(email.mode!=='demo')delete delivery.text;store.put(owner,'delivery',delivery.id,delivery);return send({ok:true,mode:email.mode});
        }
        if(path==='/api/email/verify/confirm'&&req.method==='POST'){
          const b=await body(req),v=store.get(owner,'verification','email');if(!v||v.expires<Date.now()||v.attempts>=5)throw fail('Verification expired. Request a new code.');
          v.attempts++;store.put(owner,'verification','email',v);if(hash(String(b.code))!==v.codeHash)throw fail('Incorrect verification code.');
          const p=profileFor(owner);p.email=v.email;p.emailVerified=v.mode==='brevo';p.emailEnabled=p.emailVerified;store.put(owner,'profile','me',p);store.remove(owner,'verification','email');return send({ok:true,demo:v.mode!=='brevo'});
        }
        if(path==='/api/email/test'&&req.method==='POST'){
          const p=profileFor(owner);if(!p.emailVerified&&!(email.mode==='demo'&&p.local))throw fail('Verify your email first.');
          const id=randomUUID(),d={id,channel:'test',to:p.email,subject:'Deadline Scout test email',text:emailGreeting(p)+'\n\nDeadline Scout email alerts are connected. This is a user-requested test.',at:new Date().toISOString()};Object.assign(d,await email.send(d));store.put(owner,'delivery',id,d);return send(d);
        }
        if(path==='/api/inspect'&&req.method==='POST'){
          const b=await body(req);return send(await readPage(b.url));
        }
        if(path==='/api/tracks'&&req.method==='GET')return send(store.list(owner,'track').map(t=>enrich(owner,t)));
        if(path==='/api/tracks'&&req.method==='POST'){
          const b=await body(req),url=safeUrl(b.url).href;
          if(!b.milestones?.length||b.milestones.length>15)throw fail('Select between 1 and 15 milestones.');
          if(b.plan&&!validDate(b.plan))throw fail('Invalid planned date.');
          const sources=[...new Set([url,...(b.sources||[]).map(s=>safeUrl(s).href)])];
          if(sources.length>5||sources.some(s=>new URL(s).origin!==new URL(url).origin))throw fail('Use at most five same-site sources.');
          const milestones=dedupeMilestones(b.milestones).map(m=>{if(!Object.hasOwn(labels,m.kind))throw fail('Invalid milestone kind.');validateMilestone(m);if(m.time)instant(m);return {id:randomUUID(),kind:m.kind,label:String(m.label||labels[m.kind]).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,100)||labels[m.kind],sourceLabel:String(m.sourceLabel||m.label||labels[m.kind]).slice(0,100),date:m.date,time:m.time||null,zone:m.time?m.zone:null,quote:String(m.quote||'').slice(0,2000),sourceUrl:m.sourceUrl&&safeUrl(m.sourceUrl).origin===new URL(url).origin?safeUrl(m.sourceUrl).href:url,manual:!!m.manual,uncertain:false,reasons:[],confirmed:true,confirmedRaw:m.raw||null,confirmedDetectedTime:m.detected?m.detected.time:m.time||null,confirmedDetectedZone:m.detected?m.detected.zone:m.zone||null,confirmedQuote:m.model?m.quote:null};});
          const signature=ms=>ms.map(milestoneKey).sort().join("\n");
          const existing=store.list(owner,'track').find(t=>t.url===url&&t.title===String(b.title||'Registration').slice(0,200)&&signature(t.milestones)===signature(milestones)&&t.plan===(b.plan||null));
          if(existing)return send(enrich(owner,existing));
          const t={id:randomUUID(),title:String(b.title||'Registration').slice(0,200),url,sources,milestones,plan:b.plan||null,intervalMinutes:60,nextCheck:Date.now()+3600000,createdAt:new Date().toISOString(),status:milestones.every(m=>m.manual)?'manual':'watching',errors:[],conflicts:[],uncertain:[]};
          return send(enrich(owner,store.put(owner,'track',t.id,t)),201);
        }
        const match=path.match(/^\/api\/tracks\/([^/]+)(?:\/(check|google|preview|resolve|monitor))?$/);
        if(match){
          const id=match[1],action=match[2],t=store.get(owner,'track',id);if(!t)throw fail('Tracking record not found.',404);
          if(action==='check'&&req.method==='POST')return send(enrich(owner,await engine.check(owner,id)));
          if(action==='monitor'&&req.method==='POST'){
            const b=await body(req);if(!b.approved)throw fail('Approve enabling automatic source monitoring.');
            const lock=owner+':'+id;if(engine.locks.has(lock))throw fail('A source check is already in progress.');engine.locks.add(lock);
            try{
              const observations=[];for(const source of t.sources)observations.push(await readPage(source));
              let enabled=0;
              for(const m of t.milestones.filter(m=>m.manual)){
                const candidates=observations.flatMap(o=>o.milestones).filter(c=>c.kind===m.kind);
                if(!candidates.length||candidates.some(c=>c.uncertain))continue;
                if(new Set(candidates.map(scheduleKey)).size!==1)continue;
                m.manual=false;enabled++;
              }
              if(!enabled)throw fail('No unambiguous matching milestone could be read from the source. Keep the reminder manual or inspect the page again.');
              store.put(owner,'track',id,t);
            }finally{engine.locks.delete(lock);}
            return send(enrich(owner,await engine.check(owner,id)));
          }
          if(!action&&req.method==='DELETE'){
            if(engine.delivering.has(owner)||(engine.locks.has(owner+':'+id)&&!engine.reading.has(owner+':'+id)))throw fail('A Google update or email delivery is already in progress. Retry removal when it finishes.',409);
            store.transaction(()=>{
              const related=store.list(owner,'change').filter(c=>c.trackId===id),changeIds=new Set(related.map(c=>c.id));
              for(const draft of signups.list(owner).filter(d=>d.trackId===id)){draft.status='Cancelled';signups.save(owner,draft);}
              store.remove(owner,'track',id);for(const c of related)store.remove(owner,'change',c.id);
              for(const d of store.list(owner,'delivery').filter(d=>d.trackId===id||changeIds.has(d.changeId))){if(d.channel==='browser')store.remove(owner,'delivery',d.id);else if(['queued','retry','sending'].includes(d.status))store.put(owner,'delivery',d.id,{...d,status:'cancelled',error:'Registration removed; alert cancelled.'});}
              for(const link of store.list(owner,'googleLink').filter(l=>l.trackId===id))store.remove(owner,'googleLink',link.id);
            });return send({ok:true});
          }
          if(!action&&req.method==='PATCH'){
            if(engine.locks.has(owner+':'+id))throw fail('Wait for the current operation.');const b=await body(req);
            if(b.intervalMinutes!==undefined){if(!Number.isInteger(b.intervalMinutes)||b.intervalMinutes<5||b.intervalMinutes>10080)throw fail('Choose an interval between 5 minutes and 7 days.');t.intervalMinutes=b.intervalMinutes;t.nextCheck=Date.now()+b.intervalMinutes*60000;}
            if(b.plan!==undefined){if(b.plan&&!validDate(b.plan))throw fail('Invalid planned date.');t.plan=b.plan||null;}
            if(b.addSource){const s=safeUrl(b.addSource).href;if(new URL(s).origin!==new URL(t.url).origin||t.sources.length>=5)throw fail('Add a same-site source (maximum five).');if(!t.sources.includes(s))t.sources.push(s);}
            return send(enrich(owner,store.put(owner,'track',id,t)));
          }
          if(action==='resolve'&&req.method==='POST'){
            if(engine.locks.has(owner+':'+id))throw fail('Wait for the current operation.');
            const b=await body(req),m=t.milestones.find(m=>m.id===b.milestoneId);if(!m)throw fail('Milestone not found.');
            const reviewCandidates=[...(t.conflicts||[]),...(t.uncertain||[])].filter(c=>c.milestoneId?c.milestoneId===m.id:c.kind===m.kind).flatMap(c=>c.candidates);
            const candidate=reviewCandidates.find(c=>c.date===(b.sourceDate||b.date)&&c.sourceUrl===b.sourceUrl);
            if(!candidate||!b.approved)throw fail('Select and approve a source candidate.');
            const chosen={...candidate,date:b.date,time:b.time||null,zone:b.time?b.zone:null};validateMilestone(chosen);if(chosen.time)instant(chosen);
            const change={id:randomUUID(),trackId:t.id,title:t.title,kind:m.kind,label:m.label,before:{...m},after:{...m,...chosen,label:m.label,sourceLabel:m.sourceLabel||chosen.label,uncertain:false,confirmedRaw:chosen.raw||null,confirmedDetectedTime:candidate.time??null,confirmedDetectedZone:candidate.zone??null,confirmedQuote:candidate.model?candidate.quote:null},impact:impact(t.plan,chosen),at:new Date().toISOString()};
            t.resolutions||={};t.resolutions[m.id]={observation:observationKey(reviewCandidates),chosen:scheduleKey(chosen),sourceUrl:chosen.sourceUrl};
            Object.assign(m,change.after);t.conflicts=t.conflicts.filter(c=>c.milestoneId?c.milestoneId!==m.id:c.kind!==m.kind);t.uncertain=t.uncertain.filter(c=>c.milestoneId?c.milestoneId!==m.id:c.kind!==m.kind);t.status=t.conflicts.length?'conflict':t.uncertain.length?'needs_review':'watching';
            store.transaction(()=>{store.put(owner,'track',id,t);if(scheduleKey(change.before)!==scheduleKey(change.after)){
              store.put(owner,'change',change.id,change);store.put(owner,'delivery',change.id+':browser',{id:change.id+':browser',changeId:change.id,trackId:t.id,channel:'browser',status:'queued',at:change.at});
              const p=profileFor(owner);if(p.emailEnabled&&(p.emailVerified||email.mode==='demo'&&p.local))store.put(owner,'delivery',change.id+':email',{id:change.id+':email',changeId:change.id,trackId:t.id,channel:'email',status:'queued',to:p.email,...changeEmail(t,change,p),attempts:0,createdAt:Date.now(),nextTry:Date.now(),at:change.at});
            }});const lock=owner+':'+id;engine.locks.add(lock);
            try{await engine.syncGoogle(owner,t,true);await engine.deliver(owner);return send(enrich(owner,t));}finally{engine.locks.delete(lock);}
          }
          if(['google','preview'].includes(action)&&req.method==='POST'){
            const b=await body(req),m=t.milestones.find(m=>m.id===b.milestoneId);if(!m)throw fail('Select a milestone.');
            const minutes=b.minutes??1440;if(!Number.isInteger(minutes)||minutes<0||minutes>40320)throw fail('Invalid reminder timing.');
            if(action==='preview')return send(await google.preview(owner,m,minutes));
            if(!['calendar','task'].includes(b.channel)||!b.approved)throw fail('Approve the Calendar or Task action.');
            const lock=owner+':'+id;if(engine.locks.has(lock))throw fail('An operation is already running.');engine.locks.add(lock);
            try{return send(await google.perform(owner,t,m,b.channel,minutes));}finally{engine.locks.delete(lock);}
          }
        }
        if(path==='/api/changes'&&req.method==='GET')return send(changesFor(owner));
        if(path==='/api/deliveries'&&req.method==='GET')return send(store.list(owner,'delivery'));
        if(path==='/api/alerts'&&req.method==='GET'){const active=new Map(changesFor(owner).map(c=>[c.id,c]));return send(store.list(owner,'delivery').filter(d=>d.channel==='browser'&&d.status==='queued'&&(active.has(d.changeId)||d.signupId&&store.get(owner,'track',d.trackId)&&store.get(owner,'signup',d.signupId)?.status!=='Cancelled')).map(d=>({...d,change:active.get(d.changeId)})));}
        if(path==='/api/alerts/ack'&&req.method==='POST'){const b=await body(req),d=store.get(owner,'delivery',b.id);if(d?.channel==='browser'){d.status='shown';store.put(owner,'delivery',d.id,d);}return send({ok:true});}
        if(path==='/api/demo'&&req.method==='POST'){
          if(!loopback||env.ENABLE_DEMO==='false')throw fail('Demo fixtures are disabled.',403);const b=await body(req);if(!['original','changed','conflict','failed','reworded'].includes(b.mode))throw fail('Invalid demo state.');store.put('_system','demo','state',{mode:b.mode});return send({ok:true});
        }
        throw fail('API route not found.',404);
      }
      if(/^\/demo\/(registration|faq)$/.test(path)){
        if(!loopback||env.ENABLE_DEMO==='false')throw fail('Demo disabled.',404);
        res.removeHeader('Content-Security-Policy');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(demoHtml(path,store.get('_system','demo','state')||{mode:'original'}));
      }
      const relative=path==='/'||path==='/auth/done'?'panel.html':path.slice(1);
      if(!isPublicFilePath(path))throw fail('Page not found.',404);
      res.setHeader('Content-Type',relative.endsWith('.html')?'text/html; charset=utf-8':relative.endsWith('.css')?'text/css':relative.endsWith('.svg')?'image/svg+xml':relative.endsWith('.png')?'image/png':relative.endsWith('.woff2')?'font/woff2':'text/javascript');const content=readFileSync(join(root,'extension',relative)),etag='\"'+createHash('sha256').update(content).digest('base64url')+'\"';
      res.setHeader('Cache-Control','public, max-age=0, must-revalidate');res.setHeader('ETag',etag);if(req.headers['if-none-match']===etag){res.statusCode=304;return res.end();}res.end(content);
    }catch(e){if(!res.headersSent)send({error:e.message},e.status||400);else res.end();}
  });
  return {server,store,engine,google,signups,base,host,port,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}
