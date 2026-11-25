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
