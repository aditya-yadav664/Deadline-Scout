import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseOptions} from '../server/cloud-database.js';
test('Supabase database connections enforce the supplied CA and reject insecure URL options',()=>{
 const options=databaseOptions('postgres://test:placeholder@aws-0-test.pooler.supabase.com:6543/postgres?sslmode=disable');
 assert.equal(options.ssl.rejectUnauthorized,true);assert.match(options.ssl.ca,/BEGIN CERTIFICATE/);assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
 assert.throws(()=>databaseOptions('postgres://test:placeholder@untrusted.example/db'));
});
test('extension migrates the old localhost default once and clears its obsolete session',async t=>{
 const old=globalThis.chrome;t.after(()=>{globalThis.chrome=old;});
 const values={settings:{backendUrl:'http://localhost:4317'},token:'old-local-token'};
 globalThis.chrome={runtime:{id:'test-extension'},storage:{local:{get:async key=>({[key]:values[key]}),set:async updates=>Object.assign(values,updates)}}};
 const {settings}=await import('../extension/api.js?cloud-migration-test');
 assert.equal((await settings()).backendUrl,'https://deadline-scout.vercel.app');assert.equal(values.token,null);
 values.settings={backendUrl:'http://localhost:4317'};assert.equal((await settings()).backendUrl,'http://localhost:4317');
});
