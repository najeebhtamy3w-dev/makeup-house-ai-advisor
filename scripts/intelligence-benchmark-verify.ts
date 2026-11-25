import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve('tests/intelligence-benchmark');
const splits=['development','model_selection','validation','final_holdout'];
const ids=new Set<string>(), families=new Set<string>();
for(const split of splits){
 const cases=JSON.parse(readFileSync(resolve(root,`${split}.inputs.json`),'utf8')).cases;
 const refs=JSON.parse(readFileSync(resolve(root,`${split}.references.json`),'utf8')).references;
 if(cases.length!==80 || refs.length!==80) throw Error(`Wrong count: ${split}`);
 const localFamilies=new Set<string>();
 for(const [i,c] of cases.entries()){
  if(ids.has(c.id)||refs[i].id!==c.id||c.split!==split) throw Error('Duplicate ID or reference mismatch');
  ids.add(c.id);localFamilies.add(c.family_id);
  if(c.history.length!==c.turn-1) throw Error('History/turn mismatch');
 }
 if(localFamilies.size!==20)throw Error('Wrong family count');
 for(const family of localFamilies){if(families.has(family))throw Error('Family split leakage');families.add(family);}
}
const lock=JSON.parse(readFileSync(resolve(root,'HOLDOUT_LOCK.json'),'utf8'));
for(const [file,hash]of Object.entries(lock.files)){
 if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==hash)throw Error('Holdout hash mismatch');
}
console.log(JSON.stringify({status:'PASSED',turns:ids.size,families:families.size,splits:4,holdout_hashes:'VERIFIED',inference_executed:false}));
