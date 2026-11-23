import {api,storage} from './api.js';
if(location.pathname==='/auth/done'){
  const code=new URLSearchParams(location.hash.slice(1)).get('code'),verifier=sessionStorage.getItem('dd:oauth-verifier');
  history.replaceState(null,'','/auth/done');
  document.querySelector('#connection-label').textContent='Completing Google sign-in…';
  try{if(!code||!verifier)throw new Error('This sign-in link has expired. Return to the app and sign in again.');const result=await api('/api/auth/redeem','POST',{code,verifier});await storage.set('token',result.token);sessionStorage.removeItem('dd:oauth-verifier');location.replace('/');}catch(e){document.querySelector('#connection-label').textContent='Sign-in did not complete';document.querySelector('#tracking-status').hidden=false;document.querySelector('#tracking-status-text').textContent=e.message;document.querySelector('#tracking-signin').hidden=false;document.querySelector('#tracking-signin').textContent='Return to app and try again';document.querySelector('#tracking-signin').onclick=()=>location.replace('/');}
}
