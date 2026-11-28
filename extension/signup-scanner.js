import {api} from './api.js';
import {isGoogleForms, sameSignupForm, googleFormsSignup} from './shared/google-forms.js';
import {captureSignupForm, validateAnswer} from './shared/signup.js';
import {collectSignupPage, scanStepKey} from './shared/signup-collection.js';
import {signupScanUrl, findSignupEntry, formScanNavigation} from './shared/signup-scan.js';

const $=id=>document.getElementById(id);
const start=$('scan-start'), open=$('scan-open'), review=$('scan-review');
const choice=$('scan-choice'), select=$('scan-form'), status=$('scan-status');
const registrationChoice=$('scan-registration-choice'), registration=$('scan-registration');
let entry, tabId, collection, pendingEntry, busy=false, finished=false, discovering=true;
let pausedStep, watchTimer;
const followedEntries=new Set();

try{
  entry=signupScanUrl(new URLSearchParams(location.hash.slice(1)).get('url'));
  $('destination').textContent=entry.hostname;
}catch(error){
  status.textContent=error.message;
  start.disabled=true;
}

function show(message){
  const count=collection?.steps.length||0;
  status.textContent=(count ? count+' '+(count===1?'page':'pages')+' captured. ' : '')+message;
  review.hidden=!count;
  review.textContent=finished?'Review captured pages':'Review partial draft';
  $('scan-pages').replaceChildren(...(collection?.steps||[]).map(step=>{
    const item=document.createElement('li');
    item.textContent=step.fields.slice(0,3).map(field=>field.label).join(' · ')+
      (step.fields.length>3?' (+'+(step.fields.length-3)+' more)':'');
    return item;
  }));
}

async function inForm(func,args){
  const [script]=await chrome.scripting.executeScript({target:{tabId},func,args});
  return script.result;
}

function allowedPage(url){
  if(collection)return sameSignupForm(collection.steps[0].url,url);
  const page=new URL(url);
  if(isGoogleForms(entry.href))return sameSignupForm(entry.href,url);
  if(entry.origin==='https://forms.gle')return isGoogleForms(url);
  return page.origin===entry.origin;
}

function permissionOrigins(url){
  const origins=[url.protocol+'//'+url.hostname+'/*'];
  if(url.origin==='https://forms.gle')origins.push('https://docs.google.com/*');
  return origins;
}

async function inspectEntry(url){
  const candidates=(await inForm(findSignupEntry,[{url}])).filter(candidate=>!followedEntries.has(url+'\n'+candidate.key));
  if(!candidates.length)return false;
  pendingEntry={url,candidates};
  registration.replaceChildren(...candidates.map(candidate=>new Option(candidate.url?
    candidate.label+' · '+new URL(candidate.url).hostname:candidate.label,candidate.key)));
  registrationChoice.hidden=candidates.length===1;
  const automatic=candidates.length===1&&candidates[0].url&&new URL(candidates[0].url).origin===new URL(url).origin;
  if(automatic){
    await openRegistration(candidates[0]);
    return true;
  }
  start.textContent='Open registration';
  show(candidates.length>1?'Choose which registration option to open.':
    'Found '+candidates[0].label+'. Open it to scan the registration form.');
  return true;
}

async function openRegistration(candidate){
  const source=pendingEntry.url;
  if(candidate.url){
    const destination=signupScanUrl(candidate.url);
    entry=destination;
    $('destination').textContent=entry.hostname;
    await chrome.tabs.update(tabId,{url:entry.href});
  }else{
    const clicked=await inForm(findSignupEntry,[{url:source,clickKey:candidate.key}]);
    if(!clicked.some(option=>option.key===candidate.key&&!option.url))throw Error('The registration button changed. Open registration in the event tab, then continue the scan.');
  }
  followedEntries.add(source+'\n'+candidate.key);
  pendingEntry=null;
  registrationChoice.hidden=true;
  start.textContent='Continue scan';
}

async function readStep(previousKey,attempts=16){
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt)await new Promise(resolve=>setTimeout(resolve,400));
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='loading')continue;
    if(!tab.url||!allowedPage(tab.url))throw Error('The form opened another site or a sign-in page. Finish there, then return to the form and continue the scan.');
    const googleForms=isGoogleForms(tab.url);
    let step;
    try{
      step=googleForms?await inForm(googleFormsSignup,[{captureAnswers:true}]):await inForm(captureSignupForm,[Number(select.value)||0,false,true]);
    }catch(error){
      if((await chrome.tabs.get(tabId)).status==='loading')continue;
      throw error;
    }
    if(!allowedPage(step.url))continue;
    if(scanStepKey(step)!==previousKey){
      const liveUrl=tab.url;
      if(step.fields.length)return {step,googleForms,liveUrl};
      const nav=await inForm(formScanNavigation,[{url:liveUrl,formIndex:step.formIndex,googleForms}]);
      if(['review','sign-in','captcha'].includes(nav)||collection&&nav==='next')return {step,googleForms,liveUrl,action:nav};
      if(discovering&&!googleForms&&(await inForm(findSignupEntry,[{url:liveUrl}])).some(candidate=>!followedEntries.has(liveUrl+'\n'+candidate.key)))return {step,googleForms,liveUrl};
      if(attempt===attempts-1&&!previousKey)return {step,googleForms,liveUrl};
    }
  }
  return null;
}

async function scan(previousKey){
  for(let page=0;page<12;page++){
    const result=await readStep(previousKey);
    if(!result)return show('The form stayed on this page. Check it for required answers, uploads, or validation messages, then continue the scan.');
    const {step,googleForms,liveUrl}=result;
    pausedStep=scanStepKey(step);
    const navigation={url:liveUrl,formIndex:step.formIndex,googleForms};
    const action=await inForm(formScanNavigation,[navigation]);
    if(action==='changed')return show('The page changed while scanning. Check the form tab and continue.');
    if(action==='sign-in')return show('Sign in on the form tab, then return here to continue scanning.');
    if(discovering&&!googleForms&&action!=='captcha'){
      if(followedEntries.size>=5&&!step.fields.length)return show('Open the registration form in the event tab, then continue the scan.');
      if(followedEntries.size<5&&await inspectEntry(liveUrl)){
        if(pendingEntry)return;
        show('Looking for the registration form…');
        continue;
      }
    }
    if(step.formChoices?.length>1&&choice.hidden){
      select.replaceChildren(...step.formChoices.map(form=>new Option(form.label,form.index)));
      choice.hidden=false;
      return show('Choose which form to scan, then continue.');
    }
    if(step.fields.length)collection=collectSignupPage(collection,step);
    if(collection)discovering=false;
    if(action==='captcha')return show('Complete the verification on the form tab, then return here to continue scanning.');
    if(action==='review'){
      finished=true;
      return show(collection?'Ready to review your draft.':'No answer fields found. Open the form tab and check the link.');
    }
    if(!step.fields.length&&(!collection||action!=='next'))return show(step.warnings?.[0]||'No registration form found yet. Open registration in the event tab and continue the scan.');
    if(collection?.steps.length>=12)return show('You can review up to 12 pages in one draft.');
    if(action==='blocked'||googleForms&&step.fields.some(field=>field.required&&field.type!=='file'&&
      validateAnswer(field,step.capturedAnswers?.[field.key]))){
      return show('The form needs answers or an attachment. Complete the required fields, then click Continue scan here. The scanner will try the next step from the same tab.');
    }
    if(action!=='next'){
      const labels=await inForm(formScanNavigation,[{...navigation,describe:true}]);
      const details=Array.isArray(labels)&&labels.length?' Controls found: '+labels.join(' · ')+'.':'';
      return show('The scanner couldn’t identify a clear next step. Use the form’s navigation in the same tab to continue capturing.'+details);
    }
    previousKey=scanStepKey(step);
    show('Looking for the next page…');
    if(await inForm(formScanNavigation,[{...navigation,advance:true}])!=='next'){
      return show('The page changed while scanning. Check the form tab and continue.');
    }
  }
}

function unlock(){
  busy=false;
  start.disabled=finished;
  open.disabled=review.disabled=false;
  if(!finished&&!pendingEntry&&collection&&pausedStep){
    clearTimeout(watchTimer);
    watchTimer=setTimeout(watchForm,1600);
  }
}

async function watchForm(){
  if(busy||finished)return;
  try{
    const next=await readStep(null,1);
    if(busy||finished)return;
    const key=next&&scanStepKey(next.step);
    if(next&&key===pausedStep&&collection.steps.some(step=>scanStepKey(step)===key)){
      collection=collectSignupPage(collection,next.step);
    }else if(next&&(next.step.fields.length||['review','next'].includes(next.action))){
      busy=true;
      start.disabled=review.disabled=true;
      try{await scan(pausedStep);}catch(error){show(error.message);}
      finally{unlock();}
      return;
    }
  }catch{
    // Wait for the same tab to return from a sign-in or site transition.
  }
  if(!busy&&!finished)watchTimer=setTimeout(watchForm,1600);
}

start.addEventListener('click',async()=>{
  if(busy||!entry)return;
  busy=true;
  clearTimeout(watchTimer);
  start.disabled=open.disabled=review.disabled=true;
  try{
    if(tabId===undefined){
      if(!await chrome.permissions.request({origins:permissionOrigins(entry)}))return show('Allow access to the event site to start scanning.');
      tabId=(await chrome.tabs.create({url:entry.href,active:false})).id;
      open.hidden=false;
      start.textContent='Continue scan';
    }else if(pendingEntry){
      const candidate=pendingEntry.candidates.find(option=>option.key===registration.value);
      if(!candidate)return show('Choose which registration option to open.');
      if(candidate.url&&new URL(candidate.url).origin!==new URL(pendingEntry.url).origin&&
        !await chrome.permissions.request({origins:permissionOrigins(new URL(candidate.url))}))return show('Allow access to the registration site to scan its form.');
      await openRegistration(candidate);
    }
    show('Reading the form…');
    await scan();
  }catch(error){show(error.message);}
  finally{unlock();}
});

open.addEventListener('click',async()=>{
  try{await chrome.tabs.update(tabId,{active:true});}
  catch{show('The form tab was closed. You can still review any captured pages.');}
});

review.addEventListener('click',async()=>{
  if(busy||!collection)return;
  busy=true;
  clearTimeout(watchTimer);
  start.disabled=review.disabled=true;
  try{
    const capture=await api('/api/signup-captures','POST',{steps:collection.steps,extensionId:chrome.runtime.id});
    await chrome.tabs.update({url:capture.url});
  }catch(error){show(error.message);}
  finally{unlock();}
});
