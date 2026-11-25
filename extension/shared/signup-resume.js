import {captureSignupForm,restoreSignupAnswers,formSignature} from './signup.js';
import {attachSignupPdfs} from './signup-files.js';
export function finalReviewPlan(pending,live,all){
 if(!pending.autoSubmit||live.fields.length||!pending.draft.steps.every((s,i)=>!s.fields.length||pending.visited?.includes(i)))return null;
 if(all.warnings?.some(w=>/Unfamiliar control|Ambiguous control|Multiple forms/.test(w)))return null;
 const known=pending.draft.steps.flatMap(s=>s.fields),constraints=f=>JSON.stringify([f.key,f.type,!!f.required,f.options||[],f.accept||'',!!f.multiple,f.maxLength||null,f.pattern||'',f.min||'',f.max||'']);
 if(!known.length||known.filter(f=>f.required).some(f=>!all.fields.some(n=>n.key===f.key)))return null;
 if(all.fields.some(f=>!known.some(k=>constraints(f)===constraints(k))))return null;
 if(live.terms&&!pending.draft.steps.some(s=>s.terms===live.terms))return null;
 return {index:pending.draft.steps.length,review:true,step:{...live,fields:[]},answers:{},signature:formSignature(live),warnings:[]};
}
export function resumePlan(draft,live,preferredIndex){
 const normalize=url=>{const u=new URL(url);for(const key of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(key))u.searchParams.delete(key);return u.href;};
 const same=draft.steps.map((step,index)=>({step,index})).filter(x=>preferredIndex!==undefined?x.index===preferredIndex&&new URL(x.step.url).origin===new URL(live.url).origin&&new URL(x.step.url).pathname===new URL(live.url).pathname:normalize(x.step.url)===normalize(live.url));
 const ranked=same.filter(x=>!x.step.stepToken||!live.stepToken||x.step.stepToken===live.stepToken).map(x=>({...x,matches:x.step.fields.filter(f=>live.fields.some(n=>n.key===f.key&&formSignature({...live,fields:[n]})===formSignature({...live,fields:[f]})))})).sort((a,b)=>b.matches.length-a.matches.length);
 const reviewOnly=ranked.length===1&&!live.fields.length&&!ranked[0].step.fields.length&&live.stepToken&&ranked[0].step.stepToken===live.stepToken;
 if(!ranked.length||(!ranked[0].matches.length&&!reviewOnly)||ranked[1]?.matches.length===ranked[0].matches.length)return {error:'This page has new or unmatched answer fields. Review those answers; an empty final review page does not need a saved draft.'};
 const {step,index,matches}=ranked[0];if(step.terms!==live.terms)return {error:'Terms changed. Capture this step again for review.'};
 const added=live.fields.filter(f=>f.required&&!step.fields.some(s=>s.key===f.key));
 return {index,step:{...step,fields:matches},answers:step.answers,signature:formSignature(live),warnings:[...(live.warnings||[]).filter(w=>/Unfamiliar control|Ambiguous control|Multiple forms/.test(w)),...added.map(f=>'New required field: '+f.label),...step.fields.filter(f=>!matches.includes(f)).map(f=>f.label+': changed; review manually.')]};
}
export function watchSignupStep(){
 if(window.__scoutSignupWatch)return;window.__scoutSignupWatch=true;let timer;
 const notify=()=>{clearTimeout(timer);timer=setTimeout(()=>chrome.runtime.sendMessage({type:'signup-form-changed'}).catch(()=>{}),500);};
 new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('#deadline-scout-fill-status')||r.target.id==='deadline-scout-fill-status'||r.type==='childList'&&[...r.addedNodes,...r.removedNodes].length&&[...r.addedNodes,...r.removedNodes].every(n=>n.id==='deadline-scout-fill-status')))return;notify();}).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true,attributeFilter:['class','style','hidden','aria-hidden','aria-selected','required','disabled']});
 document.addEventListener('change',notify,true);
 window.addEventListener('hashchange',()=>chrome.runtime.sendMessage({type:'signup-form-changed'}).catch(()=>{}));
}
export function showSignupProgress({message,nextUrl}){
 let panel=document.getElementById('deadline-scout-fill-status');if(!panel){panel=document.createElement('aside');panel.id='deadline-scout-fill-status';panel.setAttribute('role','status');panel.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#102b37;color:white;padding:16px;border:1px solid #00dce9;border-radius:12px;max-width:340px;font:14px/1.5 system-ui;box-shadow:0 8px 30px #0007';document.body.append(panel);}
 panel.replaceChildren(document.createTextNode(message));if(nextUrl){const a=document.createElement('a');a.href=nextUrl;a.textContent='Open next captured page →';a.style.cssText='display:block;color:#66edff;margin-top:10px';panel.append(a);}const close=document.createElement('button');close.textContent='Dismiss';close.style.cssText='display:block;margin-top:10px';close.onclick=()=>panel.remove();panel.append(close);
}
export function advanceSignup({finalStep,formIndex=0}){
 const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const forms=[...document.forms].filter(f=>visible(f)&&f.querySelector('input,textarea,select')).sort((a,b)=>b.querySelectorAll('input,textarea,select').length-a.querySelectorAll('input,textarea,select').length),form=forms[formIndex];
 if(!form)return {paused:true,message:'No unique form is available. Finish this page manually.'};
 const buttons=[...form.querySelectorAll('button,input[type=submit]')].filter(b=>visible(b)&&!b.disabled);
 const next=buttons.filter(b=>b.type==='button'&&(/^(?:next|continue)(?:\s+(?:(?:to\s+)?(?:[\w &-]+)))?\s*[→›]?$/i.test((b.innerText||b.value||'').trim())&&!/pay|checkout|submit|register|purchase/i.test(b.innerText||b.value||'')||/^review(?:\s+(?:submission|answers|details|application))?$/i.test((b.innerText||b.value||'').trim())));
 if(next.length)finalStep=false;
 if([...form.querySelectorAll('input[type=password],input[autocomplete=one-time-code],iframe[src*=captcha],input[name*=captcha],textarea[name*=captcha]')].some(visible)||[...document.querySelectorAll('iframe[src*=recaptcha],iframe[src*=hcaptcha],.g-recaptcha,.h-captcha')].some(visible))return {paused:true,message:'Sign-in, OTP or CAPTCHA requires your action.'};
 if(/\b(?:checkout|pay now|payment required|registration fee|card number|credit card)\b/i.test(form.innerText))return {paused:true,message:'Payment or a fee needs your review.'};
 if([...form.querySelectorAll('input[type=file]')].some(f=>(finalStep||visible(f))&&f.required&&!f.files?.length))return {paused:true,message:'Attach the required files before submission.'};
 if([...form.querySelectorAll('input[type=checkbox]')].some(c=>(finalStep||visible(c))&&!c.checked&&(c.required||/agree|consent|terms/i.test(c.labels?.[0]?.innerText||''))))return {paused:true,message:'Review and complete consent yourself.'};
 if(finalStep?!form.checkValidity():[...form.querySelectorAll('input,textarea,select')].filter(visible).some(el=>el.willValidate&&!el.checkValidity()))return {paused:true,message:'The site reports incomplete or invalid answers. Review the highlighted fields.'};
 if(!finalStep||next.length){if(next.length!==1)return {paused:true,message:'Use the site’s Next button. Deadline Scout will fill the next matching step.'};next[0].click();return {advanced:true,message:'Moved to the next form step.'};}
 const submit=buttons.filter(b=>b.type==='submit'&&/^(?:register|register now|submit|submit registration|submit application|sign up|complete registration)$/i.test((b.innerText||b.value||'').trim()));
 if(submit.length!==1)return {paused:true,message:'No unique registration Submit button was found. Submit manually.'};
 form.requestSubmit(submit[0]);return {attempted:true,message:'Submission requested once. Verify the organizer’s confirmation; Deadline Scout has not confirmed registration.'};
}
const filling=new Set();
export async function fillPendingSignup({browser,storage,tabId,force=false,preferredIndex}){
 if(filling.has(tabId))return {ok:true};filling.add(tabId);
 try{const pending=await storage.get('signupResume');if(!pending||pending.expires<Date.now()||pending.tabId!==tabId)return {ok:false,error:'Start Fill form now from your saved draft.'};
 if(pending.submissionRequested)return {ok:true,execution:{attempted:true,message:'Submission was requested once. Verify the organizer receipt.'}};if(pending.dispatching)return {ok:false,error:'Previous action outcome is unknown. Review the organizer before retrying.'};
 const tab=await browser.tabs.get(tabId),origin=new URL(pending.draft.formUrl).origin;if(new URL(tab.url).origin!==origin)return {ok:false,error:'Navigate to the saved form site.'};
 if(!await browser.permissions.contains({origins:[origin+'/*']}))return {ok:false,needsPermission:true,error:'Open the extension and choose Enable autofill on this site.'};
 await browser.scripting.executeScript({target:{tabId},func:watchSignupStep});
 const captureIndex=pending.draft.steps[preferredIndex]?.formIndex||pending.draft.steps.find(s=>s.url===tab.url)?.formIndex||0;
 const [captured]=await browser.scripting.executeScript({target:{tabId},func:captureSignupForm,args:[captureIndex]});let plan=resumePlan(pending.draft,captured.result,preferredIndex);
 if(plan.error&&pending.autoSubmit&&!captured.result.fields.length){const [all]=await browser.scripting.executeScript({target:{tabId},func:captureSignupForm,args:[captureIndex,true]});plan=finalReviewPlan(pending,captured.result,all.result)||plan;}
 if(plan.error){await browser.scripting.executeScript({target:{tabId},func:showSignupProgress,args:[{message:plan.error}]});return {ok:false,error:plan.error};}
 pending.filled||=[];const key=plan.index+':'+(captured.result.stepToken||'')+':'+plan.signature;
 const alreadyFilled=pending.filled.includes(key);
 if(!force&&alreadyFilled&&!pending.autoSubmit)return {ok:true};
 const [result]=force||!alreadyFilled?await browser.scripting.executeScript({target:{tabId},func:restoreSignupAnswers,args:[{step:plan.step,answers:plan.answers}]}):[{result:[]}];
 let attachmentResult={report:[],blocked:false};
 if(pending.fileSession&&(!alreadyFilled||force)){
  const cache=(await browser.storage.session.get('signupFiles')).signupFiles;
  const attachments=cache?.id===pending.fileSession&&cache.expires>Date.now()?cache.files.filter(f=>f.stepIndex===plan.index):[];
  if(attachments.length){const [attached]=await browser.scripting.executeScript({target:{tabId},func:attachSignupPdfs,args:[{step:plan.step,attachments}]});attachmentResult=attached.result;}
 }
 result.result.push(...attachmentResult.report);
 pending.filled=[...new Set([...pending.filled,key])];await storage.set('signupResume',pending);
 if(!plan.warnings.length&&!attachmentResult.blocked&&!result.result.some(line=>/ambiguous or missing/.test(line))){pending.visited=[...new Set([...(pending.visited||[]),plan.index])];await storage.set('signupResume',pending);}
 let execution;
 if(pending.autoSubmit&&!plan.warnings.length&&!attachmentResult.blocked&&!result.result.some(line=>/ambiguous or missing/.test(line))){pending.attempted||=[];if(!pending.attempted.includes(key)&&!pending.submissionRequested){pending.attempted.push(key);pending.dispatching=true;await storage.set('signupResume',pending);const [attempt]=await browser.scripting.executeScript({target:{tabId},func:advanceSignup,args:[{finalStep:plan.review||plan.index===pending.draft.steps.length-1,formIndex:plan.step.formIndex||0}]});execution=attempt.result;pending.dispatching=false;if(execution?.paused){pending.attempted=pending.attempted.filter(k=>k!==key);}if(execution?.attempted)pending.submissionRequested=true;await storage.set('signupResume',pending);}}
 await browser.scripting.executeScript({target:{tabId},func:watchSignupStep});
 const nextUrl=pending.draft.steps[plan.index+1]?.url;
 await browser.scripting.executeScript({target:{tabId},func:showSignupProgress,args:[{message:'Deadline Scout · '+(plan.review?'Final review':('step '+(plan.index+1)+' of '+pending.draft.steps.length))+'. '+[...result.result,...plan.warnings].join(' ')+' '+(execution?.message||'Finish consent, attachments and submission yourself.'),nextUrl:nextUrl!==tab.url?nextUrl:undefined}]});return {ok:true,execution,report:[...result.result,...plan.warnings,...(execution?.message?[execution.message]:[])]};
 }finally{filling.delete(tabId);}
}
