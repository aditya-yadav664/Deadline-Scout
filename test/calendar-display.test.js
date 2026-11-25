import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarPayload,calendarDescription} from '../server/google.js';
const deadline={id:'registration',kind:'registration_closes',label:'Registration closes',date:'2026-12-10',time:'17:00',zone:'Asia/Kolkata',quote:'Raw evidence should not appear',sourceUrl:'https://example.org/evidence/registration'};
const start={id:'start',kind:'event',label:'Event starts',date:'2026-12-12',time:'09:00',zone:'UTC',sourceUrl:'https://example.org/evidence/start'};
const track={id:'one',title:'Builder Week',url:'https://example.org/event?one=1&two=2',plan:'2026-12-09',milestones:[deadline,start]};
test('Calendar descriptions show structured schedule details and exactly one event-page link',()=>{
 const result=calendarPayload(track,deadline,60);
 assert.equal(result.summary,'Builder Week — Registration closes');assert.match(result.description,/<b>Other milestones<\/b>/);assert.match(result.description,/Event starts/);assert.match(result.description,/5:00 PM IST/);assert.match(result.description,/9:00 AM UTC/);assert.match(result.description,/<b>Your plan<\/b>/);assert.match(result.description,/9 December 2026/);
 assert.equal((result.description.match(/<a /g)||[]).length,1);assert.match(result.description,/event\?one=1&amp;two=2/);assert.doesNotMatch(result.description,/evidence\/|Raw evidence|Source:/);assert.equal(result.start.dateTime,'2026-12-10T11:30:00.000Z');assert.equal(result.reminders.overrides[0].minutes,60);
});
test('Calendar formatting escapes markup and omits unsafe event links and invalid plans',()=>{
 const description=calendarDescription({...track,title:'<script>bad</script>',url:'javascript:alert(1)',plan:'not-a-date'},{...deadline,label:'<b>Injected label</b>'});
 assert.doesNotMatch(description,/<script>|href="javascript:|<b>Injected label/);assert.match(description,/&lt;script&gt;/);assert.match(description,/&lt;b&gt;Injected label/);assert.doesNotMatch(description,/<b>Your plan/);
});
