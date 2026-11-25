const proof=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function beginAlertConnection(browser,storage,backend){
  if(!await browser.permissions.request({permissions:['notifications']}))throw new Error('Allow notifications for Deadline Scout to enable background alerts.');
  if(await browser.notifications.getPermissionLevel()==='denied')throw new Error('Enable Deadline Scout notifications in Edge before connecting background alerts.');
  if(typeof backend==='function')backend=await backend();
  const verifier=encode(crypto.getRandomValues(new Uint8Array(32))),state=encode(crypto.getRandomValues(new Uint8Array(32))),challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  await storage.set('alertConnection',{state,verifier,challenge,origin:new URL(backend).origin,expires:Date.now()+600000});
  return backend+'/#'+new URLSearchParams({'alerts-setup':browser.runtime.id,state,challenge});
}
export async function handleAlertConnection(message,sender,{browser,storage,api,backend}){
  let origin;try{origin=new URL(sender.url||sender.tab?.url).origin;}catch{throw new Error('Invalid setup page.');}
  if(origin!==new URL(backend).origin)throw new Error('Only your Deadline Scout website can connect background alerts.');
  const allowed=await browser.permissions.contains({permissions:['notifications']})&&await browser.notifications.getPermissionLevel()==='granted';
  if(message.type==='scout-alerts-status'&&!message.state){
    if(!allowed||!await storage.get('token'))return {ok:true,connected:false};
    try{const profile=await api('/api/me');return {ok:true,connected:true,email:profile.email};}catch(error){if(error.status===401)return {ok:true,connected:false};throw error;}
  }
  if(message.type==='scout-alerts-test'){
    if(!allowed||!await storage.get('token'))throw new Error('Connect background alerts first.');
    await api('/api/me');await browser.notifications.create('scout-test',{type:'basic',iconUrl:'icon128.png',title:'Deadline Scout is connected',message:'Background alerts are linked to your dashboard account.',priority:2});return {ok:true};
  }
  const pending=await storage.get('alertConnection');
  if(!pending||pending.expires<Date.now()||pending.origin!==origin||!proof(message.state)||pending.state!==message.state||pending.challenge!==message.challenge)throw new Error('This alert setup expired. Open the extension and choose Set up background alerts again.');
  if(!allowed)throw new Error('Allow extension notifications, then try setup again.');
  if(message.type==='scout-alerts-status')return {ok:true,ready:true};
  if(message.type!=='scout-alerts-connect'||!proof(message.code))throw new Error('Invalid alert setup request.');
  const result=await api('/api/auth/redeem','POST',{code:message.code,verifier:pending.verifier,extensionId:browser.runtime.id});
  await storage.set('token',result.token);await storage.set('alertConnection',null);await browser.alarms.create('surface-alerts',{periodInMinutes:1});
  return {ok:true,connected:true,email:result.email};
}
