/** Read-only bounded graph retrieval. Association is never promoted to scientific proof. */
import type { DB } from '../db.ts';
import { bm25 } from '../cp07/retrieve.ts';
import { claimSources, trustLabel, USABLE_SQL, type ClaimRow } from '../cp07/store.ts';
import { normAr } from '../advisor2/understand.ts';
import { KB } from '../science/knowledge.ts';

export interface KnowledgeQuery { query?: string; ingredient?: string; ingredients?: string[]; topic_id?: string; topic_ids?: string[]; limit?: number }
interface Ingredient { inci: string; names_ar: string; synonyms: string; functions: string; topic_id: string }
export interface KnowledgeNode { id: string; type: 'ingredient'|'function'|'topic'|'claim'|'source'; label: string }
export interface KnowledgeEdge { from: string; to: string; relation: string; supported: boolean; claim_ids: string[]; source_ids: string[]; provenance: string }
const list = (s: string): string[] => { try { const x: unknown = JSON.parse(s); return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').slice(0, 20) : []; } catch { return []; } };
export function retrieveKnowledgeGraph(db: DB, input: KnowledgeQuery = {}) {
  const query = String(input.query ?? '').slice(0, 300).trim();
  const ingredient = normAr(String(input.ingredient ?? '').slice(0, 120).trim());
  const topic = String(input.topic_id ?? '').slice(0, 100).trim();
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(12, Math.trunc(input.limit!))) : 6;
  const nodes = new Map<string, KnowledgeNode>(), edges: KnowledgeEdge[] = [];
  const add = (id: string, type: KnowledgeNode['type'], label: string) => { if(nodes.size < 150) nodes.set(id, {id,type,label}); };
  const ingredients = db.prepare('SELECT inci,names_ar,synonyms,functions,topic_id FROM ingredient_knowledge ORDER BY inci').all() as unknown as Ingredient[];
  // Match only exact documented names/aliases, including Arabic spellings, before lexical ranking.
  const requestedIngredients=[ingredient,...(input.ingredients??[]).slice(0,8).map(i=>normAr(String(i).slice(0,120)))].filter(Boolean);
  const normalizedQuery=normAr(query);
  const phraseHit=(name:string)=>{const n=normAr(name);return n.length>=3&&(' '+normalizedQuery+' ').includes(' '+n+' ');};
  const registryMatches=KB.filter(i=>[i.inci,...i.synonyms].some(n=>requestedIngredients.includes(normAr(n))||phraseHit(n))).slice(0,12);
  const registryNames=new Set(registryMatches.flatMap(i=>[i.inci,...i.synonyms]).map(normAr));
  const matched = ingredients.filter(i => [i.inci, ...list(i.names_ar), ...list(i.synonyms)].some(n => requestedIngredients.includes(normAr(n))||registryNames.has(normAr(n))||phraseHit(n)));
  const topics = new Set([...(topic ? [topic] : []),...(input.topic_ids??[]).slice(0,8).map(t=>String(t).slice(0,100)), ...matched.map(i => i.topic_id)]);
  const expandedQuery=[query,...matched.flatMap(i=>[i.inci,...list(i.names_ar).slice(0,2)]),...registryMatches.map(i=>i.inci)].join(' ').slice(0,1000);
  const scores = query||matched.length ? bm25(db, expandedQuery) : new Map<string, number>();
  const usable = db.prepare(`SELECT * FROM knowledge_claims WHERE ${USABLE_SQL}`).all() as unknown as ClaimRow[];
  const rankings:string[][]=[];
  const lexical=usable.filter(c=>(scores.get(c.id)??0)>0).sort((a,b)=>(scores.get(b.id)??0)-(scores.get(a.id)??0)||a.id.localeCompare(b.id));
  if(lexical.length)rankings.push(lexical.map(c=>c.id));
  // One structured list per need prevents a broad need's many matches from starving a second concern.
  for(const t of topics){const rows=usable.filter(c=>c.topic_id===t).sort((a,b)=>(scores.get(b.id)??0)-(scores.get(a.id)??0)||a.id.localeCompare(b.id));if(rows.length)rankings.push(rows.map(c=>c.id));}
  const fused=new Map<string,number>();for(const ranking of rankings)ranking.forEach((id,rank)=>fused.set(id,(fused.get(id)??0)+1/(60+rank+1)));
  const claims = usable.filter(c=>fused.has(c.id)).sort((a,b)=>(fused.get(b.id)??0)-(fused.get(a.id)??0)||a.id.localeCompare(b.id)).slice(0,limit)
    .map(c=>({...c,score:fused.get(c.id)??0,lexical_score:scores.get(c.id)??0,trust:trustLabel(c),sources:claimSources(db,c.id)}));
  for(const c of claims) {
    topics.add(c.topic_id); add(`claim:${c.id}`,'claim',c.text_ar);
    add(`topic:${c.topic_id}`,'topic',c.topic_id);
    edges.push({from:`claim:${c.id}`,to:`topic:${c.topic_id}`,relation:'about',supported:false,claim_ids:[c.id],source_ids:c.sources.map(s=>s.id),provenance:'claim_metadata'});
    for(const s of c.sources.slice(0,4)) { add(`source:${s.id}`,'source',s.title); edges.push({from:`claim:${c.id}`,to:`source:${s.id}`,relation:'cites',supported:false,claim_ids:[c.id],source_ids:[s.id],provenance:'citation_not_endorsement'}); }
  }
  for(const i of ingredients.filter(i=>topics.has(i.topic_id)).slice(0,12)) {
    add(`ingredient:${i.inci}`,'ingredient',i.inci); add(`topic:${i.topic_id}`,'topic',i.topic_id);
    edges.push({from:`ingredient:${i.inci}`,to:`topic:${i.topic_id}`,relation:'indexed_under',supported:false,claim_ids:[],source_ids:[],provenance:'ingredient_metadata'});
    for(const f of list(i.functions).slice(0,4)) { add(`function:${f}`,'function',f); edges.push({from:`ingredient:${i.inci}`,to:`function:${f}`,relation:'listed_function',supported:false,claim_ids:[],source_ids:[],provenance:'unreviewed_ingredient_metadata'}); }
  }
  const resolve = (id:string) => ingredients.some(i=>i.inci===id) ? `ingredient:${id}` : `topic:${id}`;
  const relations = db.prepare('SELECT from_id,rel,to_id,claim_id FROM knowledge_relationships ORDER BY from_id,rel,to_id').all() as unknown as {from_id:string;rel:string;to_id:string;claim_id:string|null}[];
  for(const r of relations) {
    const from=resolve(r.from_id),to=resolve(r.to_id);
    if(!nodes.has(from) && !nodes.has(to)) continue;
    if(edges.length>=180) break;
    const c=claims.find(c=>c.id===r.claim_id);
    add(from,from.startsWith('ingredient:')?'ingredient':'topic',r.from_id); add(to,to.startsWith('ingredient:')?'ingredient':'topic',r.to_id);
    edges.push({from,to,relation:r.rel,supported:!!c && c.review_level==='qualified_scientific' && ['approved','published'].includes(c.state) && c.sources.length>0,claim_ids:c?[c.id]:[],source_ids:c?.sources.map(s=>s.id)??[],provenance:c?'linked_claim':'unsourced_relationship_not_evidence'});
  }
  return {claims,nodes:[...nodes.values()],edges:edges.filter(e=>nodes.has(e.from)&&nodes.has(e.to)).slice(0,200),warnings:['الربط البنيوي أو ذكر المصدر لا يثبت السلامة أو الملاءمة؛ راجع حالة كل ادعاء.'],retrieval:{method:'hybrid_alias_structured_bm25_rrf',query,ingredient,topic_id:topic,topic_ids:[...topics].slice(0,12),matched_ingredients:matched.map(i=>i.inci),registry_matches:registryMatches.map(i=>i.inci),ranking_lists:rankings.length,limit,semantic_embeddings:false}};
}

/** Explicit opt-in ingestion only. No approval, no overwrite and no synthetic science. */
export function enrichScientificKnowledge(db: DB) {
  const references = [
    {id:'v32_fda_label',title:'FDA Cosmetics Labeling Guide',url:'https://www.fda.gov/cosmetics/cosmetics-labeling-regulations/cosmetics-labeling-guide',publisher:'FDA',type:'health_agency',level:'regulatory'},
    {id:'v32_ec_cosing',title:'Cosmetic ingredient database',url:'https://single-market-economy.ec.europa.eu/sectors/cosmetics/cosmetic-ingredient-database_en',publisher:'European Commission',type:'regulation',level:'regulatory'},
    {id:'v32_aad_test',title:'How to test skin care products',url:'https://www.aad.org/public/everyday-care/skin-care-secrets/prevent-skin-problems/test-skin-care-products',publisher:'American Academy of Dermatology',type:'professional_body',level:'expert_patient_education'},
  ];
  const entries = [
    ['v32_label_order','v32_fda_label','وفق دليل FDA الأمريكي، تُسرد المكونات الأعلى من ١٪ بترتيب تنازلي، بينما يمكن ترتيب المكونات عند ١٪ أو أقل بحرية، مع استثناءات للملونات.','سياق الملصقات الأمريكية؛ ترتيب القائمة لا يكشف التركيز الدقيق ولا يثبت سلامة التركيبة.'],
    ['v32_cosing_scope','v32_ec_cosing','ظهور اسم INCI في CosIng لا يعني أن المكون مصرح باستخدامه تجميليًا؛ يجب الرجوع إلى تشريع الاتحاد الأوروبي وشروطه ذات الصلة.','معلومة تنظيمية تخص الاتحاد الأوروبي، وليست حكمًا تنظيميًا في اليمن أو إثباتًا لسلامة منتج.'],
    ['v32_cosing_limits','v32_ec_cosing','قاعدة CosIng معلوماتية وليست ذات قيمة قانونية مستقلة؛ تقييم سلامة المنتج النهائي يظل مطلوبًا وفق الإطار الأوروبي.','لا يحل اسم المكون أو وظيفته المسجلة محل تقييم التركيبة النهائية.'],
    ['v32_product_test','v32_aad_test','توصي AAD بتجربة منتج العناية على مساحة صغيرة مرتين يوميًا لمدة ٧ إلى ١٠ أيام قبل توسيع استخدامه، مع الالتزام بطريقة الاستخدام المعتادة وتعليمات الشطف.','تجربة منزلية وليست اختبار حساسية طبيًا أو ضمانًا لعدم التفاعل؛ عند ظهور تفاعل يوقف الاستخدام، والأعراض الشديدة تتطلب مسار الإحالة المناسب.'],
  ];
  let sources=0,claims=0; const at=new Date().toISOString();
  db.exec('SAVEPOINT v32_knowledge_enrichment');
  try {
    db.prepare("INSERT OR IGNORE INTO knowledge_topics(id,domain,title_ar,title_en) VALUES ('v32_evidence_limits','general','حدود تفسير المكونات وتجربة المنتجات','Ingredient interpretation and product testing limits')").run();
    const ids=new Map<string,string>();
    for(const s of references) {
      sources+=Number(db.prepare("INSERT OR IGNORE INTO knowledge_sources(id,title,url,publisher,source_type,evidence_level,license_status,industry_affiliation,language,accessed_at,origin,created_at) VALUES (?,?,?,?,?,?,'link_and_summary_only','','en',?,'manual',?)").run(s.id,s.title,s.url,s.publisher,s.type,s.level,at,at).changes);
      ids.set(s.id,(db.prepare('SELECT id FROM knowledge_sources WHERE url=?').get(s.url) as {id:string}).id);
    }
    for(const [id,source,text,limitations] of entries) {
      const level=references.find(s=>s.id===source)!.level;
      const added=Number(db.prepare("INSERT OR IGNORE INTO knowledge_claims(id,topic_id,kind,text_ar,limitations,evidence_level,state,review_level,origin,created_at,updated_at) VALUES (?,'v32_evidence_limits','education',?,?,?,'pending_review','none','manual',?,?)").run(id!,text!,limitations!,level,at,at).changes);
      claims+=added;
      if(added) {
        db.prepare('INSERT INTO knowledge_claim_sources(claim_id,source_id,locator) VALUES (?,?,?)').run(id!,ids.get(source!)!,'Original Arabic summary; checked 2026-11-25');
        db.prepare("INSERT INTO knowledge_review_history(claim_id,action,to_state,actor_role,reason,at) VALUES (?,'reference_ingested','pending_review','system','Original Arabic primary-source summary; requires human review',?)").run(id!,at);
      }
    }
    db.exec('RELEASE v32_knowledge_enrichment'); return {sources,claims};
  } catch(e) { db.exec('ROLLBACK TO v32_knowledge_enrichment'); db.exec('RELEASE v32_knowledge_enrichment'); throw e; }
}
