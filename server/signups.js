import {randomUUID} from 'node:crypto';
import {hash,safeUrl,randomToken} from './security.js';
import {formSignature,validateAnswer,validateFiles} from '../extension/shared/signup.js';
import {instant} from '../extension/shared/dates.js';
import {renderSignupEmail} from './email-template.js';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function demoSignupSchema(){return {version:1,open:true,fee:0,terms:'Demo terms: no real organizer receives your data.',fields:[
 {key:'id:name',id:'name',name:'name',label:'Full name',type:'text',required:true,options:[]},
 {key:'id:email',id:'email',name:'email',label:'Email',type:'email',required:true,options:[]},
 {key:'id:repo',id:'repo',name:'repo',label:'GitHub repository URL',help:'Must use github.com',type:'url',required:true,options:[]},
 {key:'id:proposal',id:'proposal',name:'proposal',label:'Proposal PDF',type:'file',required:true,options:[],accept:'.pdf',maxBytes:200*1024,multiple:false}
 ]};}
export class Signups {
 constructor({store,secrets,base}){Object.assign(this,{store,secrets,base});}
 read(owner,id){const r=this.store.get(owner,'signup',id);if(!r)throw fail('Signup draft not found.',404);return {...this.secrets.open(r.sealed),...r,sealed:undefined};}
 save(owner,d){const {sealed,...plain}=d;this.store.put(owner,'signup',d.id,{id:d.id,trackId:d.trackId,status:d.status,backupAt:d.backupAt,sealed:this.secrets.seal(plain)});return d;}
 list(owner){return this.store.list(owner,'signup').filter(r=>r.status!=='Deleted').map(r=>this.read(owner,r.id));}
 schema(){const s=this.store.get('_system','demoOrganizer','schema')||demoSignupSchema();return {...s,fields:this.capture({url:this.base+'/signup-demo.html',fields:s.fields}).fields};}
 capture(input){safeUrl(input.url);const url=new URL(input.url).href;if(!Array.isArray(input.fields)||input.fields.length>100)throw fail('Invalid form capture.');
  const step={url,formIndex:Number.isInteger(input.formIndex)&&input.formIndex>=0&&input.formIndex<100?input.formIndex:0,title:String(input.title||'Signup').slice(0,200),capturedAt:typeof input.capturedAt==='string'&&Number.isFinite(Date.parse(input.capturedAt))?input.capturedAt:new Date().toISOString(),terms:String(input.terms||'').slice(0,8000),warnings:(input.warnings||[]).slice(0,30).map(String),fields:input.fields.map(f=>{
   if(!f.key||!['text','email','tel','url','textarea','select','radio','file','number','date'].includes(f.type))throw fail('Unsupported captured field.');
   return {key:String(f.key).slice(0,300),id:String(f.id||'').slice(0,200),name:String(f.name||'').slice(0,200),label:String(f.label||'Field').slice(0,300),help:String(f.help||'').slice(0,1500),type:f.type,required:!!f.required,options:(f.options||[]).slice(0,100).map(o=>({value:String(o.value).slice(0,500),label:String(o.label).slice(0,500)})),accept:String(f.accept||'').slice(0,200),multiple:!!f.multiple,maxBytes:Number(f.maxBytes)||null,maxLength:Number(f.maxLength)||null,pattern:String(f.pattern||'').slice(0,500),min:String(f.min||''),max:String(f.max||'')};})};
  step.stepToken=String(input.stepToken||'').slice(0,300);
  if(new Set(step.fields.map(f=>f.key)).size!==step.fields.length)throw fail('Ambiguous fields. Capture a smaller step.');return {...step,signature:hash(formSignature(step))};
 }
 validate(owner,d){
  if(!this.store.get(owner,'track',d.trackId))throw fail('Choose an active tracked page.');
  if(!d.steps.length)throw fail('Capture at least one form step.');
  for(const step of d.steps)for(const f of step.fields){const err=f.type==='file'?validateFiles(f,step.files?.[f.key]||[]):validateAnswer(f,step.answers?.[f.key]);if(err)throw fail(f.label+': '+err);if(/anyone with (?:the )?link|publicly (?:viewable|accessible)/i.test(f.help||'')&&!step.sharing?.[f.key])throw fail('Confirm sharing access for '+f.label);}
  if(!d.reviewedAll)throw fail('Confirm that every step and any manual actions have been reviewed.');
 }
 file(owner,input){
  const bytes=Buffer.from(input.data||'','base64');if(bytes.length>200*1024||!bytes.length||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!String(input.name).toLowerCase().endsWith('.pdf'))throw fail('Demo uploads require a valid PDF, up to 200 KB.');
  const id=randomUUID(),file={id,name:String(input.name).slice(0,200),size:bytes.length,type:'application/pdf',sha256:hash(bytes),version:id,expires:Date.now()+7*86400000};
  this.store.put(owner,'signupFile',id,{...file,sealed:this.secrets.seal({data:bytes.toString('base64')})});return file;
 }
 approvedFiles(owner,d){for(const step of d.steps)for(const f of step.fields.filter(f=>f.type==='file'))for(const ref of step.files?.[f.key]||[]){const file=this.store.get(owner,'signupFile',ref.id);if(!file||file.expires<Date.now()||file.sha256!==ref.sha256||file.version!==ref.version||hash(Buffer.from(this.secrets.open(file.sealed).data,'base64'))!==ref.sha256)throw fail('Approved file missing, expired or replaced. Review '+f.label+'.');}}
 cancelNotices(owner,id){for(const d of this.store.list(owner,'delivery'))if(d.signupId===id&&['queued','retry','sending'].includes(d.status))this.store.put(owner,'delivery',d.id,{...d,status:'cancelled'});}
 async route(owner,path,method,b){
  if(path==='/api/signup-profile'){
   const existing=this.store.get(owner,'signupProfile','me')||{name:'',phone:'',college:'',links:[]};if(method==='GET')return this.secrets.open(existing.sealed||this.secrets.seal(existing));
   if(method!=='POST')throw fail('Method not allowed.',405);
   const profile={name:String(b.name||'').slice(0,100),phone:String(b.phone||'').slice(0,80),college:String(b.college||'').slice(0,200),links:(b.links||[]).slice(0,30).map(l=>({kind:['github','repository','portfolio','video','deck'].includes(l.kind)?l.kind:'portfolio',name:String(l.name||l.kind).slice(0,80),url:safeUrl(l.url).href}))};this.store.put(owner,'signupProfile','me',{sealed:this.secrets.seal(profile)});return profile;
  }
  if(path==='/api/signup-files'&&method==='POST')return this.file(owner,b);
  if(path==='/api/signups/run'&&method==='POST'){await this.tick(owner);return {ok:true};}
  if(path==='/api/signups'&&method==='GET')return this.list(owner);
  if(path==='/api/signups'&&method==='POST'){
   const old=b.id?this.read(owner,b.id):null;if(old&&['Confirmed','Already registered','Deleted'].includes(old.status))throw fail('Completed drafts cannot be edited.');if(old&&b.revision!==undefined&&b.revision!==(old.revision||0))throw fail('This draft changed in another tab. Reopen it before saving.',409);
   if(!this.store.get(owner,'track',b.trackId))throw fail('Select an active tracked page.');
   const steps=(b.steps||[]).slice(0,12).map(s=>({...this.capture(s),answers:Object.fromEntries(Object.entries(s.answers||{}).slice(0,100).map(([k,v])=>[k,String(v).slice(0,10000)])),sources:s.sources||{},sharing:s.sharing||{},files:s.files||{}}));
   if(!steps.length||steps.some(s=>new URL(s.url).origin!==new URL(steps[0].url).origin))throw fail('Capture steps from one form site.');
   if(old)this.cancelNotices(owner,old.id);const d={...old,revision:(old?.revision||0)+1,id:old?.id||randomUUID(),trackId:b.trackId,title:String(b.title||'Signup').slice(0,200),steps,extensionId:/^[a-p]{32}$/.test(b.extensionId)?b.extensionId:old?.extensionId||null,formUrl:steps[0].url,status:'Draft',mode:'reminder',createdAt:old?.createdAt||new Date().toISOString(),reviewedAll:!!b.reviewedAll};return this.save(owner,d);
  }
  const match=path.match(/^\/api\/signups\/([\w-]+)(?:\/(arm|cancel|registered|steps|reorder|restore|submit-now))?$/);if(!match)throw fail('Signup route not found.',404);
  const d=this.read(owner,match[1]);if(method==='DELETE'&&!match[2]){this.cancelNotices(owner,d.id);d.status='Deleted';d.reviewedAll=false;d.revision=(d.revision||0)+1;return this.save(owner,d);}
  if(method==='POST'&&match[2]==='restore'){if(d.status!=='Deleted')throw fail('This draft was not deleted.');d.status='Draft';d.reviewedAll=false;d.revision=(d.revision||0)+1;return this.save(owner,d);}
  if(d.status==='Deleted')throw fail('Draft was deleted.',404);if(method==='GET'&&!match[2])return d;if(method!=='POST')throw fail('Method not allowed.',405);
  if(match[2]==='submit-now'){if(!b.approved)throw fail('Approve demo submission.');const armed=await this.route(owner,'/api/signups/'+d.id+'/arm','POST',{...b,mode:'demo-auto',rule:'fixed',backupAt:Date.now()+1000,approved:true});armed.backupAt=Date.now()-1;this.save(owner,armed);await this.tick(owner);return this.read(owner,d.id);}
  if(match[2]==='reorder'){
   if(['Confirmed','Already registered'].includes(d.status))throw fail('Completed signups cannot be reordered.');
   if(b.revision!==(d.revision||0))throw fail('Draft changed in another tab. Refresh before reordering.',409);
   const order=b.order;if(!Array.isArray(order)||order.length!==d.steps.length||new Set(order).size!==order.length||order.some(i=>!Number.isInteger(i)||i<0||i>=d.steps.length))throw fail('Provide each step exactly once.');
   d.steps=order.map(i=>d.steps[i]);d.formUrl=d.steps[0].url;if(d.status!=='Cancelled')d.status='Draft';d.reviewedAll=false;d.revision=(d.revision||0)+1;this.cancelNotices(owner,d.id);return this.save(owner,d);
  }
  if(match[2]==='steps'){
   if(['Confirmed','Already registered','Cancelled'].includes(d.status))throw fail('Choose an active signup draft.');
   const incoming=this.capture(b.step);if(new URL(incoming.url).origin!==new URL(d.formUrl).origin)throw fail('This form is on another site. Start a separate signup.');
   const identity=s=>JSON.stringify([s.url,s.formIndex||0,s.fields.map(f=>f.key).sort()]),index=d.steps.findIndex(s=>identity(s)===identity(incoming)&&(!s.stepToken||!incoming.stepToken||s.stepToken===incoming.stepToken));
   const step={...incoming,answers:b.step.answers||{},sources:b.step.sources||{},files:{},sharing:{}};
   if(index>=0){const old=d.steps[index];for(const f of step.fields){if(!validateAnswer(f,old.answers?.[f.key]))step.answers[f.key]=old.answers?.[f.key]||'';if(f.type==='file'&&!validateFiles(f,old.files?.[f.key]||[]))step.files[f.key]=old.files?.[f.key]||[];}d.steps[index]=step;}else{if(d.steps.length>=12)throw fail('Maximum 12 captured steps.');d.steps.push(step);}
   if(/^[a-p]{32}$/.test(b.extensionId))d.extensionId=b.extensionId;d.status='Draft';d.reviewedAll=false;d.revision=(d.revision||0)+1;this.cancelNotices(owner,d.id);return this.save(owner,d);
  }
  if(match[2]==='registered'){this.cancelNotices(owner,d.id);d.status='Already registered';d.notice='You marked this signup as already registered. Backup stopped.';return this.save(owner,d);}
  if(match[2]==='cancel'){this.cancelNotices(owner,d.id);d.status='Cancelled';return this.save(owner,d);}
  if(match[2]!=='arm')throw fail('Action not found.',404);this.validate(owner,d);
  const track=this.store.get(owner,'track',d.trackId),milestone=track.milestones.find(m=>m.id===b.milestoneId);if(!milestone)throw fail('Choose a tracked deadline.');
  if(track.conflicts?.length||track.uncertain?.length||track.missing?.length)throw fail('Resolve the tracked deadline before arming.');
  if(!b.approved)throw fail('Approve the exact snapshot and backup time.');
  d.milestoneId=milestone.id;d.deadline=milestone;d.mode=b.mode==='demo-auto'?'demo-auto':'reminder';d.rule=b.rule==='relative'?'relative':'fixed';d.offsetMinutes=Number(b.offsetMinutes??15);
  if(!Number.isInteger(d.offsetMinutes)||d.offsetMinutes<0||d.offsetMinutes>10080)throw fail('Choose an offset between 0 and 10080 minutes.');
  d.backupAt=d.rule==='relative'?this.deadlineTime(milestone)-d.offsetMinutes*60000:Number(b.backupAt);if(!Number.isFinite(d.backupAt)||d.backupAt<=Date.now())throw fail('Choose a future backup time.');
  if(d.backupAt>=this.deadlineTime(milestone))throw fail('Backup time must be before the confirmed deadline.');
  if(d.mode==='demo-auto'){
   if(d.steps.some(s=>s.warnings?.length))throw fail('Resolve manual controls before automatic submission.');
   if(d.steps.length!==1||new URL(d.formUrl).href!==this.base+'/signup-demo.html')throw fail('Automatic submission is supported only by the built-in demo organizer.');
   const schema=this.schema();if(schema.fee||schema.open!==true||schema.terms!==d.steps[0].terms)throw fail('Demo terms, fee or availability need review.');
   if(JSON.stringify(schema.fields)!==JSON.stringify(d.steps[0].fields))throw fail('Demo form changed. Capture its latest version.');
   this.approvedFiles(owner,d);d.organizerVersion=schema.version;
  }
  d.approvedAt=new Date().toISOString();d.status='Armed';delete d.notice;return this.save(owner,d);
 }
 notify(owner,d,message){
  const id='signup:'+d.id+':'+hash(d.status+'|'+message).slice(0,16),url=this.base+'/backup.html#draft='+d.id,p=this.store.get(owner,'profile','me');
  this.store.put(owner,'delivery',id+':browser',{id:id+':browser',channel:'browser',status:'queued',signupId:d.id,trackId:d.trackId,notice:{title:d.title,label:d.status,message,url}});
  if(p?.emailEnabled&&p.emailVerified)this.store.put(owner,'delivery',id+':email',{id:id+':email',channel:'email',status:'queued',signupId:d.id,trackId:d.trackId,to:p.email,subject:d.status+': '+d.title,text:message+'\n\nResume signup: '+url,html:renderSignupEmail(d.status+': '+d.title,message,url),attempts:0,createdAt:Date.now(),nextTry:Date.now()});
 }
 async tick(onlyOwner){
  for(const {owner,record} of this.store.allSignups()){
   if(onlyOwner&&owner!==onlyOwner||record.status!=='Armed')continue;const d=this.read(owner,record.id),track=this.store.get(owner,'track',d.trackId);
   if(!track){d.status='Cancelled';this.save(owner,d);continue;}
   try{
    if(track.conflicts?.length||track.uncertain?.length||track.missing?.length||track.status==='check_failed')throw fail('The tracked deadline needs review.');
    const m=track.milestones.find(m=>m.id===d.milestoneId);if(!m)throw fail('Tracked milestone was removed.');
    if(JSON.stringify([m.date,m.time,m.zone])!==JSON.stringify([d.deadline.date,d.deadline.time,d.deadline.zone])){
     if(d.rule!=='relative')throw fail('The deadline changed. Review your fixed backup time.');
     d.backupAt=this.deadlineTime(m)-d.offsetMinutes*60000;d.deadline=m;if(d.backupAt<=Date.now())throw fail('The recalculated backup time has passed. Review now.');this.save(owner,d);
    }
    if(d.backupAt>Date.now())continue;
    this.validate(owner,d);
    if(this.deadlineTime(m)<=Date.now())throw fail('Registration may have closed. Review now.');
    if(d.mode==='reminder'){d.status='Ready to finish';d.notice='Reopen the form, restore reviewed answers, attach the listed files, and submit yourself.';}
    else{
     const schema=this.schema();if(schema.open!==true||schema.fee||schema.version!==d.organizerVersion||schema.terms!==d.steps[0].terms||JSON.stringify(schema.fields)!==JSON.stringify(d.steps[0].fields))throw fail('Organizer form, terms, fee or registration status changed.');
     this.approvedFiles(owner,d);
     const email=d.steps[0].answers['id:email'],key=hash(owner+'|demo|'+email.toLowerCase()),existing=this.store.get('_system','demoSignup',key);
     if(existing){d.status=existing.draftId===d.id?'Confirmed':'Already registered';d.receipt=existing.id;}
     else{const files=Object.values(d.steps[0].files||{}).flat().map(ref=>{const file=this.store.get(owner,'signupFile',ref.id);return {name:file.name,type:file.type,sha256:file.sha256,...this.secrets.open(file.sealed)};});const receipt={owner,key,id:'DEMO-'+randomToken().slice(0,10),draftId:d.id,at:new Date().toISOString(),sealedRegistration:this.secrets.seal({answers:d.steps[0].answers,files})};this.store.put('_system','demoSignup',key,receipt);if(schema.timeoutOnce){schema.timeoutOnce=false;this.store.put('_system','demoOrganizer','schema',schema);throw Object.assign(new Error('Demo timeout; checking organizer status on next run.'),{retry:true});}d.status='Confirmed';d.receipt=receipt.id;}
     d.notice='Demo organizer receipt: '+d.receipt+'. No external registration was submitted.';
    }
   }catch(e){if(e.retry){d.notice=e.message;this.save(owner,d);continue;}d.status='Needs review';d.notice=e.message;}
   this.save(owner,d);this.notify(owner,d,d.notice);
  }
 }
 deadlineTime(m){return m.time?Date.parse(instant(m)):Date.parse(m.date+'T23:59:00+05:30');}
}
