// Synthetic product/image fixtures: governance, persistence and integration, NOT visual/OCR/model acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {boot,EAN,EAN2} from './helpers.ts';
import {openDb} from '../server/src/db.ts';
import {insertImage,validateImage} from '../server/src/images.ts';
import {getStoredProductImages,resolveBarcodeIdentity,buildProductAttachmentDraft,saveConfirmedProductAttachmentDraft,inspectProductImage} from '../server/src/intelligence/product-attachments.ts';
const draft={name:'منتج اصطناعي اختبار صور',brand:'SYNTHETIC',barcode:EAN,ingredients:'Aqua, Glycerin',origin:'package_transcription'};
// Header-only byte fixture exercises the existing metadata validator, not a decoded photo.
const image=()=>{const b=Buffer.alloc(32);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.writeUInt32BE(2,16);b.writeUInt32BE(2,20);return b;};

test('attachment intake validates bytes and explicitly does not claim OCR, vision or barcode recognition',()=>{
 const r=inspectProductImage(image());assert.equal(r.mime,'image/png');assert.equal(r.width,2);assert.equal(r.capabilities.ocr,false);assert.equal(r.capabilities.visual_understanding,false);assert.equal(r.capabilities.barcode_decoded,false);
 assert.throws(()=>inspectProductImage(Buffer.from('<svg onload=bad>')),/نوع الملف/);
 assert.throws(()=>inspectProductImage(new Uint8Array(2*1024*1024+1)),/حجم الصورة/);
});

test('draft preview never saves data or invents missing fields; strict finance/approval/source restrictions',async()=>{
 const t=await boot();try{
 const r=await t.call('POST','/api/intelligence/product-drafts/preview',{token:t.staff,body:draft});assert.equal(r.status,200);assert.equal(r.json.verification,'review');assert.equal(r.json.availability,'unknown');assert.equal(r.json.requires_confirmation,true);assert.ok(r.json.missing_information.includes('source'));
 assert.equal((t.db.prepare('SELECT count(*) n FROM products').get() as {n:number}).n,0);
 for(const extra of [{price:2},{verification:'verified'},{availability:'yes'},{concentration:5},{source_url:'https://user:secret@example.test'}])assert.equal((await t.call('POST','/api/intelligence/product-drafts/preview',{token:t.manager,body:{...draft,...extra}})).status,400);
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/preview',{body:draft})).status,401);
 }finally{await t.close();}
});

test('save requires manager confirmation; review-only record/audit; repeat and barcode aliases prevent duplicates',async()=>{
 const t=await boot();try{
 const body={confirmed:true,client_ref:'image-draft-synthetic-001',draft};
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.staff,body})).status,403);
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body:{...body,confirmed:false}})).status,400);
 const r=await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body});assert.equal(r.status,200);const id=r.json.id;
 const p=(await t.call('GET','/api/products/'+id,{token:t.staff})).json.product;assert.equal(p.verification,'review');assert.equal(p.availability_effective,'unknown');assert.equal(p.ingredients,draft.ingredients);
 const repeat=await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body});assert.equal(repeat.status,200);assert.equal(repeat.json.id,id);assert.equal(repeat.json.duplicate_request,true);
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body:{...body,client_ref:'another-reference-002'}})).status,409);
 assert.equal((await t.call('POST',`/api/products/${id}/codes`,{token:t.staff,body:{code:EAN2,kind:'gtin'}})).status,200);
 const alias=resolveBarcodeIdentity(t.db,EAN2);assert.equal(alias.found,true);assert.equal(alias.matches[0]?.id,id);assert.equal(alias.authenticity,'not_assessed');assert.equal(alias.matches[0]?.availability,'unknown');
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body:{...body,client_ref:'alias-reference-003',draft:{...draft,barcode:EAN2}}})).status,409);
 assert.equal((t.db.prepare("SELECT count(*) n FROM audit_log WHERE action='confirmed_attachment_draft'").get() as {n:number}).n,1);
 }finally{await t.close();}
});

test('confirmed draft audit failure rolls back product creation',async()=>{
 const t=await boot();try{
 t.db.exec("CREATE TRIGGER fail_attachment_audit BEFORE INSERT ON audit_log WHEN NEW.action='confirmed_attachment_draft' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body:{confirmed:true,client_ref:'rollback-fixture-001',draft}})).status,500);
 assert.equal((t.db.prepare('SELECT count(*) n FROM products').get() as {n:number}).n,0);
 }finally{await t.close();}
});

test('stored image lookup returns actual images and protected URLs, global/draft/archived identities kept separate',async()=>{
 const t=await boot();try{
 const id=(await t.call('POST','/api/products',{token:t.manager,body:{name:'صورة اختبار اصطناعي',barcode:EAN}})).json.id;
 const up=await t.call('POST',`/api/products/${id}/images?kind=front&origin=camera`,{token:t.staff,raw:image()});assert.equal(up.status,200);
 const r=await t.call('GET',`/api/intelligence/products/${id}/images`,{token:t.staff});assert.equal(r.status,200);assert.equal(r.json.images.length,1);assert.equal(r.json.images[0].id,up.json.id);assert.equal(r.json.images[0].origin,'camera');assert.equal(r.json.images[0].url,`/api/images/${up.json.id}`);assert.ok(!('bytes' in r.json.images[0]));
 assert.equal((await t.call('GET',r.json.images[0].url)).status,401);assert.equal((await t.call('GET',r.json.images[0].thumbnail_url,{token:t.staff})).status,200);
 assert.equal((await t.call('GET',`/api/intelligence/products/${id}/images`)).status,401);
 const g=Number(t.db.prepare("INSERT INTO global_products(name,source_url,review_status) VALUES ('عالمي اصطناعي','https://example.test/source','reviewed')").run().lastInsertRowid);
 const global=getStoredProductImages(t.db,-g);assert.equal(global.scope,'global');assert.deepEqual(global.images,[]);assert.equal(global.status,'not_stored');
 t.db.prepare("UPDATE products SET record_status='archived' WHERE id=?").run(id);assert.equal(resolveBarcodeIdentity(t.db,EAN).found,false);assert.throws(()=>getStoredProductImages(t.db,id),/غير موجود/);
 assert.equal((await t.call('POST','/api/intelligence/product-drafts/confirm',{token:t.manager,body:{confirmed:true,client_ref:'archived-code-test-001',draft}})).status,409);
 }finally{await t.close();}
});

test('product/image memory persists after DB close and reopen; no model-specific tables required',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mh-image-memory-')),path=join(dir,'memory.sqlite');let db=openDb(path);
 try{
 db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (1,'fixture','synthetic','manager','fixture-not-password',?)").run(new Date().toISOString());
 const user={id:1,username:'fixture',display_name:'synthetic',role:'manager' as const};const saved=saveConfirmedProductAttachmentDraft(db,user,{confirmed:true,client_ref:'persistent-image-draft-001',draft});
 const bytes=image();const imageId=insertImage(db,{productId:saved.id,kind:'front',bytes,info:validateImage(bytes),origin:'camera',userId:1});
 db.close();db=openDb(path);assert.equal(resolveBarcodeIdentity(db,EAN).matches[0]?.id,saved.id);const restored=getStoredProductImages(db,saved.id);assert.equal(restored.status,'stored');assert.equal(restored.images[0]?.id,imageId);assert.deepEqual(new Uint8Array((db.prepare('SELECT bytes FROM product_images WHERE id=?').get(imageId) as {bytes:Uint8Array}).bytes),new Uint8Array(bytes));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
