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
      const c=alert.change;await chrome.notifications.create(alert.id,{type:'basic',iconUrl:'icon128.png',title:`${c.title}: ${c.label}`,message:`${c.before.date} → ${c.after.date}\n${c.impact}`,priority:2});
    },ack:id=>api('/api/alerts/ack','POST',{id})});
  }catch{/* The durable backend queue is read on the next wakeup. */}finally{busy=false;}
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='surface-alerts')surfaceAlerts();});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message.type==='surface-alerts'){surfaceAlerts().then(()=>respond({ok:true}));return true;}
  if(message.type==='connect-google'){connectGoogle().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
});
let notificationClickRegistered=false;
function registerNotificationClick(){if(notificationClickRegistered||!chrome.notifications?.onClicked)return;chrome.notifications.onClicked.addListener(async()=>chrome.tabs.create({url:(await settings()).backendUrl+'/#timeline'}));notificationClickRegistered=true;}
registerNotificationClick();chrome.permissions.onAdded.addListener(permissions=>{if(permissions.permissions?.includes('notifications'))registerNotificationClick();});

chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  if(!['scout-alerts-status','scout-alerts-connect','scout-alerts-test'].includes(message?.type))return false;
  (async()=>{const s=await settings();return handleAlertConnection(message,sender,{browser:chrome,storage,api,backend:s.backendUrl});})().then(result=>{respond(result);if(message.type==='scout-alerts-connect')void surfaceAlerts();}).catch(error=>respond({ok:false,error:error.message}));return true;
});
