import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {beginAlertConnection,handleAlertConnection} from '../extension/shared/alert-connection.js';
const id='nicbdenkpmljnljbicmjajhimpbkdgdf',backend='https://deadline-scout.vercel.app';
function fixture(){const values=new Map(),events=[];return {values,events,storage:{get:async k=>values.get(k),set:async(k,v)=>{values.set(k,v);}},browser:{runtime:{id},permissions:{request:async()=>{events.push('permission');return true;},contains:async()=>true},notifications:{getPermissionLevel:async()=> 'granted',create:async()=>events.push('notification')},alarms:{create:async()=>events.push('alarm')}}};}
test('alert setup requests permission first and opens the existing website with a PKCE challenge, never a session token',async()=>{
 const f=fixture();f.values.set('token','existing-extension-secret');const url=new URL(await beginAlertConnection(f.browser,f.storage,async()=>{f.events.push('settings');return backend;}));
 assert.deepEqual(f.events,['permission','settings']);assert.equal(url.origin,backend);assert.equal(url.pathname,'/');const args=new URLSearchParams(url.hash.slice(1)),pending=f.values.get('alertConnection');assert.equal(args.get('alerts-setup'),id);assert.equal(args.get('challenge'),pending.challenge);assert.equal(args.get('state'),pending.state);assert.ok(!url.href.includes(pending.verifier));assert.ok(!url.href.includes('existing-extension-secret'));
});
test('only the pending trusted website flow can redeem and store an alert session',async()=>{
 const f=fixture();await beginAlertConnection(f.browser,f.storage,backend);const pending=f.values.get('alertConnection');const dependencies={...f,backend,api:async(path,method,body)=>{assert.equal(path,'/api/auth/redeem');assert.equal(body.verifier,pending.verifier);assert.equal(body.extensionId,id);return {token:'alert-only-session',email:'owner@example.org'};}};
 const message={type:'scout-alerts-connect',state:pending.state,challenge:pending.challenge,code:'a'.repeat(43)};
 await assert.rejects(handleAlertConnection(message,{url:'https://evil.example/'},dependencies),/Only your Deadline/);
 await assert.rejects(handleAlertConnection({...message,state:'b'.repeat(43)},{url:backend+'/'},dependencies),/expired/);assert.equal(f.values.get('token'),undefined);
 const result=await handleAlertConnection(message,{url:backend+'/'},dependencies);assert.equal(result.connected,true);assert.equal(result.email,'owner@example.org');assert.equal(f.values.get('token'),'alert-only-session');assert.equal(f.values.get('alertConnection'),null);assert.ok(f.events.includes('alarm'));
 await assert.rejects(handleAlertConnection(message,{url:backend+'/'},dependencies),/expired/);
});
test('denied permissions never open an alert connection or request credentials',async()=>{
 const f=fixture();f.browser.permissions.request=async()=>false;await assert.rejects(beginAlertConnection(f.browser,f.storage,backend),/Allow notifications/);assert.equal(f.values.size,0);
});

test('legacy extension dashboard URLs redirect to the hosted website instead of opening another app',async()=>{
 const source=readFileSync(new URL('../extension/panel.js',import.meta.url),'utf8').replace(/^import[^\n]+/,"const isExtension=true,settings=async()=>({backendUrl:'https://deadline-scout.vercel.app'});");
 let destination;await new (Object.getPrototypeOf(async function(){}).constructor)('location',source)({hash:'#settings',replace:url=>{destination=url;}});assert.equal(destination,'https://deadline-scout.vercel.app/dashboard#settings');
});
