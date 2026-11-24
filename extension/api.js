import {backendOrigin,LOCAL_BACKEND,HOSTED_BACKEND} from './shared/backend-url.js';
export const isExtension=typeof chrome!=='undefined'&&!!chrome.runtime?.id;
export const storage={
  async get(key){if(isExtension)return (await chrome.storage.local.get(key))[key];try{return JSON.parse(localStorage.getItem('dd:'+key)||'null');}catch{return null;}},
  async set(key,value){if(isExtension)return chrome.storage.local.set({[key]:value});localStorage.setItem('dd:'+key,JSON.stringify(value));}
};
export async function settings(){if(!isExtension)return {backendUrl:location.origin};let saved=await storage.get('settings');if(!await storage.get('hostedBackendMigrationV1')){if(!saved?.backendUrl||backendOrigin(saved.backendUrl)===LOCAL_BACKEND){saved={...saved,backendUrl:HOSTED_BACKEND};await storage.set('settings',saved);await storage.set('token',null);}await storage.set('hostedBackendMigrationV1',true);}return {...saved,backendUrl:backendOrigin(saved?.backendUrl,HOSTED_BACKEND)};}
export async function api(path,method='GET',body) {
  const s=await settings(),token=await storage.get('token');
  let r;try{r=await fetch(s.backendUrl+path,{method,signal:AbortSignal.timeout(65000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch{throw new Error('Backend unreachable. Start the Node server or check your backend URL.');}
  const data=await r.json();if(!r.ok){const e=new Error(data.error||'Request failed.');e.status=r.status;throw e;}return data;
}
export async function connectGoogle() {
  const s=await settings(),bytes=crypto.getRandomValues(new Uint8Array(32));
  const b64=buffer=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const verifier=b64(bytes),challenge=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const redirect=isExtension?chrome.identity.getRedirectURL():s.backendUrl+'/auth/done';
  const prepared=await api('/api/auth/prepare','POST',{redirect,challenge});
  if(isExtension) {
    const result=await chrome.identity.launchWebAuthFlow({url:prepared.url,interactive:true});
    if(!result)throw new Error('Google sign-in was cancelled.');
    const code=new URLSearchParams(new URL(result).hash.slice(1)).get('code');
    const session=await api('/api/auth/redeem','POST',{code,verifier});await storage.set('token',session.token);
  }else{sessionStorage.setItem('dd:oauth-verifier',verifier);location.assign(prepared.url);}
}
