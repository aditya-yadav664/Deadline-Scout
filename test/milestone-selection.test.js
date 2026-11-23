import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMilestone} from '../extension/shared/milestone-selection.js';
import {extract} from '../extension/shared/extract.js';
const url='https://example.org/event';
const catalog=extract('Registration closes 24 November 2026; Event date: 1 December 2026',url);
test('changing milestone replaces date, evidence and confirmation together',()=>{
 const next=selectMilestone({...catalog[0],confirmed:true},'event',catalog);
 assert.equal(next.date,'2026-12-01');assert.match(next.quote,/Event date/);assert.equal(next.confirmed,false);
 assert.equal(selectMilestone(next,'registration_closes',catalog).date,'2026-11-24');
});
test('missing and conflicting milestones never inherit another milestone date',()=>{
 assert.equal(selectMilestone(catalog[0],'payment',catalog).date,'');
 assert.equal(selectMilestone(catalog[0],'payment',catalog).manual,true);
 const conflicting=[...catalog,{...catalog[1],date:'2026-12-02'}];
 assert.equal(selectMilestone(catalog[0],'event',conflicting).date,'');
});
test('separate headings and inline schedule clauses retain milestone context',()=>{
 const result=extract('Registration closes\n24 November 2026\nEvent date\n1 December 2026',url);
 assert.deepEqual(result.map(m=>[m.kind,m.date]),[['registration_closes','2026-11-24'],['event','2026-12-01']]);
 assert.deepEqual(catalog.map(m=>m.kind),['registration_closes','event']);
});
