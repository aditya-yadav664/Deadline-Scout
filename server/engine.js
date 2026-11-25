import {repairMixedSnapshot} from '../extension/shared/milestone-selection.js';
import { randomUUID } from 'node:crypto';
import { compare } from '../extension/shared/compare.js';
import { scheduleKey } from '../extension/shared/dates.js';
import { changeEmail } from './email.js';
import { hash } from './security.js';
export class Engine {
  constructor({store,readPage,email,google}){Object.assign(this,{store,readPage,email,google});this.locks=new Set();this.delivering=new Set();}
  async check(owner,id) {
    const lock=owner+':'+id;if(this.locks.has(lock))throw new Error('A check or update is already in progress.');this.locks.add(lock);
    try {
      const t=this.store.get(owner,'track',id);if(!t)throw new Error('Tracking record not found.');
      if(t.milestones.every(m=>m.manual)){t.status='manual';t.lastAttempt=new Date().toISOString();this.store.put(owner,'track',id,t);return t;}
      const observations=[],errors=[];
      for(const url of t.sources){try{observations.push(await this.readPage(url));}catch(e){errors.push({url,message:e.message});}}
      const now=new Date().toISOString();t.lastAttempt=now;t.nextCheck=Date.now()+t.intervalMinutes*60000;t.errors=errors;
      // Do not adopt a one-sided change if an approved source could not be read.
      if(errors.length){if(errors.some(e=>/ENOTFOUND|EAI_AGAIN|ETIMEOUT|timed out|ECONNRESET|busy|HTTP (?:429|50[234])/i.test(e.message)))t.nextCheck=Date.now()+60000;t.status='check_failed';this.store.put(owner,'track',id,t);return t;}
      repairMixedSnapshot(t,observations);
      const result=compare(t,observations);
      Object.assign(t,result,{lastSuccessfulCheck:now,status:result.conflicts.length?'conflict':result.uncertain.length?'needs_review':result.missing.length?'date_missing':result.changes.length?'changed':t.milestones.every(m=>m.manual)?'manual':'watching'});
      const changes=result.changes.map(c=>({...c,id:randomUUID(),trackId:id,title:t.title,at:now}));delete t.changes;
      this.store.transaction(()=>{
        this.store.put(owner,'track',id,t);
        for(const c of changes){
          this.store.put(owner,'change',c.id,c);
          this.store.put(owner,'delivery',c.id+':browser',{id:c.id+':browser',changeId:c.id,channel:'browser',status:'queued',at:now});
          const p=this.store.get(owner,'profile','me');
          if(p?.emailEnabled&&(p.emailVerified||this.email.mode==='demo'&&p.local))this.store.put(owner,'delivery',c.id+':email',{id:c.id+':email',changeId:c.id,channel:'email',status:'queued',to:p.email,...changeEmail(t,c,p),attempts:0,createdAt:Date.now(),nextTry:Date.now(),at:now});
        }
      });
      if(!result.conflicts.length&&!result.uncertain.length&&t.autoGoogle) {
        for(const c of changes) for(const link of this.store.list(owner,'googleLink').filter(l=>l.trackId===id&&l.milestoneId===c.before.id&&l.state==='linked')) {
          try{await this.google.perform(owner,t,t.milestones.find(m=>m.id===link.milestoneId),link.channel,link.minutes);}catch(e){t.googleError=e.message;this.store.put(owner,'track',id,t);}
        }
      }
      await this.deliver(owner);return t;
    }finally{this.locks.delete(lock);}
  }
  async deliver(owner) {
    if(this.delivering.has(owner))return;this.delivering.add(owner);
    try{for(const d of this.store.list(owner,'delivery').filter(d=>d.channel==='email'&&['queued','retry','sending'].includes(d.status)&&d.nextTry<=Date.now())) {
      const p=this.store.get(owner,'profile','me');
      if(!p?.emailEnabled||!(p.emailVerified||this.email.mode==='demo'&&p.local)||p.email!==d.to){d.status='cancelled';this.store.put(owner,'delivery',d.id,d);continue;}
      // Brevo's idempotency window is 15 minutes. Never auto-retry an
      // uncertain request beyond that window, including after a long outage.
      if(d.firstAttempt && Date.now()-d.firstAttempt>14*60000){d.status='needs_review';d.error='Delivery uncertain; automatic retries stopped before Brevo idempotency expired.';this.store.put(owner,'delivery',d.id,d);continue;}
      d.firstAttempt ||= Date.now();d.attempts++;d.status='sending';d.nextTry=Date.now()+30000;this.store.put(owner,'delivery',d.id,d);
      try {Object.assign(d,await this.email.send({to:d.to,subject:d.subject,text:d.text,id:hash(owner+d.id)}));}
      catch(e){d.error=e.message;d.status=e.transient&&d.attempts<6?'retry':'failed';d.nextTry=Date.now()+Math.min(120000,15000*2**d.attempts);}
      this.store.put(owner,'delivery',d.id,d);
    }}finally{this.delivering.delete(owner);}
  }
  async tick(){
    const owners=new Set();
    for(const {owner,track} of this.store.allTracks()){owners.add(owner);if(track.nextCheck<=Date.now()&&!track.milestones.every(m=>m.manual))await this.check(owner,track.id).catch(()=>{});}
    for(const owner of owners)await this.deliver(owner);
  }
}
