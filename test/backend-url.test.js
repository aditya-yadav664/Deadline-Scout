import test from 'node:test';
import assert from 'node:assert/strict';
import {backendOrigin} from '../extension/shared/backend-url.js';
test('dashboard uses a valid server origin and repairs invalid saved registration URLs',()=>{
 assert.equal(backendOrigin(undefined),'http://localhost:4317');
 assert.equal(backendOrigin('https://devnovate.co/event/whackiest'),'http://localhost:4317');
 assert.equal(backendOrigin('javascript:alert(1)'),'http://localhost:4317');
 assert.equal(backendOrigin('http://localhost:4317/'),'http://localhost:4317');
 assert.equal(backendOrigin('https://scout.example.org/'),'https://scout.example.org');
});
