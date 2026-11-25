import {fillPendingSignup} from './shared/signup-resume.js';
import {handleAlertConnection} from './shared/alert-connection.js';
import {deliverBrowserAlerts} from './shared/browser-alerts.js';
import {api,storage,settings,connectGoogle} from './api.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(console.error);
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('surface-alerts',{periodInMinutes:1}));
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('surface-alerts',{periodInMinutes:1});surfaceAlerts();});
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
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='surface-alerts')surfaceAlerts();});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(['signup-fill-now','signup-form-changed'].includes(message.type)){(async()=>{const pending=await storage.get('signupResume');if(message.type==='signup-fill-now'&&_sender.url?.startsWith(chrome.runtime.getURL(''))){pending.tabId=message.tabId;await storage.set('signupResume',pending);}else if(!pending||pending.tabId!==_sender.tab?.id)throw Error('No active signup session.');return fillPendingSignup({browser:chrome,storage,tabId:message.tabId||_sender.tab.id,force:message.type==='signup-fill-now'});})().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;}
  if(message.type==='surface-alerts'){surfaceAlerts().then(()=>respond({ok:true}));return true;}
  if(message.type==='connect-google'){connectGoogle().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
});
let notificationClickRegistered=false;
function registerNotificationClick(){if(notificationClickRegistered||!chrome.notifications?.onClicked)return;chrome.notifications.onClicked.addListener(async id=>{const backend=(await settings()).backendUrl,notice=await storage.get('signupNotice:'+id);await chrome.tabs.create({url:notice&&new URL(notice).origin===new URL(backend).origin?notice:backend+'/#timeline'});});notificationClickRegistered=true;}
registerNotificationClick();chrome.permissions.onAdded.addListener(permissions=>{if(permissions.permissions?.includes('notifications'))registerNotificationClick();});

chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  if(message?.type==='scout-signup-resume'){
    (async()=>{const backend=(await settings()).backendUrl;if(new URL(sender.url||sender.tab?.url).origin!==new URL(backend).origin)throw Error('Untrusted resume page.');const d=message.draft;if(!d?.reviewedAll||!Array.isArray(d.steps)||d.steps.length>12)throw Error('Review the draft first.');const url=new URL(d.formUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid form URL.');const tab=await chrome.tabs.create({url:url.href});await storage.set('signupResume',{draft:d,tabId:tab.id,expires:Date.now()+30*60000,filled:[]});const allowed=await chrome.permissions.contains({origins:[url.origin+'/*']});if(allowed)void fillPendingSignup({browser:chrome,storage,tabId:tab.id}).catch(()=>{});return {ok:true,needsPermission:!allowed};})().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;
  }
  if(!['scout-alerts-status','scout-alerts-connect','scout-alerts-test'].includes(message?.type))return false;
  (async()=>{const s=await settings();return handleAlertConnection(message,sender,{browser:chrome,storage,api,backend:s.backendUrl});})().then(result=>{respond(result);if(message.type==='scout-alerts-connect')void surfaceAlerts();}).catch(error=>respond({ok:false,error:error.message}));return true;
});

chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='complete')void fillPendingSignup({browser:chrome,storage,tabId}).catch(()=>{});});
