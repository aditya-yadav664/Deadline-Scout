import test from 'node:test';
import assert from 'node:assert/strict';
import {compare} from '../extension/shared/compare.js';
import {dedupeMilestones} from '../extension/shared/milestone-selection.js';
const event=(name,date)=>({kind:'event',label:'Event date',date,time:null,zone:null,sourceUrl:'https://example.com',quote:`${name} event date ${date}`});
test('repeated evidence is removed while distinct same-day sessions remain',()=>{
 const a=event('Workshop','2027-06-12'),b=event('Showcase','2027-06-12');
 assert.equal(dedupeMilestones([a,{...a},b]).length,2);
});
test('same-kind same-day sessions update independently',()=>{
 const a={...event('Workshop','2027-06-12'),id:'a'},b={...event('Showcase','2027-06-12'),id:'b'};
 const result=compare({milestones:[a,b]},[{milestones:[event('Workshop','2027-06-15'),b]}]);
 assert.equal(result.conflicts.length,0);assert.equal(result.changes.length,1);
 assert.equal(result.milestones[0].date,'2027-06-15');assert.equal(result.milestones[1].date,'2027-06-12');
});
import {mergeCapturedMilestones,repairMixedSnapshot} from '../extension/shared/milestone-selection.js';
test('stale browser snapshot is replaced by the fresh server schedule',()=>{
 const before=event('Workshop','2027-06-12'),after=event('Workshop','2027-06-15');
 const merged=mergeCapturedMilestones([before],[after]);assert.equal(merged.length,1);assert.equal(merged[0].date,after.date);assert.equal(merged[0].manual,false);
});
test('legacy mixed snapshots repair in place, archive originals, and subsequent changes preserve IDs',()=>{
 const kinds=['event','registration_closes','event_end','doors_open'];
 const fresh=kinds.map(kind=>({...event('Schedule','2027-08-05'),kind}));
 const manual=kinds.map((kind,i)=>({...fresh[i],date:'2027-06-12',manual:true,id:'manual-'+kind}));
 const monitored=[{...manual[0],manual:false,id:'event-live'},{...manual[1],manual:false,id:'registration-live'},...[1,2,3].map((n)=>({...manual[3],manual:false,id:'door-'+n,quote:'Event time 10 AM - 1 PM UTC Doors open at 9 AM UTC'}))];
 const track={milestones:[...manual,...monitored]};
 assert.equal(repairMixedSnapshot(track,[{milestones:fresh}]),true);assert.equal(track.milestones.length,4);assert.equal(track.milestoneRepairs[0].milestones.length,9);
 const changed=compare(track,[{milestones:fresh}]);assert.equal(changed.missing.length,0);assert.equal(changed.milestones[0].id,'event-live');assert.equal(changed.milestones[0].date,'2027-08-05');
 assert.equal(repairMixedSnapshot(track,[{milestones:fresh}]),false);
});
