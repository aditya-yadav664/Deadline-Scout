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
