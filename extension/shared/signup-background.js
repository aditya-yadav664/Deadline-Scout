import {approvedSessionFiles} from './signup-files.js';
export async function startSignupSession({browser,storage,draft,filePayload=[],autoSubmit=false,job}){
 const current=await storage.get('signupResume');
 if(current?.autoSubmit&&!current.submissionRequested&&current.expires>Date.now())throw Error('Another background signup is running. Finish or close its form first.');
 const url=new URL(draft.formUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!draft.reviewedAll)throw Error('Review the draft and its form address first.');
 const allowed=await browser.permissions.contains({origins:[url.origin+'/*']});
 if(autoSubmit&&!allowed)throw Error('Enable autofill on this form site in the extension before background submission.');
 const files=approvedSessionFiles(draft,filePayload),fileSession=crypto.randomUUID(),expires=Date.now()+30*60000;
 await browser.storage.session.set({signupFiles:{id:fileSession,files,expires}});
 const tab=await browser.tabs.create({url:url.href,active:!autoSubmit});
 await storage.set('signupResume',{draft,fileSession,startedAt:Date.now(),tabId:tab.id,expires,filled:[],visited:[],autoSubmit,attempted:[],job});
 return {ok:true,needsPermission:!allowed,tabId:tab.id};
}
export async function pollSignupJobs({browser,storage,request,start,afterStart}){
 const pending=await storage.get('signupResume');if(pending?.autoSubmit&&!pending.submissionRequested&&pending.expires>Date.now())return;
 const jobs=await storage.get('signupJobs')||[];
 let nextAt=Infinity;for(const job of jobs){
  let result;try{result=await request(job,{});}catch(error){if(![401,403,404,409].includes(error.status))continue;result={stop:true};}
  if(result.stop){await storage.set('signupJobs',(await storage.get('signupJobs')||[]).filter(j=>j.token!==job.token));continue;}
  if(!result.draft){if(result.waiting)nextAt=Math.min(nextAt,result.backupAt);continue;}
  try{const started=await start({browser,storage,draft:result.draft,filePayload:result.filePayload,autoSubmit:true,job:{...job,runId:result.runId}});if(afterStart)await afterStart(started.tabId);}
  catch(error){await request(job,{runId:result.runId,result:'paused',message:error.message}).catch(()=>{});}
  return;
 }
 if(Number.isFinite(nextAt))await browser.alarms?.create('signup-wakeup',{when:Math.max(Date.now()+1000,nextAt)});
}
