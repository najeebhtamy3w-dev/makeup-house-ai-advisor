/** Synthetic verified ingredient fixtures; governance only, not clinical/model acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './helpers.ts';
import {Plan} from '../server/src/intelligence/contracts.ts';
import {readProduct} from '../server/src/intelligence/tools.ts';
async function add(t:Awaited<ReturnType<typeof boot>>,ingredients:string,verification:'verified'|'partial'='verified'){
 const r=await t.call('POST','/api/products',{token:t.manager,body:{name:'SYNTHETIC constraint fixture',ingredients,verification,source_url:'https://example.test/constraint-fixture'}});assert.equal(r.status,200);return r.json.id as number;
}
const alcohol=Plan.parse({intent:'compare',constraints:['alcohol_free']});
const oil=Plan.parse({intent:'compare',constraints:['oil_free']});

test('independent alcohol constraint excludes documented ethanol aliases, not an unrestricted suitable product',async()=>{const t=await boot();try{
 for(const entry of ['Alcohol','Ethanol','Ethyl Alcohol','Alcohol Denat.','SD Alcohol 40-B']){
  const id=await add(t,'Aqua, Glycerin, '+entry);const p=readProduct(t.db,id,alcohol,'قارن المنتجين');assert.equal(p?.suitability,'excluded',entry);assert.match(p!.reasons.join(' '),/إيثانول|إيثيلي/);
 }
}finally{await t.close();}});

test('fatty alcohols are not ethanol; absence statement is limited to verified INCI and explicit interpretation',async()=>{const t=await boot();try{
 for(const entry of ['Cetyl Alcohol','Cetearyl Alcohol','Stearyl Alcohol']){
  const id=await add(t,'Aqua, Glycerin, '+entry);const p=readProduct(t.db,id,alcohol,'قارن المنتجين');assert.ok(p);assert.notEqual(p.suitability,'excluded',entry);assert.notEqual(p.suitability,'insufficient',entry);assert.match(p.reasons.join(' '),/إيثانول|إيثيلي/);assert.match(p.precautions.join(' '),/دهني|الدهنية/);
 }
}finally{await t.close();}});

test('partial, conflicted or visibly incomplete INCI cannot establish alcohol absence',async()=>{const t=await boot();try{
 for(const ingredients of ['Aqua, Glycerin, ...','Aqua, Glycerin, other ingredients','Aqua, Glycerin, proprietary blend']){
  const id=await add(t,ingredients);const p=readProduct(t.db,id,alcohol,'قارن المنتجين');assert.equal(p?.suitability,'insufficient',ingredients);assert.doesNotMatch(p!.reasons.join(' '),/لا يظهر.*إيثانول/);
 }
 const partial=await add(t,'Aqua, Glycerin','partial');assert.equal(readProduct(t.db,partial,alcohol,'قارن المنتجين'),null);
 const id=await add(t,'Aqua, Glycerin');const run=t.db.prepare("INSERT INTO enrichment_runs(barcode,connector,outcome,fetched_at) VALUES ('','fixture','found','x')").run();t.db.prepare("INSERT INTO enrichment_candidates(run_id,barcode,field,value,source_name,extracted_at,conflict_note) VALUES (?,'','ingredients','conflicting fixture','fixture','x','source mismatch')").run(run.lastInsertRowid);assert.equal(readProduct(t.db,id,alcohol,'قارن المنتجين')?.suitability,'insufficient');
}finally{await t.close();}});

test('generic oil_free is unresolved rather than inventing a mineral/essential/all-oil meaning',async()=>{const t=await boot();try{
 for(const ingredients of ['Aqua, Glycerin','Aqua, Glycerin, Paraffinum Liquidum','Aqua, Glycerin, Olea Europaea Fruit Oil']){
  const id=await add(t,ingredients);const p=readProduct(t.db,id,oil,'قارن منتجًا بدون زيوت');assert.equal(p?.suitability,'insufficient');assert.match(p!.reasons.join(' '),/توضيح|المقصود|نطاق/);
 }
}finally{await t.close();}});

test('explicit mineral-oil scope excludes listed mineral oil but does not claim all oils absent',async()=>{const t=await boot();try{
 const id=await add(t,'Aqua, Glycerin, Paraffinum Liquidum');assert.equal(readProduct(t.db,id,oil,'لا أريد زيوتًا معدنية فقط؛ قارن المنتجين')?.suitability,'excluded');
 const fatty=await add(t,'Aqua, Glycerin, Cetearyl Alcohol');const p=readProduct(t.db,fatty,oil,'بدون زيوت معدنية فقط');assert.ok(p);assert.notEqual(p.suitability,'excluded');assert.match(p.reasons.join(' '),/معدني/);assert.doesNotMatch(p.reasons.join(' '),/خال.*كل الزيوت|لا.*زيوت عطرية/);
}finally{await t.close();}});

test('fragrance and essential-oil exclusions stay effective alongside unresolved free constraints',async()=>{const t=await boot();try{
 for(const [ingredient,constraint] of [['Parfum','fragrance_free'],['Lavandula Angustifolia Oil','no_essential_oil']] as const){
  const id=await add(t,'Aqua, Glycerin, '+ingredient);const plan=Plan.parse({intent:'compare',constraints:['oil_free','alcohol_free',constraint]});assert.equal(readProduct(t.db,id,plan,'قارن المنتجين')?.suitability,'excluded');
 }
}finally{await t.close();}});
