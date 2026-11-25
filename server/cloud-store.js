// Synchronous store contract inside a Postgres transaction.
// The database lock serializes requests across Vercel instances, preventing lost updates.
export class CloudStore {
 constructor(client,rows){this.client=client;this.rows=new Map(rows.map(r=>[JSON.stringify([r.owner,r.kind,r.id]),r]));this.dirty=new Map();this.bulkClears=new Map();}
 key(owner,kind,id){return JSON.stringify([owner,kind,id]);}
 get(owner,kind,id){const r=this.rows.get(this.key(owner,kind,id));return r?structuredClone(r.body):null;}
 put(owner,kind,id,body){const key=this.key(owner,kind,id),r={owner,kind,id,body:structuredClone(body)};this.rows.set(key,r);this.dirty.set(key,r);return body;}
 list(owner,kind){return [...this.rows.values()].filter(r=>r.owner===owner&&r.kind===kind).map(r=>structuredClone(r.body));}
 remove(owner,kind,id){const key=this.key(owner,kind,id);this.rows.delete(key);this.dirty.set(key,{owner,kind,id,removed:true});}
 clearKinds(owner,kinds){const selected=new Set(kinds);let removed=0;for(const [key,row] of this.rows)if(row.owner===owner&&selected.has(row.kind)){this.rows.delete(key);this.dirty.delete(key);removed++;}this.bulkClears.set(owner,new Set([...(this.bulkClears.get(owner)||[]),...kinds]));return removed;}
 allTracks(){return [...this.rows.values()].filter(r=>r.kind==='track').map(r=>({owner:r.owner,track:structuredClone(r.body)}));}
 allSignups(){return [...this.rows.values()].filter(r=>r.kind==='signup').map(r=>({owner:r.owner,record:structuredClone(r.body)}));}
 pendingEmailOwners(){return [...new Set([...this.rows.values()].filter(r=>r.kind==='delivery'&&r.body.channel==='email'&&['queued','retry','sending'].includes(r.body.status)).map(r=>r.owner))];}
 transaction(fn){const previous=structuredClone(this.rows),dirty=structuredClone(this.dirty),bulkClears=structuredClone(this.bulkClears);try{return fn();}catch(error){this.rows=previous;this.dirty=dirty;this.bulkClears=bulkClears;throw error;}}
 close(){}
 async flush(){for(const [owner,kinds] of this.bulkClears)await this.client.query('DELETE FROM public.deadline_scout_records WHERE owner=$1 AND kind=ANY($2::text[])',[owner,[...kinds]]);for(const r of this.dirty.values())if(r.removed)await this.client.query('DELETE FROM public.deadline_scout_records WHERE owner=$1 AND kind=$2 AND id=$3',[r.owner,r.kind,r.id]);else await this.client.query('INSERT INTO public.deadline_scout_records(owner,kind,id,body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(owner,kind,id) DO UPDATE SET body=EXCLUDED.body',[r.owner,r.kind,r.id,JSON.stringify(r.body)]);}
 static async open(client,{readOnly=false,initialize=true}={}){await client.query('BEGIN');if(readOnly)await client.query('SET TRANSACTION READ ONLY');await client.query("SET LOCAL lock_timeout = '30s'");await client.query("SET LOCAL idle_in_transaction_session_timeout = '180s'");if(!readOnly)await client.query('SELECT pg_advisory_xact_lock(43174317)');if(initialize){await client.query('CREATE TABLE IF NOT EXISTS public.deadline_scout_records(owner text NOT NULL,kind text NOT NULL,id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(owner,kind,id))');await client.query('ALTER TABLE public.deadline_scout_records ENABLE ROW LEVEL SECURITY');}const {rows}=await client.query('SELECT owner,kind,id,body FROM public.deadline_scout_records');return new CloudStore(client,rows);}
}
