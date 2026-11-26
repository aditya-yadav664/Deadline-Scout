import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {captureSignupForm,restoreSignupAnswers} from '../extension/shared/signup.js';
import {advanceSignup,resumePlan} from '../extension/shared/signup-resume.js';
import {isGoogleForms,googleFormsSignup} from '../extension/shared/google-forms.js';
import {collectSignupPage} from '../extension/shared/signup-collection.js';
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
test('capture preserves answers and checkbox limits across native and Google Forms controls', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.setContent(`<form><label>Name<input name="name" value="Fictional tester"></label>
 <input name="code" autocomplete="one-time-code" value="123456">
 <fieldset><legend>Choose up to 2 topics</legend>
 <label><input type="checkbox" name="topic" value="Code" checked>Code</label>
 <label><input type="checkbox" name="topic" value="Design" checked>Design</label>
 <label><input type="checkbox" name="topic" value="Other">Other</label></fieldset></form>`);
 const native=await page.evaluate('('+captureSignupForm.toString()+')(0,false,true)');
 const checkbox=native.fields.find(f=>f.type==='checkbox');
 assert.equal(checkbox.maxChoices,2);
 assert.deepEqual(native.capturedAnswers,{'name:name':'Fictional tester',[checkbox.key]:'["Code","Design"]'});
 assert.equal((await page.evaluate(captureSignupForm)).capturedAnswers,undefined);
 const googleUrl='https://docs.google.com/forms/d/e/limits-example/viewform';
 await page.route(googleUrl,route=>route.fulfill({contentType:'text/html',body:`
 <form action="formResponse">
 <div role="listitem"><div data-params='%.@.[8,"Resume",null,13,[[50,null,true]]]]'><div role="heading">Resume *</div><button type="button">Add file</button></div></div>
 <div role="listitem"><div data-params='%.@.[9,"Topics",null,4,[[51,null,true,null,[[7,201,["2"]]]]]]]'><div role="heading">Topics *</div><div role="checkbox" aria-label="Code" aria-checked="true"></div><div role="checkbox" aria-label="Design" aria-checked="false"></div></div></div>
 </form>`}));
 await page.goto(googleUrl);
 const google=await page.evaluate(googleFormsSignup,{captureAnswers:true});
 assert.equal(google.fields[0].type,'file');assert.equal(google.fields[0].manualUpload,true);
 assert.equal(google.fields[1].maxChoices,2);
 assert.deepEqual(google.capturedAnswers,{'google-forms:9':'["Code"]'});
});
test('Google Forms answers on a Submit section are capturable and fillable', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 const form='https://docs.google.com/forms/d/e/test-form/';
 const question=(id,label,body)=>`<div role="listitem"><div data-params="%.@.[${id},0]"><div role="heading">${label}</div>${body}</div></div>`;
 const option=(role,value,attribute)=>`<div role="${role}" aria-label="${value}" ${attribute}="false" onclick="setTimeout(()=>this.setAttribute('${attribute}','true'),60)">${value}</div>`;
 await page.route(form+'**',route=>{
  const final=route.request().url().endsWith('formResponse');
  const content=final?question(2,'Project summary *','<textarea aria-label="Your answer"></textarea>')+
   question(3,'Format *',`<div role="radiogroup" aria-required="true">${option('radio','Remote','aria-checked')}</div>`)+
   question(4,'Topics *',option('checkbox','Design','aria-checked')+option('checkbox','Code','aria-checked'))+
   '<div role="button" onclick="window.submitCount++">Submit</div>':
   question(1,'Participant name *','<input type="text" aria-label="Your answer">')+
   '<div role="button" onclick="location.href=\'formResponse\'">Next</div>';
  return route.fulfill({contentType:'text/html',body:`<form action="formResponse">${content}</form><script>window.submitCount=0;</script>`});
 });
 await page.goto(form+'viewform');
 assert.equal(isGoogleForms(page.url()),true);
 const first=await page.evaluate(googleFormsSignup);
 assert.deepEqual(first.fields.map(f=>f.label),['Participant name']);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:false,googleForms:true})).advanced,true);
 await page.waitForURL(form+'formResponse');
 const final=await page.evaluate(googleFormsSignup);
 assert.equal(final.url,first.url);
 assert.equal(collectSignupPage(collectSignupPage(null,first),final).steps.length,2);
 assert.deepEqual(final.fields.map(f=>[f.label,f.type,f.required]),[
  ['Project summary','textarea',true],['Format','radio',true],['Topics','checkbox',true],
 ]);
 const answers={'google-forms:2':'Sample project','google-forms:3':'Remote','google-forms:4':'["Code","Design"]'};
 const plan=resumePlan({steps:[first,{...final,answers}]},final);
 assert.equal(plan.index,1);
 assert.deepEqual(await page.evaluate(googleFormsSignup,plan),['Project summary: restored.','Format: restored.','Topics: restored.']);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true,googleForms:true,allowSubmit:false})).paused,true);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true,googleForms:true})).attempted,true);
 assert.equal(await page.evaluate(()=>window.submitCount),1);
});
test('real browser: same-URL wizard fills each panel, advances past hidden requirements and pauses for files', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(`<form id="wizard"><section id="step-1-panel"><label>Name<input id="name" required></label><button type="button" onclick="one.hidden=true;two.hidden=false">Continue to Project Details</button></section><section id="step-2-panel" hidden><label>Project<input id="project" required></label><label>Proposal<input id="pdf" type="file" required></label><button type="button" onclick="two.hidden=true;three.hidden=false">Continue to Review</button></section><section id="step-3-panel" hidden><p>Review the registration</p><button type="submit">Submit registration</button></section></form><script>var one=document.getElementById('step-1-panel'),two=document.getElementById('step-2-panel'),three=document.getElementById('step-3-panel');window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++}</script>`);
 const first=await page.evaluate(captureSignupForm);assert.equal(first.fields.length,1);assert.equal(first.stepToken,'step-1-panel');
 await page.evaluate(restoreSignupAnswers,{step:first,answers:{'id:name':'Fictional tester'}});
 assert.equal((await page.evaluate(advanceSignup,{finalStep:false})).advanced,true);
 const second=await page.evaluate(captureSignupForm);assert.equal(second.fields.length,2);assert.equal(second.stepToken,'step-2-panel');
 const draft={steps:[{...first,answers:{}},{...second,answers:{}}]};assert.equal(resumePlan(draft,second).index,1);
 await page.evaluate(restoreSignupAnswers,{step:second,answers:{'id:project':'Test project'}});
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).paused,true); // files must remain manual
 await page.locator('#pdf').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});
 assert.equal((await page.evaluate(advanceSignup,{finalStep:false})).advanced,true);
 const third=await page.evaluate(captureSignupForm);assert.equal(third.fields.length,0);assert.equal(third.stepToken,'step-3-panel');draft.steps.push({...third,answers:{}});
 assert.equal(resumePlan(draft,third).index,2);assert.ok(resumePlan(draft,{...third,stepToken:'unreviewed-panel'}).error);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).attempted,true);assert.equal(await page.evaluate(()=>window.submits),1);
});

import {attachSignupPdfs,approvedSessionFiles} from '../extension/shared/signup-files.js';
import {createHash} from 'node:crypto';
test('real browser: approved PDF attachment reaches FormData and fires the site change handler', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://signup.test/**',route=>route.fulfill({contentType:'text/html',body:'<form><label>Proposal<input id="pdf" name="proposal" type="file" accept=".pdf" required hidden></label></form><script>window.changes=0;document.querySelector("input").onchange=()=>window.changes++</script>'}));
 await page.goto('https://signup.test/form');
 const bytes=Buffer.from('%PDF-1.4\nFictional attachment test'),file={stepIndex:0,key:'id:pdf',id:'file1',name:'test.pdf',type:'application/pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
 const step={...await page.evaluate(captureSignupForm),files:{'id:pdf':[{...file,data:undefined}]}};
 const payload=approvedSessionFiles({steps:[step]},[file]);assert.equal((await page.evaluate(attachSignupPdfs,{step,attachments:payload})).blocked,false);
 assert.equal(await page.evaluate(()=>new FormData(document.forms[0]).get('proposal').name),'test.pdf');
 assert.equal(await page.locator('#pdf').evaluate(el=>el.files[0].name),'test.pdf');assert.equal(await page.evaluate(()=>window.changes),1);
 // User-chosen files are preserved, not silently replaced.
 await page.locator('#pdf').setInputFiles({name:'my-choice.pdf',mimeType:'application/pdf',buffer:bytes});
 assert.match((await page.evaluate(attachSignupPdfs,{step,attachments:payload})).report[0],/kept/);
 await page.locator('#pdf').setInputFiles([]);
 assert.equal((await page.evaluate(attachSignupPdfs,{step,attachments:[{...file,data:Buffer.from('%PDF-tampered').toString('base64')}]})).blocked,true);
 assert.equal(await page.locator('#pdf').evaluate(el=>el.files.length),0);
 assert.throws(()=>approvedSessionFiles({steps:[step]},[{...file,id:'unapproved'}]),/reviewed/);
});

test('a Google Forms upload tries only the approved question and pauses for a custom picker or rejected file', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 const url='https://docs.google.com/forms/d/e/controlled-pdf/viewform';
 await page.route(url,route=>route.fulfill({contentType:'text/html',body:`<form action="formResponse">
  <div data-params="%.@.[7,"><button type="button">Add file</button></div>
  <div data-params="%.@.[8,"><input type="file" aria-label="Different question"></div>
 </form>`}));
 await page.goto(url);
 const key='google-forms:7';
 const bytes=Buffer.from('%PDF-1.4\nFictional upload test');
 const pdf={id:'fixture',key,name:'approved.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
 const step={fields:[{key,type:'file',label:'Resume',required:true,manualUpload:true}],files:{[key]:[pdf]}};
 const args={step,attachments:[pdf],autoSubmit:true};
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,true);
 assert.equal(await page.getByLabel('Different question').evaluate(input=>input.files.length),0);
 await page.locator('button').evaluate(button=>button.insertAdjacentHTML('afterend','<input type="file" hidden>'));
 const target=page.locator('input[hidden]');
 await target.evaluate(input=>input.addEventListener('change',()=>setTimeout(()=>{input.value='';},40),{once:true}));
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,true);
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,false);
 assert.equal(await target.evaluate(input=>input.files[0].name),'approved.pdf');
});

import {fillPendingSignup} from '../extension/shared/signup-resume.js';
import {startSignupSession} from '../extension/shared/signup-background.js';
test('inactive browser job fills two captured panels, attaches PDF and submits an uncaptured empty review exactly once', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();let submissions=0;
 await page.route('https://background.test/**',route=>{
  if(route.request().method()==='POST'){submissions++;assert.match(route.request().postData()||'',/test.pdf/);return route.fulfill({contentType:'application/json',body:'{"receipt":"TEST-123"}'});}
  return route.fulfill({contentType:'text/html',body:`<form><section id="step-1-panel"><label>Name<input id="name" name="name" required></label><button type="button" onclick="one.hidden=true;two.hidden=false">Continue to project</button></section><section id="step-2-panel" hidden><label>Project<input id="project" name="project" required></label><label>PDF<input id="pdf" name="proposal" type="file" accept=".pdf" required></label><button type="button" onclick="two.hidden=true;three.hidden=false">Review Submission</button></section><section id="step-3-panel" hidden><p>Review your answers</p><button type="submit">Submit registration</button></section></form><script>var one=document.getElementById('step-1-panel'),two=document.getElementById('step-2-panel'),three=document.getElementById('step-3-panel');window.chrome.runtime={sendMessage:async()=>({})};document.forms[0].onsubmit=async e=>{e.preventDefault();window.receipt=(await (await fetch('/submit',{method:'POST',body:new FormData(e.target)})).json()).receipt;};</script>`});
 });
 await page.goto('https://background.test/form');
 const first=await page.evaluate(captureSignupForm);await page.evaluate(()=>{one.hidden=true;two.hidden=false;});const second=await page.evaluate(captureSignupForm);await page.evaluate(()=>{one.hidden=false;two.hidden=true;});
 const bytes=Buffer.from('%PDF-1.4\nFictional job test'),file={id:'file1',stepIndex:1,key:'id:pdf',name:'test.pdf',type:'application/pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
 const draft={formUrl:first.url,reviewedAll:true,steps:[{...first,answers:{'id:name':'Fictional Person'}},{...second,answers:{'id:project':'Fictional project'},files:{'id:pdf':[{...file,data:undefined}]}}]},state={},session={};
 const storage={get:async k=>state[k],set:async(k,v)=>state[k]=structuredClone(v)};let tabOptions;
 const adapter={permissions:{contains:async()=>true},storage:{session:{set:async o=>Object.assign(session,o),get:async()=>session}},tabs:{get:async()=>({url:page.url()}),create:async args=>{tabOptions=args;return {id:5};}},scripting:{executeScript:async o=>[{result:await page.evaluate(({source,args})=>(new Function('return ('+source+')'))()(...args),{source:o.func.toString(),args:o.args||[]})}]}};
 await startSignupSession({browser:adapter,storage,draft,filePayload:[file],autoSubmit:true});assert.equal(tabOptions.active,false);
 await page.exposeFunction('notifyScout',()=>fillPendingSignup({browser:adapter,storage,tabId:5}));
 await page.evaluate(()=>{window.chrome.runtime.sendMessage=()=>window.notifyScout();setInterval(()=>document.body.classList.toggle('animation-tick'),75);});
 await fillPendingSignup({browser:adapter,storage,tabId:5});
 await page.waitForFunction(()=>window.receipt==='TEST-123');await fillPendingSignup({browser:adapter,storage,tabId:5});assert.equal(submissions,1);assert.equal(draft.steps.length,2);
});

import {inspectSignupReceipt} from '../extension/shared/signup-receipt.js';
test('receipt observer requires organizer confirmation and an identifier, not a Submit click', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://receipt.test/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Registration confirmed</h1><p>Receipt ID: TEST-123</p>'}));await page.goto('https://receipt.test/confirmation?id=TEST-123');assert.equal((await page.evaluate(inspectSignupReceipt)).receiptId,'TEST-123');
 await page.setContent('<h1>Review registration</h1><p>Receipt ID: TEST-123</p><button type="submit">Submit</button>');assert.equal(await page.evaluate(inspectSignupReceipt),null);
 await page.setContent('<h1>Registration failed</h1><p>Try again</p>');assert.equal(await page.evaluate(inspectSignupReceipt),null);
});

import {finalReviewPlan} from '../extension/shared/signup-resume.js';
test('uncaptured button-only review and JavaScript Submit controls submit after all saved fields are visited', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<form><label>Name<input id="name" required></label></form>');const step=await page.evaluate(captureSignupForm);const pending={autoSubmit:true,visited:[0],draft:{steps:[{...step,answers:{"id:name":"Fictional tester"}}]}};
 await page.setContent('<h1>Review registration</h1><form><button type="submit">Submit Registration →</button></form><script>window.submits=0;document.forms[0].onsubmit=e=>{e.preventDefault();window.submits++}</script>');
 const live=await page.evaluate(captureSignupForm);assert.equal(live.fields.length,0);assert.equal(finalReviewPlan(pending,live,live).review,true);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true,allowSubmit:false})).paused,true);assert.equal(await page.evaluate(()=>window.submits),0);
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).attempted,true);assert.equal(await page.evaluate(()=>window.submits),1);
 await page.setContent('<h1>Review registration</h1><button type="button" onclick="window.submits++">Submit registration</button><script>window.submits=0</script>');
 assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).attempted,true);assert.equal(await page.evaluate(()=>window.submits),1);
 await page.setContent('<form><label>Unanswered<input required></label><button type="button">Submit registration</button></form>');assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).paused,true);
 await page.setContent('<button type="button">Submit</button><button type="button">Submit registration</button>');assert.equal((await page.evaluate(advanceSignup,{finalStep:true})).paused,true);
});
