import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
// Owner is part of every key. No API query can omit its authenticated owner.
export class Store {
  constructor(path) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,kind,id));');
  }
  get(owner,kind,id) { const r=this.db.prepare('SELECT body FROM records WHERE owner=? AND kind=? AND id=?').get(owner,kind,id);return r?JSON.parse(r.body):null; }
  put(owner,kind,id,body) { this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(owner,kind,id) DO UPDATE SET body=excluded.body').run(owner,kind,id,JSON.stringify(body));return body; }
  list(owner,kind) {return this.db.prepare('SELECT body FROM records WHERE owner=? AND kind=?').all(owner,kind).map(r=>JSON.parse(r.body));}
  remove(owner,kind,id) { this.db.prepare('DELETE FROM records WHERE owner=? AND kind=? AND id=?').run(owner,kind,id); }
  clearKinds(owner,kinds){let removed=0;const q=this.db.prepare('DELETE FROM records WHERE owner=? AND kind=?');for(const kind of kinds)removed+=Number(q.run(owner,kind).changes);return removed;}
  allTracks() {return this.db.prepare("SELECT owner,body FROM records WHERE kind='track'").all().map(r=>({owner:r.owner,track:JSON.parse(r.body)}));}
  allSignups(){return this.db.prepare("SELECT owner,body FROM records WHERE kind='signup'").all().map(r=>({owner:r.owner,record:JSON.parse(r.body)}));}
  pendingEmailOwners(){return this.db.prepare("SELECT DISTINCT owner FROM records WHERE kind='delivery' AND json_extract(body,'$.channel')='email' AND json_extract(body,'$.status') IN ('queued','retry','sending')").all().map(r=>r.owner);}
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  close(){this.db.close();}
}
