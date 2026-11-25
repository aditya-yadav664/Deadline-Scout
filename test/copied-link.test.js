import test from 'node:test';
import assert from 'node:assert/strict';
import {copiedLinkReviewUrl} from '../extension/shared/copied-link.js';
const base='https://deadline-scout.vercel.app';
test('copied registration links preserve their query and fragment in the website review handoff',()=>{
 const source='https://events.example/register?event=a&day=2#schedule';
 const target=new URL(copiedLinkReviewUrl('  '+source+'\n',base));
 assert.equal(target.origin,base);
 assert.equal(new URLSearchParams(target.hash.slice(1)).get('inspect'),source);
});
test('empty, non-link, executable and credential-bearing clipboard values are rejected',()=>{
 for(const value of ['', 'hello there','javascript:alert(1)','file:///C:/private','https://user:pass@example.com/'])assert.throws(()=>copiedLinkReviewUrl(value,base));
});
