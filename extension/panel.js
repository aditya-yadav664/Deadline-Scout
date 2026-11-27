import {api,isExtension,settings,storage} from './api.js';
if(isExtension){
  const config=await settings();
  location.replace(config.backendUrl+'/dashboard'+location.hash);
}else if(location.pathname!=='/auth/done'){
  const shell=document.querySelector('.shell'),gate=document.querySelector('#dashboard-gate');
  try{
    const config=await api('/api/config');
    if(config.auth!=='local')await api('/api/me');
    gate.hidden=true;
    shell.hidden=false;
    await import('./dashboard.js?v=workspace-3');
  }catch(error){
    if(error.status===401){
      await storage.set('token',null);
      if(location.hash)sessionStorage.setItem('dd:dashboard-handoff',location.hash);
      location.replace('/');
    }else{
      gate.querySelector('p').textContent=error.message;
      gate.querySelector('a').hidden=false;
    }
  }
}
