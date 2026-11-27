/** Bounded metadata research, not an autonomous clinical evidence synthesis.
 * Reuses CP07 consent/cache/rate/breaker/review storage. No abstract/full text is fetched or promoted to knowledge.
 */
import type { DB } from '../db.ts';
import { KB } from '../science/knowledge.ts';
import { normAr } from '../advisor2/understand.ts';
import { pubMed, guardedSearch, externalSearchEnabled, sanitizeSnippet, type Connector, type FetchLike, type RawEvidence } from '../cp07/connectors.ts';
import { storeEvidence } from '../cp07/growth.ts';
import { validateEvidence } from '../cp07/validate.ts';

const GENERIC:Record<string,string>={
 'dry skin':'dry skin','sensitive skin':'sensitive skin','oily skin':'oily skin',acne:'acne',hyperpigmentation:'hyperpigmentation',dandruff:'dandruff','hair loss':'hair loss','hair damage':'hair damage',sunscreen:'sunscreen',photoprotection:'photoprotection','skin barrier':'skin barrier',moisturizer:'moisturizer',ceramides:'ceramides',niacinamide:'niacinamide','azelaic acid':'azelaic acid',retinol:'retinol',retinal:'retinal','vitamin c':'ascorbic acid',
 'البشرة الجافة':'dry skin','جفاف البشرة':'dry skin','البشرة الحساسة':'sensitive skin','البشرة الدهنية':'oily skin','حب الشباب':'acne','التصبغات':'hyperpigmentation','قشرة الرأس':'dandruff','تساقط الشعر':'hair loss','حاجز البشرة':'skin barrier','واقي الشمس':'sunscreen',
};
const authority=new Map<string,string>(Object.entries(GENERIC).map(([k,v])=>[normAr(k),v]));
for(const ingredient of KB)for(const alias of [ingredient.inci,...ingredient.synonyms])authority.set(normAr(alias),ingredient.inci);
/** Only complete known concepts are transmitted; never extract a name/condition from raw personal prose here. */
export function normalizeResearchConcepts(input:unknown):{concepts:string[];valid:boolean}{
 if(!Array.isArray(input)||input.length<1||input.length>6||input.some(x=>typeof x!=='string'||x.length>100))return{concepts:[],valid:false};
 const values=input.map(x=>authority.get(normAr(x.trim())));if(values.some(x=>!x))return{concepts:[],valid:false};
 return{concepts:[...new Set(values as string[])],valid:true};
}
interface IndexedEvidence extends RawEvidence { pmid?:string; doi?:string; index_id?:string }
const clean=(value:unknown,max=300)=>sanitizeSnippet(typeof value==='string'?value:'').slice(0,max);
export const europePmc:Connector={
 id:'europepmc',label:'Europe PMC / EMBL-EBI',min_interval_ms:500,daily_cap:300,
 async search(q,f,signal){
  const query=`(${q}) AND SRC:MED`;
  const r=await f('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=lite&pageSize=5&query='+encodeURIComponent(query),{signal});
  if(!r.ok)throw Object.assign(Error('EUROPE_PMC_HTTP'),{status:r.status});
  const payload=JSON.parse(await r.text());const rows=payload?.resultList?.result;if(!Array.isArray(rows))throw Error('EUROPE_PMC_SCHEMA');
  return rows.slice(0,5).flatMap((row:any):IndexedEvidence[]=>{
   // MED only: preprints/patents must not be mistaken for reviewed clinical studies.
   const pmid=String(row.pmid??(row.source==='MED'?row.id:''));if(row.source!=='MED'||!/^\d{1,12}$/.test(pmid))return[];
   const title=clean(row.title,300);if(!title)return[];
   const doi=clean(row.doi,180).toLowerCase();
   return[{title,url:`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,publisher:'Europe PMC — '+(clean(row.journalTitle,120)||'journal not provided'),published_at:/^\d{4}$/.test(String(row.pubYear))?String(row.pubYear):null,pub_types:[],snippet:'',affiliation:'',pmid,doi:/^10\.\d{4,9}\/[^\s<>]+$/.test(doi)?doi:undefined,index_id:'MED:'+pmid}];
  });
 },
};
export interface DeepResearchInput { concepts:unknown; domain?:'skin'|'hair'|'both'; max_queries?:number }
export interface DeepResearchEnvironment {fetch:FetchLike;online:boolean;signal?:AbortSignal;timeoutMs?:number;nowMs?:number;sleep?:(ms:number)=>Promise<void>}
export interface ResearchPublication {
 id:string;title:string;url:string;pmid:string|null;doi:string|null;publishers:string[];year:string|null;indexes:string[];
 evidence_level:string;metadata_quality:number;relevance:number;review_state:'unreviewed';license_scope:'bibliographic_metadata_only';
 findings_available:false;unique_publication_count:1;study_independence:'NOT_ASSESSED';retraction_status:'NOT_ASSESSED';metadata_conflicts:string[];
}
function identity(e:IndexedEvidence){
 const pmid=e.pmid??e.url.match(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/)?.[1];
 return{pmid:pmid&&/^\d{1,12}$/.test(pmid)?pmid:null,doi:e.doi?.toLowerCase()??null};
}
/** Metadata matching, never conclusion extraction. Both index appearances count as ONE publication. */
export function mergeResearchPublications(rows:{index:string;query:string;items:RawEvidence[]}[],concepts:string[]):ResearchPublication[]{
 const out:ResearchPublication[]=[];const words=new Set(concepts.join(' ').toLowerCase().split(/\W+/).filter(w=>w.length>2));
 for(const batch of rows)for(const raw of batch.items){
  const e=raw as IndexedEvidence,ids=identity(e);if(!ids.pmid&&!ids.doi)continue;
  const validation=validateEvidence(e);if(validation.verdict==='blocked')continue;
  const conflictingDoi=out.filter(p=>ids.doi&&p.doi===ids.doi&&ids.pmid&&p.pmid&&ids.pmid!==p.pmid);
  const existing=out.find(p=>(ids.pmid&&p.pmid===ids.pmid)||(ids.doi&&p.doi===ids.doi&&(!ids.pmid||!p.pmid)));
  if(existing){
   if(!existing.indexes.includes(batch.index))existing.indexes.push(batch.index);
   if(!existing.publishers.includes(e.publisher))existing.publishers.push(e.publisher);
   if(existing.doi&&ids.doi&&existing.doi!==ids.doi)existing.metadata_conflicts.push('DOI differs for the same PMID; manual identity review required');
   if(existing.doi&&ids.doi&&existing.doi!==ids.doi)existing.metadata_conflicts.push('DOI differs for the same PMID; manual identity review required');
   if(!existing.doi&&ids.doi)existing.doi=ids.doi;
   if(normAr(existing.title)!==normAr(e.title))existing.metadata_conflicts.push('title differs between indexes; manual identity review required');
   if(existing.year&&e.published_at&&existing.year!==e.published_at)existing.metadata_conflicts.push('publication year differs between indexes');
   continue;
  }
  for(const conflict of conflictingDoi)if(!conflict.metadata_conflicts.includes('same DOI assigned to different PMIDs; records not merged'))conflict.metadata_conflicts.push('same DOI assigned to different PMIDs; records not merged');
  const tw=new Set(e.title.toLowerCase().split(/\W+/));const overlap=words.size?[...words].filter(w=>tw.has(w)).length/words.size:0;
  out.push({id:ids.pmid?'pmid:'+ids.pmid:'doi:'+ids.doi,title:e.title,url:e.url,pmid:ids.pmid,doi:ids.doi,publishers:[e.publisher],year:e.published_at,indexes:[batch.index],evidence_level:validation.evidence_level,metadata_quality:validation.strength,relevance:Math.round(overlap*100)/100,review_state:'unreviewed',license_scope:'bibliographic_metadata_only',findings_available:false,unique_publication_count:1,study_independence:'NOT_ASSESSED',retraction_status:'NOT_ASSESSED',metadata_conflicts:conflictingDoi.length?['same DOI assigned to different PMIDs; records not merged']:[]});
 }
 return out.sort((a,b)=>b.relevance-a.relevance||b.metadata_quality-a.metadata_quality||a.id.localeCompare(b.id)).slice(0,10);
}
export async function runDeepResearch(db:DB,input:DeepResearchInput,env:DeepResearchEnvironment){
 const normalized=normalizeResearchConcepts(input.concepts);const start=Date.now();
 const base={method:'bounded_multi_index_metadata_research',concepts:normalized.concepts,publications:[] as ResearchPublication[],calls:[] as {index:string;query:string;status:string;cached:boolean}[],requests:0,stored:0,review_state:'unreviewed',claims:[] as never[],scientific_conclusions:[] as never[],conflict_analysis:{status:'NOT_ASSESSED',reason:'Titles and bibliographic metadata cannot establish scientific findings or contradictory outcomes.'},warnings:['نتائج اكتشاف مصادر غير مراجعة؛ وجود دراسة أو عنوانها لا يثبت فائدة أو سلامة أو استنتاجًا علميًا.','PubMed وEurope PMC قد يفهرسان الدراسة نفسها؛ تكرار الفهرسة ليس دليلًا مستقلاً.']};
 if(!normalized.valid)return{...base,status:'requires_supported_concepts',elapsed_ms:Date.now()-start};
 if(!externalSearchEnabled(db))return{...base,status:'disabled',elapsed_ms:Date.now()-start};
 if(input.domain&&!['skin','hair','both'].includes(input.domain))return{...base,status:'invalid_domain',elapsed_ms:Date.now()-start};
 const domain=input.domain==='hair'?'hair scalp':input.domain==='both'?'skin hair':'skin';
 const queries=[normalized.concepts.join(' ')+' topical '+domain];
 if((input.max_queries??2)>1&&normalized.concepts.length>1)queries.push(normalized.concepts[0]+' topical '+domain);
 const controller=new AbortController();const abort=()=>controller.abort();env.signal?.addEventListener('abort',abort,{once:true});if(env.signal?.aborted)controller.abort();
 const deadline=setTimeout(abort,Math.max(20,Math.min(env.timeoutMs??18000,30000)));
 const check=()=>{if(controller.signal.aborted)throw Error('RESEARCH_CANCELLED_OR_DEADLINE');};
 const boundedFetch:FetchLike=async(url,init)=>{
  check();if(base.requests>=8)throw Error('RESEARCH_REQUEST_BUDGET');base.requests++;
  if(!/^https:\/\/(?:eutils\.ncbi\.nlm\.nih\.gov|www\.ebi\.ac\.uk)\//.test(url))throw Error('RESEARCH_HOST_NOT_ALLOWED');
  const ac=new AbortController(),stop=()=>ac.abort();controller.signal.addEventListener('abort',stop,{once:true});init?.signal?.addEventListener('abort',stop,{once:true});
  let rejectAbort:()=>void=()=>{};
  const failed=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(Error('RESEARCH_CANCELLED_OR_DEADLINE'));ac.signal.addEventListener('abort',rejectAbort,{once:true});});
  try{
   const response=await Promise.race([env.fetch(url,{...init,signal:ac.signal}),failed]);
   const body=await Promise.race([response.text(),failed]);check();if(body.length>1000000)throw Error('RESEARCH_RESPONSE_SIZE');
   return{ok:response.ok,status:response.status,headers:response.headers,text:async()=>body};
  }finally{controller.signal.removeEventListener('abort',stop);init?.signal?.removeEventListener('abort',stop);ac.signal.removeEventListener('abort',rejectAbort);}
 };
 const sleep=async(ms:number)=>{check();if(env.sleep)await env.sleep(ms);else await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',onAbort);resolve();},ms);const onAbort=()=>{clearTimeout(timer);reject(Error('RESEARCH_CANCELLED_OR_DEADLINE'));};controller.signal.addEventListener('abort',onAbort,{once:true});});check();};
 const rows:{index:string;query:string;items:RawEvidence[]}[]=[];
 let activeCall:{index:string;query:string;status:string;cached:boolean}|null=null;
 try{
  for(const query of queries.slice(0,2))for(const connector of [pubMed,europePmc]){
   check();
   activeCall={index:connector.id,query,status:'running',cached:false};base.calls.push(activeCall);
   const r=await guardedSearch(db,connector,query,{fetch:boundedFetch,online:env.online,nowMs:env.nowMs,sleep,timeoutMs:Math.min(env.timeoutMs??8000,8000)});
   activeCall.status=r.status;activeCall.cached=r.status==='ok'&&r.cached;
   if(r.status==='ok'){
    const safeItems=r.items.filter(e=>/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d{1,12}\/$/.test(e.url)).slice(0,5).map(e=>({...e,title:clean(e.title),publisher:clean(e.publisher,160),pub_types:Array.isArray(e.pub_types)?e.pub_types.filter(t=>typeof t==='string').slice(0,20):[],snippet:'',affiliation:''}));
    rows.push({index:connector.id,query,items:safeItems});
    base.stored+=storeEvidence(db,connector.id,query,safeItems,new Date(env.nowMs??Date.now()).toISOString(),null,null);
   }
  }
  base.publications=mergeResearchPublications(rows,normalized.concepts);
  return{...base,status:!env.online?(base.publications.length?'offline_cached':'offline'):base.calls.some(c=>c.status!=='ok')?'partial':'completed_metadata_research',elapsed_ms:Date.now()-start};
 }catch{
  if(activeCall?.status==='running')activeCall.status=controller.signal.aborted?'cancelled_or_deadline':'failed';
  base.publications=mergeResearchPublications(rows,normalized.concepts);
  return{...base,status:controller.signal.aborted?'cancelled_or_deadline':'failed',elapsed_ms:Date.now()-start};
 }finally{clearTimeout(deadline);env.signal?.removeEventListener('abort',abort);}
}
