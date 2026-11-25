import test from 'node:test';
import assert from 'node:assert/strict';
import {changeEmail,createEmailAdapter} from '../server/email.js';
const url='https://events.example.org/register?event=orbit&mode=public';
const before={id:'registration',kind:'registration_closes',label:'Registration closes',date:'2026-12-08',time:'17:00',zone:'UTC',quote:'Registration closes 8 December.',sourceUrl:url};
const after={...before,date:'2026-12-10',time:'18:30',zone:'Asia/Kolkata',quote:'Registration now closes 10 December 2026 at 6:30 PM IST.'};
const track={title:'Orbit Hack',url,milestones:[after,{id:'event',kind:'event',label:'Event starts',date:'2026-12-12',time:'09:00',zone:'Asia/Kolkata'}]};
const change={kind:'registration_closes',label:'Registration closes',before,after,impact:'You have two more days to register.'};
test('change email has labelled red/green cards, exact timezones, evidence, event details and direct links',()=>{
 const mail=changeEmail(track,change,{displayName:'Alex'});
 assert.match(mail.html,/PREVIOUS DATE/);assert.match(mail.html,/NEW DATE/);assert.match(mail.html,/#fff1f0/);assert.match(mail.html,/#eaf9ef/);assert.match(mail.html,/5:00 PM UTC/);assert.match(mail.html,/6:30 PM IST/);assert.match(mail.html,/Hi Alex,/);assert.match(mail.html,/Event starts/);assert.match(mail.html,/View event page/);assert.match(mail.html,/View source evidence/);assert.match(mail.html,/event=orbit&amp;mode=public/);assert.match(mail.text,/Event page: https:\/\/events.example.org/);assert.match(mail.text,/Before: 2026-12-08 17:00 UTC/);
});
test('mail escapes untrusted page/profile text and excludes unsafe links',()=>{
 const mail=changeEmail({...track,title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)'},{...change,after:{...after,sourceUrl:'data:text/html,unsafe',quote:'<script>alert("bad")</script>'}},{displayName:'<script>name</script>'});
 assert.doesNotMatch(mail.html,/<script>|<img src=x|href="(?:javascript|data):/);assert.match(mail.html,/&lt;script&gt;/);assert.match(mail.html,/&lt;img/);assert.doesNotMatch(mail.html,/View event page/);
});
test('date-only changes never invent a time or timezone and remain readable without CSS or images',()=>{
 const mail=changeEmail({...track,milestones:[]},{...change,before:{...before,time:null,zone:null},after:{...after,time:null,zone:null,quote:'Registration now closes 10 December 2026.'}});
 assert.match(mail.html,/Date only/);assert.doesNotMatch(mail.html,/5:00 PM|6:30 PM|11:59/);assert.match(mail.html,/DEADLINE/);assert.match(mail.html,/SCOUT/);assert.match(mail.html,/role="presentation"/);assert.match(mail.html,/@media only screen/);assert.match(mail.text,/Hi there,/);
});
test('Brevo receives both HTML and plain text with the original recipient and idempotency key',async()=>{
 let payload;const mail=changeEmail(track,change,{displayName:'Alex'});const adapter=createEmailAdapter({EMAIL_PROVIDER:'brevo',BREVO_API_KEY:'fake',BREVO_SENDER_EMAIL:'sender@example.org'},async(_url,options)=>{payload=JSON.parse(options.body);return Response.json({messageId:'fake-id'});});
 await adapter.send({...mail,to:'recipient@example.org',id:'one-change'});assert.equal(payload.htmlContent,mail.html);assert.equal(payload.textContent,mail.text);assert.equal(payload.headers.IdempotencyKey,'one-change');assert.equal(payload.to[0].email,'recipient@example.org');
 await adapter.send({to:'recipient@example.org',subject:'Test',text:'Hi Alex,\n\nConnected.',id:'test'});assert.match(payload.htmlContent,/DEADLINE/);assert.equal(payload.textContent,'Hi Alex,\n\nConnected.');
});
