// Synchronous store contract inside a Postgres transaction.
// The database lock serializes requests across Vercel instances, preventing lost updates.
export class CloudStore {
 constructor(client,rows){this.client=client;this.rows=new Map(rows.map(r=>[JSON.stringify([r.owner,r.kind,r.id]),r]));this.dirty=new Map();this.bulkClears=new Map();this.readStats={queries:0,rows:0,bytes:0};}
 key(owner,kind,id){return JSON.stringify([owner,kind,id]);}
 get(owner,kind,id){const r=this.rows.get(this.key(owner,kind,id));return r?structuredClone(r.body):null;}
 put(owner,kind,id,body){const key=this.key(owner,kind,id),r={owner,kind,id,body:structuredClone(body)};this.rows.set(key,r);this.dirty.set(key,r);return body;}
 list(owner,kind){return [...this.rows.values()].filter(r=>r.owner===owner&&r.kind===kind).map(r=>structuredClone(r.body));}
 remove(owner,kind,id){const key=this.key(owner,kind,id);this.rows.delete(key);this.dirty.set(key,{owner,kind,id,removed:true});}
 clearKinds(owner,kinds){const selected=new Set(kinds);let removed=0;for(const [key,row] of this.rows)if(row.owner===owner&&selected.has(row.kind)){this.rows.delete(key);this.dirty.delete(key);removed++;}this.bulkClears.set(owner,new Set([...(this.bulkClears.get(owner)||[]),...kinds]));return removed;}
 allTracks(){return [...this.rows.values()].filter(r=>r.kind==='track').map(r=>({owner:r.owner,track:structuredClone(r.body)}));}
 allSignups(){return [...this.rows.values()].filter(r=>r.kind==='signup').map(r=>({owner:r.owner,record:structuredClone(r.body)}));}
 pendingEmailOwners(){return [...new Set([...this.rows.values()].filter(r=>r.kind==='delivery'&&r.body.channel==='email'&&['queued','retry','sending'].includes(r.body.status)).map(r=>r.owner))];}
 transaction(fn){const previous=new Map(this.rows),dirty=new Map(this.dirty),bulkClears=new Map(this.bulkClears);try{return fn();}catch(error){this.rows=previous;this.dirty=dirty;this.bulkClears=bulkClears;throw error;}}
 close(){}
 async queryRows(sql, params) {
   const {rows}=await this.client.query(sql,params);
   this.recordRead(rows);
   for(const row of rows){
     const key=this.key(row.owner,row.kind,row.id);
     const previous=this.rows.get(key);
     if(!this.dirty.has(key)&&!this.bulkClears.get(row.owner)?.has(row.kind)&&
        !(previous?.body.sealed&&!row.body.sealed))this.rows.set(key,row);
   }
   return rows;
 }
 async load(owner,...scopes) {
   if(!scopes.length)return [];
   const values=[];
   const bind=value=>{values.push(value);return '$'+values.length;};
   const ownerParam=owner===null?null:bind(owner);
   const parts=scopes.map(scope=>{
     const {kind,id,trackId,filter,projection,changeIds,signupId,accountOwner,excludeIds}=typeof scope==='string'?{kind:scope}:scope;
     const condition=['kind='+bind(kind)];
     if(ownerParam)condition.push('owner='+ownerParam);
     if(excludeIds?.length)condition.push('NOT (id=ANY('+bind(excludeIds)+'::text[]))');
     if(id!==undefined)condition.push('id=ANY('+bind(Array.isArray(id)?id:[id])+'::text[])');
     if(filter==='trackDelivery')condition.push("(body->>'trackId'="+bind(trackId)+" OR body->>'changeId'=ANY("+bind(changeIds)+"::text[]))");
     else if(trackId!==undefined)condition.push("body->>'trackId' = ANY("+bind(Array.isArray(trackId)?trackId:[trackId])+"::text[])");
     if(signupId!==undefined)condition.push("body->>'signupId'="+bind(signupId));
     if(accountOwner!==undefined)condition.push("body->>'owner'="+bind(accountOwner));
     if(filter==='pending')condition.push("body->>'status' IN ('queued','retry','sending')");
     if(filter==='expired')condition.push("jsonb_typeof(body->'expires')='number'","body->'expires' <= to_jsonb("+bind(Date.now())+"::bigint)");
     if(filter==='armed')condition.push("body->>'status'='Armed'");
     if(filter==='active')condition.push("body->>'status' IS DISTINCT FROM 'Deleted'");
     if(filter==='confirmed')condition.push("body->>'status'='Confirmed'");
     if(filter==='browser')condition.push("body->>'channel'='browser'","body->>'status'='queued'");
     if(filter==='email')condition.push("body->>'channel'='email'","body->>'status' IN ('queued','retry','sending')","body->'nextTry' <= to_jsonb("+bind(Date.now())+"::bigint)");
     let body='body';
     if(projection==='idOnly')body="jsonb_build_object('id',id)";
     if(projection==='changeIds')body="jsonb_build_object('id',id,'trackId',body->'trackId','at',body->'at')";
     if(projection==='signupTrack')body=`jsonb_build_object('id',id,'title',body->'title','url',body->'url','milestones',
       COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m->'id','label',m->'label','date',m->'date','time',m->'time','zone',m->'zone'))
       FROM jsonb_array_elements(body->'milestones') AS item(m)), '[]'::jsonb))`;
     if(projection==='fileQuota')body="jsonb_build_object('id',id,'expires',body->'expires','size',body->'size')";
     if(projection==='metadata')body="body - 'sealed' - 'payload' - 'sealedRegistration'";
     if(projection==='signupSummary')body="CASE WHEN body ? 'summary' THEN body - 'sealed' ELSE body END";
     if(projection==='sourceLatest')body=`jsonb_build_object('sources', COALESCE((SELECT jsonb_agg((source - 'history') ||
       jsonb_build_object('history', CASE WHEN source->'history'->0 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(source->'history'->0) END))
       FROM jsonb_array_elements(body->'sources') AS s(source)), '[]'::jsonb))`;
     if(projection==='applicationSummary')body=`jsonb_build_object('priority',body->'priority','tasks',body->'tasks',
       'checklist',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',item->'label','done',item->'done','required',item->'required'))
       FROM jsonb_array_elements(body->'checklist') AS c(item)), '[]'::jsonb))`;
     if(projection==='intelligenceSummary')body="body - 'sources'";
     return 'SELECT owner,kind,id,'+body+' AS body FROM public.deadline_scout_records WHERE '+condition.join(' AND ');
   });
   return this.queryRows(parts.join(' UNION ALL '),values);
 }
 async workspaceChanges(owner){
   const {rows}=await this.client.query(`WITH active_changes AS (
       SELECT entry.id,entry.body FROM public.deadline_scout_records AS entry
       JOIN public.deadline_scout_records AS track ON track.owner=entry.owner AND track.kind='track' AND track.id=entry.body->>'trackId'
       WHERE entry.owner=$1 AND entry.kind='change'
     ), latest AS (
       SELECT DISTINCT ON (body->>'trackId') id FROM active_changes ORDER BY body->>'trackId',body->>'at' DESC,id DESC
     ), unseen AS (
       SELECT id FROM active_changes
       WHERE NOT COALESCE((SELECT body->'seenChangeIds' FROM public.deadline_scout_records
                          WHERE owner=$1 AND kind='dashboard' AND id='preferences') ? id,false)
       ORDER BY body->>'at' DESC,id DESC LIMIT 12
     )
     SELECT id,body FROM active_changes WHERE id IN (SELECT id FROM latest UNION SELECT id FROM unseen)
     ORDER BY body->>'at' DESC,id DESC`,[owner]);
   this.recordRead(rows);
   return rows.map(row=>row.body);
 }
 async changePage(owner,after,limit){
   const {rows}=await this.client.query(`SELECT entry.id,entry.body FROM public.deadline_scout_records AS entry
     JOIN public.deadline_scout_records AS track
       ON track.owner=entry.owner AND track.kind='track' AND track.id=entry.body->>'trackId'
     WHERE entry.owner=$1 AND entry.kind='change'
       AND ($2::text IS NULL OR (COALESCE(entry.body->>'at','') COLLATE "C",entry.id COLLATE "C") < ($2::text,$3::text))
     ORDER BY COALESCE(entry.body->>'at','') COLLATE "C" DESC,entry.id COLLATE "C" DESC LIMIT $4`,
     [owner,after?.at??null,after?.id??null,limit+1]);
   this.recordRead(rows);
   return rows.map(row=>row.body);
 }
 async emailPage(owner,after,limit){
   const {rows}=await this.client.query(`SELECT owner,kind,id,
     jsonb_build_object('id',id,'subject',body->'subject','to',body->'to','status',body->'status',
       'label',body->'label','error',body->'error','at',body->'at','text',CASE WHEN body->>'status'='demo' THEN body->'text' END) AS body
     FROM public.deadline_scout_records WHERE owner=$1 AND kind='delivery' AND body->>'channel' IS DISTINCT FROM 'browser'
       AND ($2::text IS NULL OR (COALESCE(body->>'at','') COLLATE "C",id COLLATE "C") < ($2::text,$3::text))
     ORDER BY COALESCE(body->>'at','') COLLATE "C" DESC,id COLLATE "C" DESC LIMIT $4`,
     [owner,after?.at??null,after?.id??null,limit+1]);
   this.recordRead(rows);
   return rows.map(row=>row.body);
 }
 recordRead(rows){
   this.readStats.queries++;
   this.readStats.rows+=rows.length;
   if(this.diagnostics)for(const row of rows)this.readStats.bytes+=Buffer.byteLength(JSON.stringify(row));
 }
 async loadBrowserAlerts(owner){
   const deliveries=await this.load(owner,{kind:'delivery',filter:'browser'});
   if(!deliveries.length)return;
   const ids=key=>[...new Set(deliveries.map(row=>row.body[key]).filter(Boolean))];
   const changes=await this.load(owner,{kind:'change',id:ids('changeId')},{kind:'signup',id:ids('signupId'),projection:'metadata'});
   const tracks=[...ids('trackId'),...changes.filter(row=>row.kind==='change').map(row=>row.body.trackId).filter(Boolean)];
   await this.load(owner,{kind:'track',id:[...new Set(tracks)],projection:'idOnly'});
 }
 async loadDeliveries(owner){
   const existing=this.list(owner,'delivery').filter(row=>row.channel==='email'&&['queued','retry','sending'].includes(row.status)&&row.nextTry<=Date.now());
   const deliveries=[...existing.map(body=>({body})),...await this.load(owner,{kind:'delivery',filter:'email',excludeIds:existing.map(row=>row.id)})];
   const ids=key=>[...new Set(deliveries.map(row=>row.body[key]).filter(Boolean))];
   const changes=ids('changeId'),signups=ids('signupId'),tracks=ids('trackId');
   if(deliveries.length)await this.load(owner,
     ...(!this.rows.has(this.key(owner,'profile','me'))?[{kind:'profile',id:'me'}]:[]),
     {kind:'change',id:changes.filter(id=>!this.rows.has(this.key(owner,'change',id))),projection:'changeIds'},
     {kind:'signup',id:signups,projection:'metadata'});
   // Older delivery records can reference the track through a change only.
   for(const id of changes){const change=this.get(owner,'change',id);if(change?.trackId)tracks.push(change.trackId);}
   const missingTracks=[...new Set(tracks)].filter(id=>!this.rows.has(this.key(owner,'track',id)));
   if(missingTracks.length)await this.load(owner,{kind:'track',id:missingTracks,projection:'idOnly'});
 }
 async scheduledChecks(){
   const {rows}=await this.client.query(`SELECT owner,id FROM public.deadline_scout_records
      WHERE kind='track' AND jsonb_typeof(body->'nextCheck')='number' AND body->'nextCheck' <= to_jsonb($1::bigint)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(body->'milestones') AS m(milestone)
          WHERE milestone->'manual' IS DISTINCT FROM 'true'::jsonb)`,[Date.now()]);
   this.recordRead(rows);
   return rows;
 }
 async loadScheduledCheck(owner,id){
   await this.load(owner,{kind:'track',id},{kind:'profile',id:'me'},{kind:'sourceHistory',id},
     {kind:'intelligence',id},{kind:'googleLink',trackId:id});
 }
 async scheduledSignups(){
   // A future backup still needs review if its source or approved milestone changed.
   // Drafts saved before schedule metadata was added follow the full legacy check.
   const {rows}=await this.client.query(`SELECT signup.owner,signup.id,signup.body->>'trackId' AS "trackId"
     FROM public.deadline_scout_records AS signup
     LEFT JOIN public.deadline_scout_records AS track
       ON track.owner=signup.owner AND track.kind='track' AND track.id=signup.body->>'trackId'
     WHERE signup.kind='signup' AND signup.body->>'status'='Armed'
       AND (track.id IS NULL OR signup.body->'schedule' IS NULL
         OR jsonb_typeof(signup.body->'backupAt') IS DISTINCT FROM 'number'
         OR signup.body->'backupAt' <= to_jsonb($1::bigint)
         OR track.body->>'status'='check_failed'
         OR track.body->'conflicts'->0 IS NOT NULL
         OR track.body->'uncertain'->0 IS NOT NULL
         OR track.body->'missing'->0 IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(track.body->'milestones') AS m(milestone)
           WHERE milestone->>'id'=signup.body->'schedule'->>'milestoneId'
             AND jsonb_build_array(milestone->'date',milestone->'time',milestone->'zone')=signup.body->'schedule'->'deadline'))`,[Date.now()]);
   this.recordRead(rows);
   return rows;
 }
 async scheduledEmailOwners(){
   const {rows}=await this.client.query(`SELECT DISTINCT owner FROM public.deadline_scout_records WHERE kind='delivery'
     AND body->>'channel'='email' AND body->>'status' IN ('queued','retry','sending') AND body->'nextTry' <= to_jsonb($1::bigint)`,[Date.now()]);
   this.recordRead(rows);
   return rows.map(row=>row.owner);
 }
 async releaseBatch(){
   // Persist into the existing outer transaction before releasing this batch's objects.
   await this.flush();
   this.rows.clear();
   this.dirty.clear();
   this.bulkClears.clear();
 }
 async flush(){for(const [owner,kinds] of this.bulkClears)await this.client.query('DELETE FROM public.deadline_scout_records WHERE owner=$1 AND kind=ANY($2::text[])',[owner,[...kinds]]);for(const r of this.dirty.values())if(r.removed)await this.client.query('DELETE FROM public.deadline_scout_records WHERE owner=$1 AND kind=$2 AND id=$3',[r.owner,r.kind,r.id]);else await this.client.query('INSERT INTO public.deadline_scout_records(owner,kind,id,body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(owner,kind,id) DO UPDATE SET body=EXCLUDED.body',[r.owner,r.kind,r.id,JSON.stringify(r.body)]);}
 static async open(client,{readOnly=false,initialize=true,diagnostics=false}={}){await client.query('BEGIN');if(readOnly){await client.query('SET TRANSACTION READ ONLY');await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');}await client.query("SET LOCAL lock_timeout = '30s'");await client.query("SET LOCAL idle_in_transaction_session_timeout = '180s'");if(!readOnly)await client.query('SELECT pg_advisory_xact_lock(43174317)');if(initialize){await client.query('CREATE TABLE IF NOT EXISTS public.deadline_scout_records(owner text NOT NULL,kind text NOT NULL,id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(owner,kind,id))');await client.query('ALTER TABLE public.deadline_scout_records ENABLE ROW LEVEL SECURITY');}const store=new CloudStore(client,[]);store.diagnostics=diagnostics;return store;}
}
