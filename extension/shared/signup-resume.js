import {captureSignupForm,restoreSignupAnswers,formSignature} from './signup.js';
export function resumePlan(draft,live){
 const same=draft.steps.map((step,index)=>({step,index})).filter(x=>x.step.url===live.url);
 const ranked=same.map(x=>({...x,matches:x.step.fields.filter(f=>live.fields.some(n=>n.key===f.key&&formSignature({...live,fields:[n]})===formSignature({...live,fields:[f]})))})).sort((a,b)=>b.matches.length-a.matches.length);
 if(!ranked.length||!ranked[0].matches.length||ranked[1]?.matches.length===ranked[0].matches.length)return {error:'No unique saved step matches this page. Choose the step in the extension or capture it again.'};
 const {step,index,matches}=ranked[0];if(step.terms!==live.terms)return {error:'Terms changed. Capture this step again for review.'};
 const added=live.fields.filter(f=>f.required&&!step.fields.some(s=>s.key===f.key));
 return {index,step:{...step,fields:matches},answers:step.answers,signature:formSignature(live),warnings:[...added.map(f=>'New required field: '+f.label),...step.fields.filter(f=>!matches.includes(f)).map(f=>f.label+': changed; review manually.')]};
}
export function watchSignupStep(){
 if(window.__scoutSignupWatch)return;window.__scoutSignupWatch=true;let timer;
 new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>chrome.runtime.sendMessage({type:'signup-form-changed'}).catch(()=>{}),500);}).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true,attributeFilter:['class','style','hidden','aria-hidden','required','disabled']});
 window.addEventListener('hashchange',()=>chrome.runtime.sendMessage({type:'signup-form-changed'}).catch(()=>{}));
}
export function showSignupProgress({message,nextUrl}){
 let panel=document.getElementById('deadline-scout-fill-status');if(!panel){panel=document.createElement('aside');panel.id='deadline-scout-fill-status';panel.setAttribute('role','status');panel.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#102b37;color:white;padding:16px;border:1px solid #00dce9;border-radius:12px;max-width:340px;font:14px/1.5 system-ui;box-shadow:0 8px 30px #0007';document.body.append(panel);}
 panel.replaceChildren(document.createTextNode(message));if(nextUrl){const a=document.createElement('a');a.href=nextUrl;a.textContent='Open next captured page →';a.style.cssText='display:block;color:#66edff;margin-top:10px';panel.append(a);}const close=document.createElement('button');close.textContent='Dismiss';close.style.cssText='display:block;margin-top:10px';close.onclick=()=>panel.remove();panel.append(close);
}
const filling=new Set();
export async function fillPendingSignup({browser,storage,tabId,force=false}){
 if(filling.has(tabId))return {ok:true};filling.add(tabId);
 try{const pending=await storage.get('signupResume');if(!pending||pending.expires<Date.now()||pending.tabId!==tabId)return {ok:false,error:'Start Fill form now from your saved draft.'};
 const tab=await browser.tabs.get(tabId),origin=new URL(pending.draft.formUrl).origin;if(new URL(tab.url).origin!==origin)return {ok:false,error:'Navigate to the saved form site.'};
 if(!await browser.permissions.contains({origins:[origin+'/*']}))return {ok:false,needsPermission:true,error:'Open the extension and choose Enable autofill on this site.'};
 await browser.scripting.executeScript({target:{tabId},func:watchSignupStep});
 const [captured]=await browser.scripting.executeScript({target:{tabId},func:captureSignupForm});const plan=resumePlan(pending.draft,captured.result);
 if(plan.error)return {ok:false,error:plan.error};
 pending.filled||=[];const key=plan.index+':'+plan.signature;if(!force&&pending.filled.includes(key))return {ok:true};
 const [result]=await browser.scripting.executeScript({target:{tabId},func:restoreSignupAnswers,args:[{step:plan.step,answers:plan.answers}]});
 pending.filled=[...new Set([...pending.filled,key])];await storage.set('signupResume',pending);
 await browser.scripting.executeScript({target:{tabId},func:watchSignupStep});
 await browser.scripting.executeScript({target:{tabId},func:showSignupProgress,args:[{message:'Deadline Scout · step '+(plan.index+1)+' of '+pending.draft.steps.length+'. '+[...result.result,...plan.warnings].join(' ')+' Finish consent, attachments and submission yourself.',nextUrl:pending.draft.steps[plan.index+1]?.url}]});return {ok:true,report:result.result};
 }finally{filling.delete(tabId);}
}
