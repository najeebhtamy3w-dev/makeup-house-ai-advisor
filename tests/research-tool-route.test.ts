/** Actual authenticated route boundaries, not a scientific synthesis quality test. */
import test from 'node:test';import assert from'node:assert/strict';import {boot} from './helpers.ts';
test('multi-source research route requires auth, respects disabled consent and never upgrades metadata to science',async()=>{const t=await boot();try{
 assert.equal((await t.call('POST','/api/intelligence/research',{body:{concepts:['niacinamide']}})).status,401);
 const r=await t.call('POST','/api/intelligence/research',{token:t.staff,body:{concepts:['niacinamide']}});assert.equal(r.status,200);assert.equal(r.json.status,'disabled');assert.equal(r.json.requests,0);assert.equal(r.json.used_in_scientific_answer,false);assert.deepEqual(r.json.claims,[]);assert.deepEqual(r.json.scientific_conclusions,[]);
 assert.equal((await t.call('POST','/api/intelligence/research',{token:t.staff,body:{concepts:['niacinamide'],price:100}})).status,400);
 const free=await t.call('POST','/api/intelligence/research',{token:t.staff,body:{concepts:['اسمي شخص person@example.test وأعاني من مشكلة']}});assert.equal(free.json.requests,0);assert.equal(free.json.publications.length,0);
 }finally{await t.close();}});
