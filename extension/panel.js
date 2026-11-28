import {api,isExtension,settings,storage} from './api.js';
if(isExtension){
  const config=await settings();
  location.replace(config.backendUrl+'/dashboard'+location.hash);
}else if(location.pathname!=='/auth/done'){
  const shell=document.querySelector('.shell'),gate=document.querySelector('#dashboard-gate');
  try{
    const token=await storage.get('token');
    // The workspace request validates the session and supplies the initial view.
    // Start it alongside the public config request when a session is present.
    const pending=token?api('/api/workspace?compact=1').then(workspace=>({workspace}),error=>({error})):null;
    const config=await api('/api/config');
    let workspace;
    if(pending){
      const result=await pending;
      if(result.error&&(config.auth!=='local'||result.error.status!==401))throw result.error;
      workspace=result.workspace;
    }else if(config.auth!=='local')throw Object.assign(new Error('Sign in to continue.'),{status:401});
    const {startDashboard}=await import('./dashboard.js?v=registration-scan-2');
    gate.hidden=true;
    shell.hidden=false;
    await startDashboard({config,workspace});
  }catch(error){
    if(error.status===401){
      await storage.set('token',null);
      if(location.hash)sessionStorage.setItem('dd:dashboard-handoff',location.hash);
      location.replace('/');
    }else{
      shell.hidden=true;
      gate.hidden=false;
      gate.querySelector('.scout-loading').hidden=true;
      const message=gate.querySelector('.access-error');
      message.textContent=error.message;
      message.hidden=false;
      gate.querySelector('a').hidden=false;
    }
  }
}
