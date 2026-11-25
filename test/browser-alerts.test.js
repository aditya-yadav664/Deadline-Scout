import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverBrowserAlerts,enableExtensionAlerts} from '../extension/shared/browser-alerts.js';
test('browser alerts acknowledge only notifications accepted by the browser',async()=>{
 const events=[];const shown=await deliverBrowserAlerts({load:async()=>[{id:'one',change:{}},{id:'missing'},{id:'two',change:{}}],notify:async a=>events.push('show:'+a.id),ack:async id=>events.push('ack:'+id)});
 assert.equal(shown,2);assert.deepEqual(events,['show:one','ack:one','show:two','ack:two']);
});
test('blocked or failed notifications remain queued for retry',async()=>{
 let acked=false;await assert.rejects(deliverBrowserAlerts({load:async()=>[{id:'one',change:{}}],notify:async()=>{throw Error('permission denied');},ack:async()=>{acked=true;}}),/permission denied/);assert.equal(acked,false);
});

test('extension alert setup repairs an expired session before starting its background alarm',async()=>{
 const events=[];let signedIn=false;const browser={permissions:{request:async()=>{events.push('permission');return true;}},notifications:{getPermissionLevel:async()=> 'granted'},alarms:{create:async()=>events.push('alarm')}};
 await enableExtensionAlerts({browser,validateSession:async()=>{events.push('validate');if(!signedIn)throw Object.assign(Error('expired'),{status:401});},signIn:async()=>{events.push('sign-in');signedIn=true;}});
 assert.deepEqual(events,['permission','validate','sign-in','validate','alarm']);
});
test('extension setup never starts polling when permission is refused',async()=>{
 let validated=false;await assert.rejects(enableExtensionAlerts({browser:{permissions:{request:async()=>false}},validateSession:async()=>{validated=true;},signIn:async()=>{}}),/not allowed/);assert.equal(validated,false);
});
