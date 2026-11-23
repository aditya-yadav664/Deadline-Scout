import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, readHtml } from '../extension/shared/extract.js';
import { findDates, instant, impact } from '../extension/shared/dates.js';
import { compare } from '../extension/shared/compare.js';
const url='https://example.org/hackathon';
const original=extract('Registration deadline: 28 November 2026.',url)[0];
const track={plan:'2026-11-27',milestones:[original]};
test('ISO timestamps default to IST and retain explicit source offsets',()=>{
 const missing=findDates('Deadline: 2026-12-10T16:54')[0];assert.equal(missing.date,'2026-12-10');assert.equal(missing.time,'16:54');assert.equal(missing.zone,'Asia/Kolkata');assert.equal(missing.reasons.length,0);
 const offset=findDates('Deadline: 2026-12-10T16:54:00+05:30')[0];assert.equal(offset.zone,'UTC+05:30');assert.equal(offset.reasons.length,0);
 assert.equal(findDates('2026-12-10T16:54:00Z')[0].zone,'UTC');
});
test('separate milestones, explicit update, practical impact',()=>{
  assert.equal(extract('Registration opens 1 November 2026.\nPayment deadline: 29 November 2026.\nEvent date: 1 December 2026.',url).length,3);
  const result=compare(track,[{milestones:[original,...extract('Registration deadline moved from 28 November 2026 to 26 November 2026.',url+'/faq')]}]);
  assert.equal(result.changes.length,1); assert.equal(result.milestones[0].date,'2026-11-26'); assert.match(result.changes[0].impact,/1 day after/);
});
test('wording and banners do not create changes',()=>{
  assert.equal(compare(track,[{milestones:extract('Welcome, new banner!\nRegistration closes on November 28, 2026.',url)}]).changes.length,0);
});
test('unresolved source conflict and missing date preserve baseline',()=>{
  const result=compare(track,[{milestones:[original,...extract('Registration deadline: 26 November 2026.',url+'/faq')]}]);
  assert.equal(result.conflicts.length,1);assert.equal(result.milestones[0].date,original.date);
  assert.equal(compare(track,[{milestones:[]}]).milestones[0].date,original.date);
});
test('ambiguous dates and missing years require confirmation; missing zones use IST',()=>{
  assert.ok(findDates('03/04/2027')[0].reasons.length);
  assert.ok(findDates('28 November',2026)[0].reasons.length);
  assert.equal(findDates('28 November 2026 at 11:00 pm')[0].zone,'Asia/Kolkata');
  assert.equal(findDates('28 November 2026 at 11:00 pm IST')[0].zone,'Asia/Kolkata');
  assert.ok(findDates('31 February 2026')[0].reasons.length);
  assert.equal(findDates('28 November 2026')[0].time,null);
  assert.equal(findDates('28 November 2026 at 11:00 PM UTC')[0].time,'23:00');
});
test('timezone conversion and DST validation',()=>{
  assert.equal(instant({date:'2026-11-28',time:'23:00',zone:'Asia/Kolkata'}),'2026-11-28T17:30:00.000Z');
  assert.throws(()=>instant({date:'2027-03-14',time:'02:30',zone:'America/New_York'}),/does not exist/);
  assert.throws(()=>instant({date:'2026-11-01',time:'01:30',zone:'America/New_York'}),/Repeated/);
  assert.match(impact('2026-11-27',{date:'2026-11-26'}),/after/);
});
test('structured data and FAQ discovery',()=>{
 const result=readHtml('<title>Demo</title><script type="application/ld+json">{"@type":"Event","startDate":"2026-12-01"}</script><p>Registration closes 28 November 2026.</p><a href="/faq">FAQ</a>',url);
 assert.equal(result.milestones.length,2);assert.equal(result.links[0].url,'https://example.org/faq');
});
test('confirmed timezone interpretation persists but a new clock time requires review',()=>{
  const initial=extract('Registration closes 28 November at 11:00 pm.',url,2026)[0];
  const confirmed={...initial,date:'2026-11-28',zone:'Asia/Kolkata',uncertain:false,confirmedRaw:initial.raw,confirmedDetectedTime:initial.time,confirmedDetectedZone:initial.zone};
  const result=compare({milestones:[confirmed]},[{milestones:[initial]}]);assert.equal(result.uncertain.length,0);assert.equal(result.milestones[0].zone,'Asia/Kolkata');
  const changed=extract('Registration closes 28 November at 10:00 pm.',url,2026)[0];assert.equal(compare({milestones:[confirmed]},[{milestones:[changed]}]).uncertain.length,1);
});
