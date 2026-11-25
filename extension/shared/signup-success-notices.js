import {api,storage} from '../api.js';
let running=false,lastToken,owner;
async function poll(){
 if(running)return;running=true;
 try{
  const token=await storage.get('token');if(!token)return;
  if(token!==lastToken){owner=(await api('/api/me')).email;lastToken=token;}
  const drafts=await api('/api/signups');
  for(const draft of drafts.filter(d=>d.status==='Confirmed'&&d.mode==='browser-auto'&&d.receipt)){
   const key='signup-confirmed:'+owner+':'+draft.id+':'+draft.receipt;if(await storage.get(key))continue;
   const box=document.createElement('aside');box.setAttribute('role','status');box.style.cssText='position:fixed;right:24px;bottom:24px;z-index:2147483647;max-width:360px;padding:20px;background:#10392e;color:#eafff6;border:1px solid #45d49f;border-radius:16px;box-shadow:0 8px 30px #0008;font:15px/1.5 system-ui';
   const link=document.createElement('a');link.href='/backup.html#draft='+encodeURIComponent(draft.id);link.style.color='inherit';link.textContent='Registration confirmed · '+draft.title+' · Receipt '+draft.receipt;
   const close=document.createElement('button');close.textContent='Dismiss';close.onclick=()=>box.remove();box.append(link,document.createElement('br'),close);document.body.append(box);await storage.set(key,true);setTimeout(()=>box.remove(),10000);break;
  }
 }catch{}finally{running=false;}
}
setTimeout(poll,2000);setInterval(poll,15000);
