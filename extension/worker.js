import {api,storage,settings,connectGoogle} from './api.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(console.error);
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('surface-alerts',{periodInMinutes:1}));
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('surface-alerts',{periodInMinutes:1});surfaceAlerts();});
let busy=false;
async function surfaceAlerts(){
  if(busy)return;busy=true;
  try{
    if(!await storage.get('token')||!await chrome.permissions.contains({permissions:['notifications']}))return;
    const alerts=await api('/api/alerts');
    for(const alert of alerts){
      const c=alert.change;if(!c)continue;
      // Deterministic browser ID replaces an existing notification after a
      // service-worker restart instead of creating a second notification.
      await chrome.notifications.create(alert.id,{type:'basic',iconUrl:'icon128.png',title:`${c.title}: ${c.label}`,message:`${c.before.date} → ${c.after.date}\n${c.impact}`,priority:2});
      await api('/api/alerts/ack','POST',{id:alert.id});
    }
  }catch{/* The durable backend queue is read on the next wakeup. */}finally{busy=false;}
}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='surface-alerts')surfaceAlerts();});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message.type==='surface-alerts'){surfaceAlerts().then(()=>respond({ok:true}));return true;}
  if(message.type==='connect-google'){connectGoogle().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:e.message}));return true;}
});
chrome.notifications?.onClicked?.addListener(async()=>chrome.tabs.create({url:(await settings()).backendUrl+'/#timeline'}));
