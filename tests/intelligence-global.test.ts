// Synthetic fixtures only: no real manufacturer evidence or real inventory asserted.
import test from 'node:test';import assert from 'node:assert/strict';
import '../server/src/intelligence/global-catalog.ts';
import {boot} from './helpers.ts';import {Plan} from '../server/src/intelligence/contracts.ts';import {readProduct} from '../server/src/intelligence/tools.ts';
const sample={name:'منتج عالمي اصطناعي',brand:'SYNTHETIC',ingredients:'Aqua, Glycerin',source_url:'https://example.test/synthetic'};
test('global catalogue: manager writes; drafts/rejections never retrieved, no financial fields or unsafe source URLs',async()=>{const t=await boot();try{
 assert.equal((await t.call('GET','/api/intelligence/global-products')).status,401);
 assert.equal((await t.call('POST','/api/intelligence/global-products',{token:t.staff,body:sample})).status,403);
 assert.equal((await t.call('POST','/api/intelligence/global-products',{body:sample})).status,401);
 for(const body of [{...sample,price:2},{...sample,source_url:'http://example.test'},{...sample,source_url:'https://user:secret@example.test'},{...sample,ingredients:'',review_status:'reviewed'}])assert.equal((await t.call('POST','/api/intelligence/global-products',{token:t.manager,body})).status,400);
 const draft=await t.call('POST','/api/intelligence/global-products',{token:t.manager,body:sample});assert.equal(draft.status,200);assert.equal(draft.json.review_status,'draft');
 assert.equal((await t.call('POST','/api/intelligence/global-products',{token:t.manager,body:{...sample,review_status:'rejected'}})).status,200);
 const r=await t.call('GET','/api/intelligence/global-products',{token:t.staff});assert.deepEqual(r.json.items,[]);
 assert.equal(readProduct(t.db,-draft.json.id,Plan.parse({intent:'consultation'}),'ترطيب'),null);
 assert.equal((await t.call('GET','/api/intelligence/global-products?limit=101',{token:t.manager})).status,400);
 }finally{await t.close();}});
test('reviewed global source stays manufacturer information and never claims local availability',async()=>{const t=await boot();try{
 const r=await t.call('POST','/api/intelligence/global-products',{token:t.manager,body:{...sample,review_status:'reviewed'}});assert.equal(r.status,200);assert.equal(r.json.availability,'unknown');
 const rows=(await t.call('GET','/api/intelligence/global-products',{token:t.staff})).json.items;assert.equal(rows.length,1);assert.equal(rows[0].evidence_kind,'manufacturer_information');assert.ok(rows[0].reviewed_by);assert.ok(rows[0].verified_at);assert.equal(rows[0].availability,'unknown');
 const p=readProduct(t.db,-r.json.id,Plan.parse({intent:'consultation'}),'ترطيب');assert.equal(p?.scope,'global');assert.equal(p?.availability,'unknown');assert.equal(p?.id,-r.json.id);
 const logs=t.db.prepare("SELECT * FROM audit_log WHERE action='global_product_create'").all();assert.equal(logs.length,1);
 }finally{await t.close();}});
test('global catalogue create rolls back when audit fails',async()=>{const t=await boot();try{
 t.db.exec("CREATE TRIGGER fail_global_audit BEFORE INSERT ON audit_log WHEN NEW.action='global_product_create' BEGIN SELECT RAISE(ABORT,'synthetic global audit failure'); END;");
 assert.equal((await t.call('POST','/api/intelligence/global-products',{token:t.manager,body:sample})).status,500);
 assert.equal((t.db.prepare('SELECT COUNT(*) n FROM global_products').get() as {n:number}).n,0);
 }finally{await t.close();}});
