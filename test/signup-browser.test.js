import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {captureSignupForm,restoreSignupAnswers} from '../extension/shared/signup.js';
import {advanceSignup,resumePlan} from '../extension/shared/signup-resume.js';
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
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
 await page.route('https://signup.test/**',route=>route.fulfill({contentType:'text/html',body:'<form><label>Proposal<input id="pdf" name="proposal" type="file" accept=".pdf" required></label></form><script>window.changes=0;document.querySelector("input").onchange=()=>window.changes++</script>'}));
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
 await fillPendingSignup({browser:adapter,storage,tabId:5});await fillPendingSignup({browser:adapter,storage,tabId:5});const result=await fillPendingSignup({browser:adapter,storage,tabId:5});assert.equal(result.execution.attempted,true);
 await page.waitForFunction(()=>window.receipt==='TEST-123');await fillPendingSignup({browser:adapter,storage,tabId:5});assert.equal(submissions,1);assert.equal(draft.steps.length,2);
});

import {inspectSignupReceipt} from '../extension/shared/signup-receipt.js';
test('receipt observer requires organizer confirmation and an identifier, not a Submit click', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://receipt.test/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Registration confirmed</h1><p>Receipt ID: TEST-123</p>'}));await page.goto('https://receipt.test/confirmation?id=TEST-123');assert.equal((await page.evaluate(inspectSignupReceipt)).receiptId,'TEST-123');
 await page.setContent('<h1>Review registration</h1><p>Receipt ID: TEST-123</p><button type="submit">Submit</button>');assert.equal(await page.evaluate(inspectSignupReceipt),null);
 await page.setContent('<h1>Registration failed</h1><p>Try again</p>');assert.equal(await page.evaluate(inspectSignupReceipt),null);
});
