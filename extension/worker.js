import {startSignupSession,pollSignupJobs} from './shared/signup-background.js';
import {fillPendingSignup} from './shared/signup-resume.js';
import {handleAlertConnection} from './shared/alert-connection.js';
import {deliverBrowserAlerts} from './shared/browser-alerts.js';
import {api,storage,settings,connectGoogle} from './api.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(console.error);
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('surface-alerts',{periodInMinutes:1});chrome.alarms.create('signup-jobs',{periodInMinutes:1});});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('surface-alerts',{periodInMinutes:1});surfaceAlerts();chrome.alarms.create('signup-jobs',{periodInMinutes:1});backgroundSignups();});
let busy=false;
async function surfaceAlerts(){
  if(busy)return;busy=true;
  try{
    if(!await storage.get('token')||!await chrome.permissions.contains({permissions:['notifications']}))return;
    if(await chrome.notifications.getPermissionLevel()==='denied')return;
    await deliverBrowserAlerts({load:()=>api('/api/alerts'),notify:async alert=>{
      if(alert.notice)await storage.set('signupNotice:'+alert.id,alert.notice.url);const c=alert.change||{title:alert.notice.title,label:alert.notice.label,before:{date:''},after:{date:''},impact:alert.notice.message};await chrome.notifications.create(alert.id,{type:'basic',iconUrl:'icon128.png',title:`${c.title}: ${c.label}`,message:alert.notice?alert.notice.message:`${c.before.date} → ${c.after.date}\n${c.impact}`,priority:2});
    },ack:id=>api('/api/alerts/ack','POST',{id})});
  }catch{/* The durable backend queue is read on the next wakeup. */}finally{busy=false;}
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='surface-alerts')surfaceAlerts();if(['signup-jobs','signup-wakeup'].includes(a.name))backgroundSignups();});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(['signup-fill-now','signup-form-changed'].includes(message.type)){(async()=>{const pending=await storage.get('signupResume');if(message.type==='signup-fill-now'&&_sender.url?.startsWith(chrome.runtime.getURL(''))){if(!pending||pending.expires<Date.now())throw Error('Session expired. Start Fill form now from your draft again.');pending.tabId=message.tabId;await storage.set('signupResume',pending);}else if(!pending||pending.tabId!==_sender.tab?.id)throw Error('No active signup session.');return runSignupFill(message.tabId||_sender.tab.id,{force:message.type==='signup-fill-now',preferredIndex:message.type==='signup-fill-now'?message.stepIndex:undefined});})().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;}
  if(message.type==='surface-alerts'){surfaceAlerts().then(()=>respond({ok:true}));return true;}
  if(message.type==='connect-google'){connectGoogle().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
});
let notificationClickRegistered=false;
function registerNotificationClick(){if(notificationClickRegistered||!chrome.notifications?.onClicked)return;chrome.notifications.onClicked.addListener(async id=>{const backend=(await settings()).backendUrl,notice=await storage.get('signupNotice:'+id);await chrome.tabs.create({url:notice&&new URL(notice).origin===new URL(backend).origin?notice:backend+'/#timeline'});});notificationClickRegistered=true;}
registerNotificationClick();chrome.permissions.onAdded.addListener(permissions=>{if(permissions.permissions?.includes('notifications'))registerNotificationClick();});

chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  if(message?.type==='scout-signup-resume'){
    (async()=>{const backend=(await settings()).backendUrl;if(new URL(sender.url||sender.tab?.url).origin!==new URL(backend).origin)throw Error('Untrusted resume page.');const result=await startSignupSession({browser:chrome,storage,draft:message.draft,filePayload:message.filePayload,autoSubmit:message.autoSubmit===true});if(!result.needsPermission)void runSignupFill(result.tabId).catch(()=>{});return result;})().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(message?.type==='scout-signup-schedule'){(async()=>{const backend=(await settings()).backendUrl;if(new URL(sender.url||sender.tab?.url).origin!==new URL(backend).origin||!/^[A-Za-z0-9_-]{40,100}$/.test(message.token||''))throw Error('Invalid signup connection.');const origin=new URL(message.formUrl).origin;if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw Error('Enable autofill on the form site first, then turn on background signup again.');const jobs=await storage.get('signupJobs')||[];await storage.set('signupJobs',[...jobs.filter(j=>j.signupId!==message.signupId),{signupId:message.signupId,token:message.token,backend}].slice(-20));await chrome.alarms.create('signup-jobs',{periodInMinutes:1});void backgroundSignups();return {ok:true};})().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;}
  if(!['scout-alerts-status','scout-alerts-connect','scout-alerts-test'].includes(message?.type))return false;
  (async()=>{const s=await settings();return handleAlertConnection(message,sender,{browser:chrome,storage,api,backend:s.backendUrl});})().then(result=>{respond(result);if(message.type==='scout-alerts-connect')void surfaceAlerts();}).catch(error=>respond({ok:false,error:error.message}));return true;
});

chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='complete')void runSignupFill(tabId).catch(()=>{});});

chrome.tabs.onRemoved.addListener(async tabId=>{const pending=await storage.get('signupResume');if(pending?.tabId===tabId){await storage.set('signupResume',null);await chrome.storage.session.remove('signupFiles');}});

async function signupRequest(job,body){
 const response=await fetch(job.backend+'/api/signup-browser/poll',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+job.token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'Signup connection failed.'),{status:response.status});return data;
}
async function runSignupFill(tabId,options={}){
 const pending=await storage.get('signupResume');if(!pending||pending.tabId!==tabId)return {ok:false};
 if(pending.job){try{const check=await signupRequest(pending.job,{runId:pending.job.runId,check:true});if(!check.allowed){await storage.set('signupResume',null);await chrome.storage.session.remove('signupFiles');return {ok:false,error:'This signup is no longer approved.'};}}catch(error){if([401,403,404,409].includes(error.status)){await storage.set('signupResume',null);await chrome.storage.session.remove('signupFiles');}return {ok:false,error:error.message};}}
 try{
  const result=await fillPendingSignup({browser:chrome,storage,tabId,...options});if(result.waiting)await chrome.alarms.create('signup-wakeup',{when:Date.now()+2000});
  if(pending.autoSubmit&&(result.execution?.paused||result.error)){const latest=await storage.get('signupResume');if(latest?.tabId===tabId){latest.autoSubmit=false;await storage.set('signupResume',latest);}}
  if(pending.job&&(result.execution?.attempted||result.execution?.paused||result.error))await signupRequest(pending.job,{runId:pending.job.runId,result:result.execution?.attempted?'attempted':'paused',message:result.error||result.execution?.message});
  return result;
 }catch(error){if(pending.job)await signupRequest(pending.job,{runId:pending.job.runId,result:'paused',message:'Execution outcome needs review: '+error.message}).catch(()=>{});throw error;}
}
let signupPolling=false;
async function backgroundSignups(){
 if(signupPolling)return;signupPolling=true;
 try{const pending=await storage.get('signupResume');if(pending?.autoSubmit&&!pending.submissionRequested&&pending.expires>Date.now())await runSignupFill(pending.tabId).catch(()=>{});
 await pollSignupJobs({browser:chrome,storage,request:signupRequest,start:startSignupSession,afterStart:async tabId=>{const tab=await chrome.tabs.get(tabId);if(tab.status==='complete')await runSignupFill(tabId);await chrome.alarms.create('signup-wakeup',{when:Date.now()+2000});}});}finally{signupPolling=false;}
}
