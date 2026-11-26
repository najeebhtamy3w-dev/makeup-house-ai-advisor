/** HOST-only real SQLite/WebCrypto continuity. All catalogue/customer rows are SYNTHETIC fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,statSync,openSync,readSync,writeSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrate,type DB} from '../server/src/db.ts';
import {seedKnowledge} from '../server/src/cp07/store.ts';
import {BackupWriterV2,BackupReaderV2,readHeaderV2,CHUNK_BYTES,seal,open as decryptLegacy,sha256hex} from '../mobile/src/backup.ts';
const AT='2026-11-26T00:00:00.000Z',PASS='synthetic-test-passphrase-only',COUNT=10000;
const migrations=new URL('../server/migrations/',import.meta.url);
function baseline(path:string){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
 for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')&&f<='009_cp06_3_image_thumbs.sql').sort()){
  db.exec(readFileSync(new URL(file,migrations),'utf8'));db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(file,AT);
 }
 db.prepare("INSERT INTO users(id,username,display_name,role,password_hash,created_at) VALUES (41,'fixture-manager','مدير اصطناعي','manager','test-only-hash',?)").run(AT);
 seedKnowledge(db);
 const product=db.prepare("INSERT INTO products(id,barcode,name,brand,ingredients,verification,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'verified',41,?,?)");
 const code=db.prepare("UPDATE product_codes SET kind='internal',verified=1 WHERE product_id=? AND code=?");
 db.exec('BEGIN');try{for(let id=1;id<=COUNT;id++){
  const barcode='SYNTH-'+String(id).padStart(8,'0');product.run(id,barcode,'منتج اصطناعي '+id,'SYNTHETIC - NOT REAL','Aqua, Glycerin, '+('Synthetic fixture data; not scientific evidence. '.repeat(8)),AT,AT);code.run(id,barcode);
 }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const image=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'));
 for(const id of [1,5000,10000])db.prepare("INSERT INTO product_images(id,product_id,mime,bytes,size,origin,created_by,created_at,thumb,thumb_mime) VALUES (?,?,'image/png',?,?,'upload',41,?,?,'image/png')").run(id,id,image,image.length,AT,image);
 db.prepare("INSERT INTO audit_log(id,user_id,action,entity,entity_id,detail,at) VALUES (901,41,'fixture','product','10000','synthetic preserved audit',?)").run(AT);
 db.prepare("INSERT INTO evidence(id,product_id,field,value,provider,retrieved_at,match_basis,confidence,fingerprint,created_at) VALUES (77,5000,'ingredients','Aqua, Glycerin','synthetic',?,'manual',0,'synthetic-only-77',?)").run(AT,AT);
 return db;
}
function digest(db:DB,tables:string[]){const out:Record<string,string>={};for(const table of tables){const h=createHash('sha256');for(const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate())h.update(JSON.stringify(row,(_,v)=>v instanceof Uint8Array?Buffer.from(v).toString('base64'):v)+'\n');out[table]=h.digest('hex');}return out;}
const OLD=['users','products','product_images','product_codes','audit_log','evidence','knowledge_claims','knowledge_sources','knowledge_claim_sources','ingredient_knowledge','knowledge_relationships'];
function verify(db:DB){assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('SELECT count(*) n FROM products').get()!.n,COUNT);assert.equal(db.prepare('SELECT count(*) n FROM product_codes').get()!.n,COUNT);assert.equal(db.prepare('SELECT product_id FROM product_images WHERE id=5000').get()!.product_id,5000);assert.equal(db.prepare('SELECT product_id FROM evidence WHERE id=77').get()!.product_id,5000);assert.equal(db.prepare('SELECT user_id FROM audit_log WHERE id=901').get()!.user_id,41);}
function addV32(db:DB){
 const batch=db.prepare('INSERT INTO inventory_batches(product_id,batch_code,quantity,expires_on,created_by,updated_by,created_at,updated_at) VALUES (?,?,3,?,41,41,?,?)');
 const global=db.prepare("INSERT INTO global_products(id,name,brand,ingredients,source_url,review_status) VALUES (?,?,'SYNTHETIC','Aqua, Glycerin','https://example.invalid/synthetic','draft')");
 db.exec('BEGIN');try{for(let id=1;id<=COUNT;id++){batch.run(id,'SYNTH-BATCH-'+id,'2099-12-31',AT,AT);global.run(id,'منتج عالمي اصطناعي '+id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 db.prepare('INSERT INTO advisor_sessions(id,user_id,context,created_at,last_active_at,expires_at) VALUES (?,41,?,?,?,?)').run('f'.repeat(36),'{}',AT,AT,'2099-12-31');
 db.prepare('INSERT INTO intelligence_memory(session_id,revision,state_json,updated_at) VALUES (?,3,?,?)').run('f'.repeat(36),JSON.stringify({skin:['dry'],product_refs:[{id:5000,name:'منتج اصطناعي 5000'}]}),AT);
 db.prepare("INSERT INTO intelligence_diagnostics(session_id,user_id,provenance,diagnostics_json,created_at) VALUES (?,41,'deterministic_fallback',?,?)").run('f'.repeat(36),'{"synthetic":true,"generative_invoked":false}',AT);
 db.prepare("INSERT INTO knowledge_settings(key,value) VALUES ('local_ai_metadata',?)").run('{"model_id":"qwen35-2b-q4km","desired_active":true}');
}
function exactRead(fd:number,size:number,position:number){const out=Buffer.alloc(size);assert.equal(readSync(fd,out,0,size,position),size,'truncated frame');return out;}

test('10,000 synthetic rows: baseline009 additive migration and MHBAK1 legacy decrypt/restore preserve exact content',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mh-v32-legacy-'));let db:DB|undefined,restored:DB|undefined;
 const start=performance.now();try{
  db=baseline(join(dir,'old.db'));verify(db);const before=digest(db,OLD);const oldBytes=new Uint8Array(readFileSync(join(dir,'old.db')));
  const sealed=await seal(oldBytes,PASS,{app:'com.makeuphouse.advisor',schema:db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r=>String(r.name)),counts:{products:COUNT}});
  await assert.rejects(decryptLegacy(sealed,'wrong-passphrase'));
  const opened=await decryptLegacy(sealed,PASS);assert.equal(await sha256hex(opened.plain),await sha256hex(oldBytes));
  writeFileSync(join(dir,'legacy-restored.db'),opened.plain);restored=new DatabaseSync(join(dir,'legacy-restored.db'));restored.exec('PRAGMA foreign_keys=ON');assert.deepEqual(migrate(restored),['010_intelligence_state.sql','011_inventory_batches.sql']);assert.deepEqual(digest(restored,OLD),before);verify(restored);assert.deepEqual(migrate(restored),[]);
  assert.equal(restored.prepare('SELECT count(*) n FROM inventory_batches').get()!.n,0,'old availability must not invent batches');
  assert.equal(restored.prepare('SELECT count(*) n FROM intelligence_memory').get()!.n,0);
  const changed=sealed.slice();changed[changed.length-1]^=1;await assert.rejects(decryptLegacy(changed,PASS));
  console.log('V32_BACKUP_METRIC '+JSON.stringify({kind:'MHBAK1_host_legacy',synthetic_products:COUNT,sqlite_bytes:oldBytes.length,encrypted_bytes:sealed.length,elapsed_ms:Math.round(performance.now()-start),migrations:['010','011'],android:false}));
 }finally{restored?.close();db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('10,000 synthetic local/global/batch records: actual MHBAK2 file stream authenticates and restores complete V3.2 state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mh-v32-stream-'));let db:DB|undefined,restored:DB|undefined;let input:number|undefined,output:number|undefined,backup:number|undefined;
 const start=performance.now();try{
  db=baseline(join(dir,'source.db'));const old=digest(db,OLD);assert.deepEqual(migrate(db),['010_intelligence_state.sql','011_inventory_batches.sql']);assert.deepEqual(digest(db,OLD),old);addV32(db);verify(db);
  const tables=[...OLD,'global_products','inventory_batches','advisor_sessions','intelligence_memory','intelligence_diagnostics','knowledge_settings'];const before=digest(db,tables);
  const copy=join(dir,'snapshot.db');db.prepare('VACUUM INTO ?').run(copy);
  const sourceSize=statSync(copy).size,writer=await BackupWriterV2.create(PASS,{app:'com.makeuphouse.advisor',schema:db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r=>String(r.name)),counts:{products:COUNT,global_products:COUNT,inventory_batches:COUNT},page_size:Number(db.prepare('PRAGMA page_size').get()!.page_size),page_count:Number(db.prepare('PRAGMA page_count').get()!.page_count)});
  input=openSync(copy,'r');output=openSync(join(dir,'backup.mhbak'),'w');writeSync(output,writer.headerBytes);let dataFrames=0;
  const encStart=performance.now();for(let pos=0;pos<sourceSize;pos+=CHUNK_BYTES){const bytes=exactRead(input,Math.min(CHUNK_BYTES,sourceSize-pos),pos);writeSync(output,await writer.data(bytes));dataFrames++;}writeSync(output,await writer.end());closeSync(input);input=undefined;closeSync(output);output=undefined;const encryptionMs=performance.now()-encStart;
  assert.ok(dataFrames>1,'test must cross chunk boundaries');
  backup=openSync(join(dir,'backup.mhbak'),'r');const parsed=readHeaderV2(exactRead(backup,Math.min(65536,statSync(join(dir,'backup.mhbak')).size),0));const reader=await BackupReaderV2.open(parsed.header,parsed.line,PASS);output=openSync(join(dir,'restored.db'),'w');let pos=parsed.bodyOffset,frames=0,first:Buffer|undefined,second:Buffer|undefined;
  const decStart=performance.now();while(pos<statSync(join(dir,'backup.mhbak')).size){const size=exactRead(backup,4,pos).readUInt32BE();pos+=4;assert.ok(size<=CHUNK_BYTES+512);const ct=exactRead(backup,size,pos);pos+=size;if(frames===0)first=ct;if(frames===1)second=ct;const plain=await reader.frame(ct);if(plain)writeSync(output,plain);frames++;}assert.equal(reader.done,true);closeSync(output);output=undefined;
  const decryptionMs=performance.now()-decStart;const hashFile=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');assert.equal(hashFile(join(dir,'restored.db')),hashFile(copy));
  restored=new DatabaseSync(join(dir,'restored.db'));restored.exec('PRAGMA foreign_keys=ON');verify(restored);assert.deepEqual(digest(restored,tables),before);assert.deepEqual(migrate(restored),[]);
  assert.equal(restored.prepare('SELECT count(*) n FROM inventory_batches b JOIN products p ON p.id=b.product_id').get()!.n,COUNT);assert.equal(restored.prepare('SELECT count(*) n FROM global_products').get()!.n,COUNT);assert.equal(restored.prepare('SELECT revision FROM intelligence_memory').get()!.revision,3);assert.equal(JSON.parse(String(restored.prepare("SELECT value FROM knowledge_settings WHERE key='local_ai_metadata'").get()!.value)).model_id,'qwen35-2b-q4km');
  assert.equal(restored.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND (name LIKE '%weight%' OR name LIKE '%gguf%')").get()!.n,0,'model weights not in DB schema');
  const wrong=await BackupReaderV2.open(parsed.header,parsed.line,'incorrect-password');await assert.rejects(wrong.frame(first!));const reordered=await BackupReaderV2.open(parsed.header,parsed.line,PASS);await assert.rejects(reordered.frame(second!));
  const truncated=await BackupReaderV2.open(parsed.header,parsed.line,PASS);await truncated.frame(first!);assert.equal(truncated.done,false,'no authenticated end means incomplete backup');await assert.rejects(truncated.frame(first!),'duplicate/replayed frame rejected');const changedLine=new TextEncoder().encode(JSON.stringify({...parsed.header,counts:{products:1}}));const alteredHeader=await BackupReaderV2.open(parsed.header,changedLine,PASS);await assert.rejects(alteredHeader.frame(first!),'authenticated header prevents count editing');
  const tampered=first!.slice();tampered[15]^=1;const corrupt=await BackupReaderV2.open(parsed.header,parsed.line,PASS);await assert.rejects(corrupt.frame(tampered));await assert.rejects(reader.frame(first!));
  console.log('V32_BACKUP_METRIC '+JSON.stringify({kind:'MHBAK2_host_stream',synthetic_products:COUNT,synthetic_global_products:COUNT,synthetic_batches:COUNT,sqlite_bytes:sourceSize,encrypted_bytes:statSync(join(dir,'backup.mhbak')).size,data_frames:dataFrames,max_plain_chunk_bytes:CHUNK_BYTES,encryption_ms:Math.round(encryptionMs),decryption_ms:Math.round(decryptionMs),elapsed_ms:Math.round(performance.now()-start),android:false,peak_memory:'NOT_MEASURED'}));
 }finally{if(input!==undefined)closeSync(input);if(output!==undefined)closeSync(output);if(backup!==undefined)closeSync(backup);restored?.close();db?.close();rmSync(dir,{recursive:true,force:true});}
});
