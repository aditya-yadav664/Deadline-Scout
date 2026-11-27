const byId = (kind, id) => ({kind,id});
const byTrack = (kind, trackId) => ({kind,trackId});
const profile = byId('profile','me');
const signupMetadata = {kind:'signup',projection:'metadata'};
const signupSummary = {kind:'signup',filter:'active',projection:'signupSummary'};
const latestSources = {kind:'sourceHistory',projection:'sourceLatest'};
const applicationSummary = {kind:'applicationWorkspace',projection:'applicationSummary'};
const intelligenceSummary = {kind:'intelligence',projection:'intelligenceSummary'};
export const accountActivity = ['track','change','delivery','googleLink','signup','signupFile','signupProfile','dashboard','sourceHistory','intelligence','applicationWorkspace','applicationPassport','assistantHistory','scoutMemory'];

export async function loadAccountRoute(store,owner,path,method,auth,params) {
  if(!store.load)return;
  const load=(...scopes)=>store.load(owner,...scopes);
  if(path==='/api/workspace')return load(profile,'track',...(params.get('compact')==='1'?[]:['change']),signupSummary,'googleLink',latestSources,intelligenceSummary,applicationSummary,'dashboard');
  if(path==='/api/productivity')return load('track','change',signupMetadata,latestSources,intelligenceSummary,applicationSummary);
  if(path==='/api/assistant/answer')return load('assistantHistoryRevision','track','change',signupMetadata,'sourceHistory',intelligenceSummary,applicationSummary);
  if(path==='/api/assistant/history')return load('assistantHistory','assistantHistoryRevision');
  if(path==='/api/assistant/memory')return load('scoutMemory');
  if(path==='/api/application-passport')return load('applicationPassport');
  if(path==='/api/intelligence')return load('track',signupMetadata,latestSources,intelligenceSummary,applicationSummary);
  if(path==='/api/account/clear-data'){
    await load(...accountActivity.map(kind=>({kind,projection:'idOnly'})));
    return store.load('_system',{kind:'demoSignup',accountOwner:owner,projection:'metadata'});
  }
  if(path==='/api/me'||path==='/api/profile/google-name'||path==='/api/settings'||path==='/api/google/disconnect'||path==='/api/email/test')return load(profile);
  if(path.startsWith('/api/email/'))return load(profile,'verification');
  if(path==='/api/dashboard')return load({kind:'track',projection:'idOnly'},'dashboard');
  if(path==='/api/dashboard/seen')return load('dashboard');
  if(path==='/api/changes'&&!params.has('limit'))return load({kind:'track',projection:'idOnly'},'change');
  if(path==='/api/alerts')return store.loadBrowserAlerts(owner);
  if(path==='/api/signup-profile')return load('signupProfile');
  if(path==='/api/signup-files')return load({kind:'signupFile',projection:'fileQuota'});
  if(path==='/api/signup-browser/poll'&&auth.scope==='browser-signup'){return load(byId('signup',auth.signupId));}
  if(path==='/api/signups'||path==='/api/signup-confirmations'){
    if(method==='GET'){
      if(path==='/api/signup-confirmations')return load({...signupSummary,filter:'confirmed'});
      return load(params.get('summary')==='1'?signupSummary:{kind:'signup',filter:'active'});
    }
    return load({kind:'track',projection:'idOnly'});
  }
  if(path==='/api/signups/run')return load(profile,'track',{kind:'signup',filter:'armed'});
  const signup=path.match(/^\/api\/signups\/([\w-]+)(?:\/(\w[\w-]*))?/);
  if(signup){
    const [,id,action]=signup;
    if(action==='run')return;
    const records=await load(byId('signup',id));
    const trackId=records[0]?.body.trackId;
    const scopes=[];
    if(trackId&&(action==='arm'||action==='submit-now'))scopes.push(byId('track',trackId));
    if(action==='submit-now')scopes.push(profile,'track',{kind:'signup',filter:'armed'});
    if(method!=='GET'&&action!=='browser-session')scopes.push({...bySignupDelivery(id),filter:'pending'});
    return load(...scopes);
  }
  if(path==='/api/tracks')return method==='GET'&&params.get('summary')==='signup'?load({kind:'track',projection:'signupTrack'}):load('track',signupSummary,'googleLink');
  const track=path.match(/^\/api\/tracks\/([^/]+)(?:\/([^/]+))?$/);
  if(track){
    const [,id,action]=track;
    const scopes=[byId('track',id),byTrack('googleLink',id)];
    if(method==='DELETE'){
      await load(...scopes,byTrack('signup',id),byTrack('change',id));
      return load({kind:'delivery',filter:'trackDelivery',trackId:id,changeIds:store.list(owner,'change').map(change=>change.id)});
    }
    if(action==='check'||action==='monitor'||action==='resolve')scopes.push(profile,byId('sourceHistory',id),byId('intelligence',id));
    if(action==='google'||action==='preview')scopes.push(profile);
    if(!action&&method==='PATCH')scopes.push(byId('sourceHistory',id),byId('intelligence',id));
    scopes.push({...byTrack('signup',id),filter:'active',projection:'signupSummary'});
    return load(...scopes);
  }
  const opportunity=path.match(/^\/api\/opportunities\/([\w-]+)/);
  if(opportunity){
    const id=opportunity[1];
    const scopes=[byId('track',id),byId('intelligence',id)];
    if(method==='GET')scopes.push(byId('sourceHistory',id),byId('applicationWorkspace',id),byTrack('change',id),
      {...byTrack('signup',id),projection:'metadata'},byTrack('googleLink',id));
    if(path.endsWith('/application'))scopes.push(byId('applicationWorkspace',id));
    return load(...scopes);
  }
}
const bySignupDelivery = signupId => ({kind:'delivery',signupId});
