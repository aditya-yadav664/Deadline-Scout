import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {captureSignupForm,restoreSignupAnswers} from '../extension/shared/signup.js';
import {advanceSignup,resumePlan} from '../extension/shared/signup-resume.js';
import {isGoogleForms,googleFormsSignup} from '../extension/shared/google-forms.js';
import {collectSignupPage} from '../extension/shared/signup-collection.js';
import {formScanNavigation} from '../extension/shared/signup-scan.js';
import {Store} from '../server/store.js';
import {createApp} from '../server/app.js';
import {hash,vault} from '../server/security.js';
import {updatePassport} from '../server/applications.js';
const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));

test('the installed extension finds registration from an event page and scans without submitting', {skip:!executablePath,timeout:120000},async t=>{
 const reservation=createServer();
 await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port, host='http://127.0.0.1:'+port;
 await new Promise(resolve=>reservation.close(resolve));
 const app=createApp({env:{HOST:'127.0.0.1',APP_URL:host},store:new Store(':memory:'),vault:{seal:JSON.stringify,open:JSON.parse}});
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(port,'127.0.0.1',resolve));
 const extension=fileURLToPath(new URL('../extension',import.meta.url));
 const context=await chromium.launchPersistentContext('',{executablePath,headless:true,
  args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 t.after(async()=>{await context.close();app.close();});
 context.setDefaultTimeout(15000);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(backendUrl=>chrome.storage.local.set({settings:{backendUrl},hostedBackendMigrationV1:true}),host);
 let submissions=0;
 const [appHandler]=app.server.listeners('request');
 app.server.removeListener('request',appHandler);
 app.server.on('request',(request,response)=>{
  const url=new URL(request.url,host);
  if(url.pathname.startsWith('/event-')){
   const destinations={
    '/event-multi':'<a href="/apply-multi">Start registration</a>',
    '/event-custom':'<a href="/apply-custom">Apply now</a>',
    '/event-external':'<a href="http://localhost:'+port+'/apply-single">Start registration</a>',
    '/event-choice':'<a href="/apply-single">Register now</a><a href="/apply-multi">Apply for the workshop</a>',
    '/event-button':'<button type="button" onclick="document.querySelector(\'form\').hidden=false">Start registration</button>'+
      '<form hidden method="post" action="/apply-single"><label>Applicant name<input name="name" value="Test applicant"></label><button type="submit">Submit application</button></form>',
   };
   response.setHeader('Content-Type','text/html');
   return response.end('<!doctype html>'+destinations[url.pathname]+'<a href="/newsletter">Subscribe to our newsletter</a>');
  }
  if(!['/apply-single','/apply-multi','/apply-custom'].includes(url.pathname))return appHandler(request,response);
  if(request.method!=='GET'){
   submissions++;
   return response.end('Submitted');
  }
  if(url.pathname==='/apply-custom'){
   response.setHeader('Content-Type','text/html; charset=utf-8');
   return response.end(`<!doctype html><title>Custom application</title><form id="application" method="post">
    <h2>About you</h2><label><span>Applicant name</span><input name="answer" value="Test applicant"></label>
   </form><footer>
    <button type="button" aria-controls="application" onclick="document.querySelector('h2').textContent='About your project';document.querySelector('label span').textContent='Project title';document.querySelector('input').value='Test project';this.hidden=true;document.querySelector('#final').hidden=false;">Proceed to project information</button>
    <button id="final" type="submit" form="application" hidden>Submit application</button>
   </footer>`);
  }
  const step=url.searchParams.get('page');
  const multi=url.pathname==='/apply-multi';
  const contents=step==='review'?'<p>Review your application</p>':step==='intro'?'<p>Project section instructions</p>':
   step==='2'?'<label>Project title<input name="project" value="Test project" required></label>':
   '<label>Applicant name<input name="name" value="Test applicant" required></label>'+
   (multi?'<label>Institution<input name="institution" required></label>':'');
  const next=multi&&step!=='review';
  const navigation=next?(step==='2'?'<div role="button" onclick="location.search=\'page=review\'">Review application</div><button type="submit" onclick="return false">Submit application</button>':
   step==='intro'?'<a href="?page=2">Continue to project details</a>':
   '<a href="?page=intro">Continue to the next section →</a>'):
   '<button type="submit">Submit application</button>';
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end('<!doctype html><title>Test application</title><form method="post">'+contents+navigation+'</form>');
 });
 const site=context.pages()[0];
 for(const variant of ['single','multi','custom','choice','button','external']){
  await site.goto(host+'/backup.html');
  await site.getByText('Your Google account is connected.').waitFor();
  await site.getByLabel('Event page or application URL').fill(host+(variant==='single'?'/apply-single':'/event-'+variant));
  const [scanner]=await Promise.all([
   context.waitForEvent('page'),
   site.getByRole('button',{name:'Find and scan registration'}).click(),
  ]);
  await scanner.getByRole('button',{name:'Allow access and scan'}).click();
  if(variant==='choice'){
   await scanner.getByLabel('Registration option').selectOption(host+'/apply-single');
   await scanner.getByRole('button',{name:'Open registration'}).click();
  }
  if(['button','external'].includes(variant))await scanner.getByRole('button',{name:'Open registration'}).click();
  const multiple=['multi','custom'].includes(variant);
  if(variant==='multi'){
   await scanner.getByText(/1 page captured\. The form needs answers/).waitFor().catch(async error=>{
    throw Error(await scanner.locator('#scan-status').textContent(),{cause:error});
   });
   const form=context.pages().find(page=>page.url()===host+'/apply-multi');
   await form.getByLabel('Institution').fill('Example school');
   await form.getByRole('link',{name:/Continue to the next section/}).click();
  }
  await scanner.getByText(multiple?'2 pages captured. Ready to review your draft.':'1 page captured. Ready to review your draft.')
   .waitFor().catch(async error=>{
    throw Error(await scanner.locator('#scan-status').textContent(),{cause:error});
   });
  if(multiple)await scanner.getByRole('list',{name:'Captured form sections'}).getByText('Project title').waitFor();
  await scanner.getByRole('button',{name:'Review captured pages'}).click();
  await scanner.getByText(multiple?/^2 captured step\(s\)/:/^1 captured step\(s\)/).waitFor();
  await scanner.getByRole('button',{name:'Review answers'}).click();
  assert.equal(await scanner.getByLabel(/Applicant name/).inputValue(),'Test applicant');
  if(multiple)assert.equal(await scanner.getByLabel(/Project title/).inputValue(),'Test project');
 }
 assert.equal(submissions,0);
});

test('Backup Signup can save, retry a denied backup, and fill with a reviewed PDF', {skip:!executablePath},async t=>{
 const store=new Store(':memory:');
 const reservation=createServer();
 await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const host='http://127.0.0.1:'+port;
 const encryption=vault('.',Buffer.alloc(32,7).toString('base64'));
 const app=createApp({env:{HOST:'127.0.0.1',APP_URL:host},store,vault:encryption});
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(port,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const token='fixture-browser-token';
 store.put('_system','session',hash(token),{owner:'alice',expires:Date.now()+120000});
 store.put('alice','profile','me',{email:'fixture@example.test'});
 store.put('alice','track','track',{id:'track',title:'Controlled event',url:host,milestones:[{id:'deadline',date:'2099-09-12'}]});
 const file=app.signups.file('alice',{name:'fixture.pdf',data:Buffer.from('%PDF-1.4\nFictional PDF').toString('base64')});
 const extensionId='a'.repeat(32);
 const [passport]=updatePassport(store,encryption,'alice',{action:'save',category:'skills',label:'Primary skill',value:'JavaScript'});
 const draft=await app.signups.route('alice','/api/signups','POST',{
  trackId:'track',title:'Fixture',extensionId,reviewedAll:false,steps:[{
   url:'https://docs.google.com/forms/d/e/fixture/viewform',fields:[{key:'pdf',type:'file',label:'Resume',required:true,accept:'.pdf',manualUpload:true},{key:'skills',type:'text',label:'Skills'}],
   files:{pdf:[file]},
  }],
 });
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 page.setDefaultTimeout(10000);
 await page.addInitScript(({token,extensionId})=>{
  localStorage.setItem('dd:token',JSON.stringify(token));
  localStorage.setItem('dd:backgroundExtensionId',JSON.stringify(extensionId));
  window.allowSignup=false;
  window.chrome.runtime={sendMessage(_id,message,reply){
   window.lastSignupMessage=message;
   reply(message.type==='scout-signup-schedule'&&!window.allowSignup?{ok:false,error:'Grant site access first.'}:{ok:true});
  }};
 },{token,extensionId});
 await page.goto(host+'/backup.html#draft='+draft.id);
 await page.locator('#signup-editor:visible, #backup-feedback:not(:empty)').first().waitFor();
 assert.equal(await page.locator('#backup-feedback').textContent(),'');
 await page.locator('#flow-2').click();
 await page.getByLabel('Passport entry for Skills',{exact:true}).selectOption(passport.id);
 await page.getByRole('button',{name:'Save & continue'}).click();
 await page.locator('#stage-3').waitFor();
 const reviewed=app.signups.read('alice',draft.id);
 assert.equal(reviewed.steps[0].answers.skills,'JavaScript');
 assert.equal(reviewed.steps[0].sources.skills,'Application Passport');
 await page.locator('#signup-mode').selectOption('browser-auto');
 await page.locator('#arm-signup').click();
 await page.getByText('Grant site access first.',{exact:true}).waitFor();
 const cancelled=app.signups.read('alice',draft.id);
 assert.equal(cancelled.status,'Cancelled');
 assert.equal(cancelled.revision,reviewed.revision+1);
 const [download]=await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button',{name:'Download fixture.pdf for Resume'}).click(),
 ]);
 assert.equal(download.suggestedFilename(),'fixture.pdf');
 const chunks=[];
 for await(const chunk of await download.createReadStream())chunks.push(chunk);
 assert.equal(Buffer.concat(chunks).toString(),'%PDF-1.4\nFictional PDF');
 await page.locator('#resume-signup').click();
 await page.waitForFunction(()=>window.lastSignupMessage?.type==='scout-signup-resume');
 assert.equal(await page.evaluate(()=>window.lastSignupMessage.filePayload[0].name),'fixture.pdf');
 await page.evaluate(()=>{window.allowSignup=true;});
 await page.locator('#arm-signup').click();
 await page.getByText(/Background signup approved for/).waitFor();
 assert.equal(app.signups.read('alice',draft.id).revision,cancelled.revision+1);
});
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
  const url=new URL(route.request().url());
  const final=url.searchParams.has('review');
  const content=final?question(2,'Project summary *','<textarea aria-label="Your answer"></textarea>')+
   question(3,'Format *',`<div role="radiogroup" aria-required="true">${option('radio','Remote','aria-checked')}</div>`)+
   question(4,'Topics *',option('checkbox','Design','aria-checked')+option('checkbox','Code','aria-checked'))+
   '<div role="button" onclick="window.submitCount++">Submit</div>':
   (url.pathname.endsWith('formResponse')?
    question(5,'Institution *','<input type="text" value="Example school">')+
    '<div role="button" onclick="location.href=\'formResponse?review=1\'">Next</div>':
    question(1,'Participant name *','<input type="text" aria-label="Your answer">')+
    '<div role="button" onclick="location.href=\'formResponse\'">Next</div>');
  return route.fulfill({contentType:'text/html',body:`<form action="formResponse">${content}</form><script>window.submitCount=0;</script>`});
 });
 await page.goto(form+'viewform?usp=sharing');
 assert.equal(isGoogleForms(page.url()),true);
 const first=await page.evaluate(googleFormsSignup);
 assert.deepEqual(first.fields.map(f=>f.label),['Participant name']);
 assert.equal(await page.evaluate(formScanNavigation,{url:page.url(),googleForms:true,advance:true}),'next');
 await page.waitForURL(form+'formResponse');
 const second=await page.evaluate(googleFormsSignup);
 assert.equal(second.url,first.url);
 assert.equal(await page.evaluate(formScanNavigation,{url:page.url(),googleForms:true,advance:true}),'next');
 await page.waitForURL(form+'formResponse?review=1');
 const final=await page.evaluate(googleFormsSignup);
 assert.equal(final.url,first.url);
 assert.equal(collectSignupPage(collectSignupPage(collectSignupPage(null,first),second),final).steps.length,3);
 assert.equal(await page.evaluate(formScanNavigation,{url:page.url(),googleForms:true,advance:true}),'review');
 assert.equal(await page.evaluate(()=>window.submitCount),0);
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
 // The approved draft replaces a different file already on the form.
 await page.locator('#pdf').setInputFiles({name:'my-choice.pdf',mimeType:'application/pdf',buffer:bytes});
 assert.equal((await page.evaluate(attachSignupPdfs,{step,attachments:payload})).blocked,false);
 assert.equal(await page.locator('#pdf').evaluate(el=>el.files[0].name),'test.pdf');
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
test('a reviewed PDF is uploaded through the matching Google picker and confirmed on the form', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 const url='https://docs.google.com/forms/d/e/picker-pdf/viewform';
 await page.route('https://docs.google.com/picker',route=>route.fulfill({contentType:'text/html',body:`
  <button id="uploadButtonId">Browse</button><input type="file" accept="application/pdf" hidden>
  <script>document.querySelector('input').onchange=async e=>{
   const file=e.target.files[0];parent.postMessage({name:file.name,bytes:await file.text()},location.origin);
  };
  if(parent.uploads.length){
   document.querySelector('input').remove();const browse=document.querySelector('button');browse.ondragover=e=>e.preventDefault();
   browse.ondrop=async e=>{e.preventDefault();const file=e.dataTransfer.files[0];parent.postMessage({name:file.name,bytes:await file.text()},location.origin)};
  }</script>`}));
 await page.route(url,route=>route.fulfill({contentType:'text/html',body:`
  <form action="formResponse">
   <div role="listitem"><div data-params="%.@.[7,"><button type="button">Add file</button></div><ul aria-label="Selected files"></ul></div>
   <div role="listitem"><div data-params="%.@.[8,"><button type="button">Add file</button></div><ul aria-label="Selected files"></ul></div>
  </form>
  <script>window.uploads=[];
  for(const card of document.querySelectorAll('[role=listitem]'))card.querySelector('button').onclick=()=>{
   const frame=document.createElement('iframe');frame.src='/picker';document.body.append(frame);
   const receive=e=>{
    if(e.origin!==location.origin||e.source!==frame.contentWindow)return;
    window.uploads.push(e.data);const item=document.createElement('li'),name=document.createElement('span');
    name.textContent=e.data.name;item.append(name,name.cloneNode(true));card.querySelector('ul').append(item);
    frame.remove();window.removeEventListener('message',receive);
   };window.addEventListener('message',receive);
  };</script>`}));
 await page.goto(url);
 const bytes=Buffer.from('%PDF-1.4\nFictional picker test');
 const key='google-forms:7';
 const pdf={id:'fixture',key,name:'approved.pdf',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
 const step={fields:[{key,type:'file',label:'Resume',required:true,manualUpload:true}],files:{[key]:[pdf]}};
 const args={step,attachments:[pdf],autoSubmit:true};
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,false);
 assert.equal(await page.locator('ul').nth(1).locator('li').count(),0);
 assert.deepEqual(await page.evaluate(()=>window.uploads),[{name:'approved.pdf',bytes:bytes.toString()}]);
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,false);
 assert.equal(await page.evaluate(()=>window.uploads.length),1);
 await page.locator('ul li').evaluate(el=>{el.textContent='Different.pdf';});
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,true);
 assert.equal(await page.evaluate(()=>window.uploads.length),1);
 await page.locator('ul li').evaluate(item=>{
  const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove file');
  remove.onclick=()=>item.remove();item.append(remove);
 });
 assert.equal((await page.evaluate(attachSignupPdfs,args)).blocked,false);
 assert.equal(await page.evaluate(()=>window.uploads.length),2);
 assert.equal(await page.locator('ul').first().locator('li').count(),1);
});
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
