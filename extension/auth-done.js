import {api,storage} from './api.js';
if(location.pathname==='/auth/done'){
  const code=new URLSearchParams(location.hash.slice(1)).get('code'),verifier=sessionStorage.getItem('dd:oauth-verifier');
  history.replaceState(null,'','/auth/done');
  const status=document.querySelector('#dashboard-gate');

  try{if(!code||!verifier)throw new Error('This sign-in link has expired. Return to the app and sign in again.');const result=await api('/api/auth/redeem','POST',{code,verifier});await storage.set('token',result.token);sessionStorage.removeItem('dd:oauth-verifier');const handoff=sessionStorage.getItem('dd:dashboard-handoff')||'';sessionStorage.removeItem('dd:dashboard-handoff');const backup=sessionStorage.getItem('dd:backup-handoff')||'';sessionStorage.removeItem('dd:backup-handoff');location.replace(/^\/backup\.html(?:#|$)/.test(backup)?backup:'/dashboard'+(handoff.startsWith('#')?handoff:''));}catch(error){
    status.querySelector('.scout-loading').hidden=true;
    const message=status.querySelector('.access-error');
    message.textContent=error.message;
    message.hidden=false;
    status.querySelector('a').hidden=false;
  }
}
