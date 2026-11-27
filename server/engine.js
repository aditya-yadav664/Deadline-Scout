import {repairMixedSnapshot} from '../extension/shared/milestone-selection.js';
import { randomUUID } from 'node:crypto';
import { compare } from '../extension/shared/compare.js';
import { scheduleKey } from '../extension/shared/dates.js';
import { changeEmail } from './email.js';
import { hash } from './security.js';
import { recordIntelligence } from './intelligence.js';
import { recordSourceCheck } from './opportunities.js';
export class Engine {
  constructor({store,readPage,email,google}){Object.assign(this,{store,readPage,email,google});this.locks=new Set();this.reading=new Set();this.delivering=new Set();}
  async check(owner,id,{deferDelivery=false,verifiedObservations}={}) {
    const lock=owner+':'+id;if(this.locks.has(lock))throw new Error('A check or update is already in progress.');this.locks.add(lock);
    try {
      const t=this.store.get(owner,'track',id);if(!t)throw new Error('Tracking record not found.');
      if(t.milestones.every(m=>m.manual)){t.status='manual';t.lastAttempt=new Date().toISOString();this.store.put(owner,'track',id,t);return t;}
      const observations=verifiedObservations||[],errors=[];
      for(const url of verifiedObservations?[]:t.sources){if(!this.store.get(owner,'track',id))throw new Error('Tracked page was removed. Check cancelled.');try{this.reading.add(lock);observations.push({...await this.readPage(url),requestedUrl:url});}catch(e){errors.push({url,message:e.message});}finally{this.reading.delete(lock);}if(!this.store.get(owner,'track',id))throw new Error('Tracked page was removed. Check cancelled.');}
      const now=new Date().toISOString();t.lastAttempt=now;t.nextCheck=Date.now()+t.intervalMinutes*60000;t.errors=errors;
      // Do not adopt a one-sided change if an approved source could not be read.
      if(errors.length){if(errors.some(e=>/ENOTFOUND|EAI_AGAIN|ETIMEOUT|timed out|ECONNRESET|busy|HTTP (?:429|50[234])/i.test(e.message)))t.nextCheck=Date.now()+60000;t.status='check_failed';
        this.store.transaction(()=>{
          this.store.put(owner,'track',id,t);
          recordSourceCheck(this.store,owner,t,observations,errors,now);
          recordIntelligence(this.store,owner,t,observations,now);
        });return t;}
      repairMixedSnapshot(t,observations);
      const result=compare(t,observations);
      Object.assign(t,result,{lastSuccessfulCheck:now,status:result.conflicts.length?'conflict':result.uncertain.length?'needs_review':result.missing.length?'date_missing':result.changes.length?'changed':t.milestones.every(m=>m.manual)?'manual':'watching'});
      const changes=result.changes.map(c=>({...c,id:randomUUID(),trackId:id,title:t.title,at:now}));delete t.changes;
      this.store.transaction(()=>{
        this.store.put(owner,'track',id,t);
        recordSourceCheck(this.store,owner,t,observations,errors,now);
        recordIntelligence(this.store,owner,t,observations,now);
        for(const c of changes){
          this.store.put(owner,'change',c.id,c);
          this.store.put(owner,'delivery',c.id+':browser',{id:c.id+':browser',changeId:c.id,trackId:id,channel:'browser',status:'queued',at:now});
          const p=this.store.get(owner,'profile','me');
          if(p?.emailEnabled&&(p.emailVerified||this.email.mode==='demo'&&p.local))this.store.put(owner,'delivery',c.id+':email',{id:c.id+':email',changeId:c.id,trackId:id,channel:'email',status:'queued',to:p.email,...changeEmail(t,c,p),attempts:0,createdAt:Date.now(),nextTry:Date.now(),at:now});
        }
      });
      await this.syncGoogle(owner,t,changes.length>0);
      if(!deferDelivery)await this.deliver(owner);return t;
    }finally{this.locks.delete(lock);}
  }
  async syncGoogle(owner,t,detailsChanged=false) {
    // Linking an entry authorizes keeping that existing entry in sync. Never
    // create entries for unlinked milestones, or write an unverified date.
    if(!this.store.get(owner,'track',t.id))return;
    if(t.conflicts?.length||t.uncertain?.length||t.missing?.length)return;
    const errors=[];
    for(const link of this.store.list(owner,'googleLink').filter(l=>l.trackId===t.id&&l.state==='linked')) {
      if(!this.store.get(owner,'track',t.id))return;
      const m=t.milestones.find(m=>m.id===link.milestoneId);
      if(!m||m.manual||(!detailsChanged&&scheduleKey(m)===scheduleKey(link)))continue;
      try{await this.google.perform(owner,t,m,link.channel,link.minutes);}catch(e){errors.push(e.message);}
    }
    if(errors.length)t.googleError='Google sync pending: '+[...new Set(errors)].join(' ');else delete t.googleError;
    if(this.store.get(owner,'track',t.id))this.store.put(owner,'track',t.id,t);
  }
  async deliver(owner) {
    if(this.delivering.has(owner))return;this.delivering.add(owner);
    try{await this.store.loadDeliveries?.(owner);for(const d of this.store.list(owner,'delivery').filter(d=>d.channel==='email'&&['queued','retry','sending'].includes(d.status)&&d.nextTry<=Date.now())) {
      const change=d.changeId&&this.store.get(owner,'change',d.changeId),trackId=d.trackId||change?.trackId;
      if(d.signupId&&['Cancelled','Deleted'].includes(this.store.get(owner,'signup',d.signupId)?.status)){d.status='cancelled';this.store.put(owner,'delivery',d.id,d);continue;}
      if(d.type!=='welcome'&&(!trackId||!this.store.get(owner,'track',trackId)||d.changeId&&!change)){d.status='cancelled';d.error='Tracked page removed or alert no longer linked; delivery cancelled.';this.store.put(owner,'delivery',d.id,d);continue;}
      const p=this.store.get(owner,'profile','me');
      if(!p||(!p.emailEnabled&&d.type!=='welcome')||!(p.emailVerified||this.email.mode==='demo'&&p.local)||p.email!==d.to){d.status='cancelled';this.store.put(owner,'delivery',d.id,d);continue;}
      // Brevo's idempotency window is 15 minutes. Never auto-retry an
      // uncertain request beyond that window, including after a long outage.
      if(d.firstAttempt && Date.now()-d.firstAttempt>14*60000){d.status='needs_review';d.error='Delivery uncertain; automatic retries stopped before Brevo idempotency expired.';this.store.put(owner,'delivery',d.id,d);continue;}
      d.firstAttempt ||= Date.now();d.attempts++;d.status='sending';d.nextTry=Date.now()+30000;this.store.put(owner,'delivery',d.id,d);
      try {Object.assign(d,await this.email.send({to:d.to,subject:d.subject,text:d.text,html:d.html,id:hash(owner+d.id)}));}
      catch(e){d.error=e.message;d.status=e.transient&&d.attempts<6?'retry':'failed';d.nextTry=Date.now()+Math.min(120000,15000*2**d.attempts);}
      this.store.put(owner,'delivery',d.id,d);
    }}finally{this.delivering.delete(owner);}
  }
  async tick(){
    if(this.store.loadCron){
      await this.store.loadCron();
      for(const {owner,id} of this.store.dueTracks)await this.check(owner,id,{deferDelivery:true}).catch(()=>{});
      await this.backups?.tick();
      for(const owner of new Set([...this.store.dueEmailOwners,...this.store.pendingEmailOwners()]))await this.deliver(owner);
      return;
    }
    const owners=new Set(this.store.pendingEmailOwners());
    for(const {owner,track} of this.store.allTracks()){owners.add(owner);if(track.nextCheck<=Date.now()&&!track.milestones.every(m=>m.manual))await this.check(owner,track.id).catch(()=>{});}
    await this.backups?.tick();
    for(const owner of this.store.pendingEmailOwners())owners.add(owner);
    for(const owner of owners)await this.deliver(owner);
  }
}
