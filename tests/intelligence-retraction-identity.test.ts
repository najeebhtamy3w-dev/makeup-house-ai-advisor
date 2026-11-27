/** Synthetic identity/governance checks, not evidence of clinical findings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../server/src/db.ts';
import {seedKnowledge} from '../server/src/cp07/store.ts';
import {setExternalSearch} from '../server/src/cp07/connectors.ts';
import {mergeResearchPublications,runDeepResearch} from '../server/src/intelligence/deep-research.ts';
const evidence=(pmid:string,doi:string,pub_types=['Review'])=>({title:'Synthetic skin metadata',url:`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,publisher:'Synthetic indexed fixture',published_at:'2024',pub_types,snippet:'',affiliation:'',pmid,doi});
const batch=(index:string,items:any[])=>({index,query:'skin',items});

test('known integrity flag quarantines exact normalized DOI mirrors across different PMID records',()=>{
 const flag=evidence('11','10.1000/EXACT',['Review','Retracted Publication']);
 const mirror=evidence('22','10.1000/exact');
 for(const rows of [[batch('pubmed',[flag]),batch('europepmc',[mirror])],[batch('europepmc',[mirror]),batch('pubmed',[flag])]])assert.deepEqual(mergeResearchPublications(rows,['skin']),[]);
});

test('same PMID identity can carry an integrity flag to a DOI-only mirror, without guessing from title',()=>{
 const flag=evidence('11','',['Review','Expression of Concern']);
 const bridge=evidence('11','10.1000/bridge');
 const doiOnly={...evidence('22','10.1000/bridge'),pmid:undefined,url:'https://doi.org/10.1000/bridge'};
 const unrelated=evidence('33','10.1000/unrelated');
 const out=mergeResearchPublications([batch('pubmed',[flag]),batch('europepmc',[bridge,doiOnly,unrelated])],['skin']);
 assert.deepEqual(out.map(p=>p.pmid),['33']);
});

test('invalid DOI strings and similar titles cannot spread an integrity flag',()=>{
 for(const invalid of ['bogus','10.1000/a b','10.1000/<tag>']){
  const out=mergeResearchPublications([batch('pubmed',[evidence('11',invalid,['Retracted Publication'])]),batch('europepmc',[evidence('22',invalid)])],['skin']);
  assert.equal(out.length,1);assert.equal(out[0]!.pmid,'22');assert.equal(out[0]!.doi,null);
 }
});

test('offline cached DOI quarantine rejects pending mirrors and preserves human-reviewed records',async()=>{
 const db=openDb(':memory:');try{
  seedKnowledge(db);setExternalSearch(db,true);
  const flag=evidence('11','10.1000/exact',['Review','Retracted Publication']);
  const mirror=evidence('22','10.1000/EXACT');
  for(const [source,items] of [['pubmed',[flag]],['europepmc',[mirror]]] as const)db.prepare('INSERT INTO knowledge_cache(key,body,fetched_at) VALUES (?,?,?)').run(source+':niacinamide topical skin',JSON.stringify(items),new Date().toISOString());
  const columns='source,query_key,title,url,snippet,language,retrieved_at,review_state,publisher,pub_types,published_at,license_status,evidence_level,validation,evidence_state';
  db.prepare(`INSERT INTO knowledge_retrievals(${columns}) VALUES (?,?,?,?,?,'en',?,'approved',?,'Review','2024','metadata_only','review','{}','pending_review')`).run('reviewed-fixture','skin','Reviewed original',mirror.url,'',new Date().toISOString(),'Synthetic fixture');
  const r=await runDeepResearch(db,{concepts:['niacinamide'],max_queries:1},{online:false,fetch:async()=>{throw Error('network forbidden');}});
  assert.equal(r.requests,0);assert.deepEqual(r.publications,[]);
  const rows=db.prepare('SELECT source,review_state,evidence_state,validation FROM knowledge_retrievals').all() as any[];
  assert.equal(rows.find(x=>x.source==='europepmc').evidence_state,'rejected');
  assert.ok(JSON.parse(rows.find(x=>x.source==='europepmc').validation).cross_index_integrity);
  assert.equal(rows.find(x=>x.source==='reviewed-fixture').review_state,'approved');
  assert.equal(rows.find(x=>x.source==='reviewed-fixture').validation,'{}');
 }finally{db.close();}
});
