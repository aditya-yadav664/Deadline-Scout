import {api,storage} from './api.js';
if(location.pathname==='/auth/done'){
  const code=new URLSearchParams(location.hash.slice(1)).get('code'),verifier=sessionStorage.getItem('dd:oauth-verifier');
  history.replaceState(null,'','/auth/done');
  document.querySelector('#dashboard-gate').hidden=true;
  const status=document.querySelector('#auth-return-status');
  status.hidden=false;

  try{if(!code||!verifier)throw new Error('This sign-in link has expired. Return to the app and sign in again.');const result=await api('/api/auth/redeem','POST',{code,verifier});await storage.set('token',result.token);sessionStorage.removeItem('dd:oauth-verifier');const handoff=sessionStorage.getItem('dd:dashboard-handoff')||'';sessionStorage.removeItem('dd:dashboard-handoff');location.replace('/dashboard'+(handoff.startsWith('#')?handoff:''));}catch(error){
    document.querySelector('#auth-return-text').textContent=error.message;
    status.querySelector('a').hidden=false;
  }
}
