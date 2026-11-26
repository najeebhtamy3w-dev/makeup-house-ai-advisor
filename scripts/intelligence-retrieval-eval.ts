/** Development-only lexical retrieval experiment. No model, NLU claim, holdout access or production changes. */
import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
import {openDb} from '../server/src/db.ts';import {seedKnowledge,USABLE_SQL} from '../server/src/cp07/store.ts';
import {retrieveKnowledgeGraph} from '../server/src/intelligence/knowledge-links.ts';import {normAr} from '../server/src/advisor2/understand.ts';
const cases=[
 ['mixed-face','وجهي يزيت بسرعة بس حول خشمي يتقشر',['oily_skin','dry_skin','combination_skin']],
 ['wash-tight','بعد ما أغسل وجهي أحس جلدي يشد',['dry_skin','moisturizer_basics']],
 ['niacinamide-ar','إيش فايدة النياسيناميد',['niacinamide']],
 ['niacinamide-en','what does niacinamide do',['niacinamide']],
 ['niacinamide-variant','أشتي أعرف عن نيا سيناميد',['niacinamide']],
 ['hair-mixed','شعري من فوق دهني ومن تحت ناشف ويتكسر',['oily_hair','dry_damaged_hair']],
 ['hair-roots','الجذور تزيت والأطراف قش',['oily_hair','dry_damaged_hair']],
 ['sun','أشتي واقي يحمي وجهي من الشمس',['sun']],
 ['sun-english','sunscreen SPF protection',['sun']],
 ['glycerol','glycerol glycerine',['ing_glycerin']],
 ['glycerin-ar','الغليسرين والجلسرين نفس الشي',['ing_glycerin']],
 ['petroleum','petroleum jelly',['ing_petrolatum']],
 ['petrolatum-ar','فازلينا للترطيب',['ing_petrolatum']],
 ['ceramide','ceramide AP ceramides',['ing_ceramides']],
 ['b5','provitamin b5',['ing_panthenol']],
 ['hyaluronic','حمض الهيالورونك',['ing_hyaluronic']],
 ['sensitive','بشرتها حساسة وتتأثر بسرعة',['sensitive_skin']],
 ['acne-marks','معها آثار حبوب وبقع غامقة',['pigmentation','acne']],
 ['flakes','راسي يحكني وفيه قشور',['dandruff']],
 ['hair-fall','شعري يطيح كثير',['hair_loss']],
 ['routine','كيف أرتب صباح ومساء',['routine']],
 ['urea','carbamide',['ing_urea']],
] as const;
// Deliberately small, visible phrase/alias dictionary. These are retrieval aids, not verified clinical inferences.
const rules:[string,RegExp,string][]=[
 ['face-oil',/يزيت|تزيت|دهني|دهنه|يلمع/,'دهني oily'],
 ['dry-skin',/يتقشر|يشد|ناشف|قش(?:\s|$)/,'جاف dry ترطيب'],
 ['mixed-regions',/(حول خشمي|من فوق.*من تحت|الجذور.*الاطراف)/,'مختلط combination'],
 ['dry-hair',/(شعر|الجذور|الاطراف).*(ناشف|يتكسر|قش)|الاطراف/,'شعر جاف تالف damaged hair'],
 ['oily-hair',/(شعر|الجذور).*(دهني|تزيت)/,'شعر دهني oily hair'],
 ['niacinamide-spelling',/نيا\s+سيناميد|نياسيناميد/,'niacinamide'],
 ['glycerin-alias',/غليسرين|جلسرين|جليسرين|glycerol|glycerine/,'glycerin'],
 ['petrolatum-alias',/فازلينا|فازلين|petroleum jelly/,'petrolatum'],
 ['panthenol-alias',/provitamin b5|pro-vitamin b5/,'panthenol'],
 ['ceramide-alias',/ceramide ap|ceramides|سيراميد/,'ceramide np'],
 ['hyaluronic-alias',/هيالورونك|هيالورونيك/,'sodium hyaluronate'],
 ['urea-alias',/carbamide/,'urea'],
 ['sensitivity',/حساسه|تتاثر/,'حساسة sensitive'],
 ['pigmentation',/اثار حبوب|بقع غامقه/,'تصبغات pigmentation'],
 ['scalp-flakes',/راسي يحكني|قشور/,'قشرة فروة dandruff'],
 ['hair-shedding',/يطيح/,'تساقط hair loss'],
 ['routine-sequence',/ارتب صباح|صباح ومساء/,'روتين routine'],
];
const expand=(query:string)=>{const normalized=normAr(query),hits=rules.filter(([,re])=>re.test(normalized));return {query:[query,...hits.map(([, ,v])=>v)].join(' ').slice(0,300),rules:hits.map(([id])=>id)};};
const db=openDb(':memory:');const seeded=seedKnowledge(db);
const inventory=db.prepare(`SELECT id,topic_id,review_level,state,origin FROM knowledge_claims WHERE ${USABLE_SQL} ORDER BY id`).all() as {id:string;topic_id:string;review_level:string;state:string;origin:string}[];
const topics=new Set(inventory.map(c=>c.topic_id));for(const [id,,refs] of cases)for(const topic of refs)if(!topics.has(topic))throw Error(`Missing reference topic ${id}:${topic}`);
const rows=cases.map(([id,query,reference_topics])=>{const expansion=expand(query);const run=(q:string)=>{const start=performance.now();const r=retrieveKnowledgeGraph(db,{query:q,limit:6});const returned_topics=[...new Set(r.claims.map(c=>c.topic_id))];const matched=reference_topics.filter(t=>returned_topics.includes(t));return {claim_ids:r.claims.map(c=>c.id),topics:returned_topics,scores:r.claims.map(c=>({id:c.id,topic:c.topic_id,score:c.score,trust:c.trust.level})),topic_recall:matched.length/reference_topics.length,any_hit:matched.length>0,all_topics:matched.length===reference_topics.length,ms:performance.now()-start};};return {id,query,reference_topics,expanded_query:expansion.query,applied_rules:expansion.rules,baseline:run(query),expanded:run(expansion.query)};});
const summary=(variant:'baseline'|'expanded')=>({cases:rows.length,macro_topic_recall_at6:rows.reduce((n,r)=>n+r[variant].topic_recall,0)/rows.length,any_topic_hit_at6:rows.filter(r=>r[variant].any_hit).length/rows.length,all_reference_topics_at6:rows.filter(r=>r[variant].all_topics).length/rows.length,empty_results:rows.filter(r=>r[variant].claim_ids.length===0).length});
const result={kind:'development_retrieval_experiment',generated_at:new Date().toISOString(),method:'current retrieveKnowledgeGraph JS BM25; query only; limit6; no explicit topic/ingredient routing',dataset_sha256:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),seeded,usable_claims:inventory.length,qualified_scientific_claims:inventory.filter(c=>c.review_level==='qualified_scientific').length,topics:topics.size,metrics:{definition:'Macro topic recall@6 = mean per query of reference topics represented in top6 claims / reference topics count. Any/all topic hit rates are query-level. Not claim relevance, clinical validity or generative intelligence.'},baseline:summary('baseline'),expanded:summary('expanded'),improved_cases:rows.filter(r=>r.expanded.topic_recall>r.baseline.topic_recall).map(r=>r.id),regressed_cases:rows.filter(r=>r.expanded.topic_recall<r.baseline.topic_recall).map(r=>r.id),rules:rules.map(([id,re,append])=>({id,pattern:re.source,append})),rows};
const out=resolve(process.argv[2]??'docs/v3.2/evidence/recovery-2026-11-26/retrieval');mkdirSync(out,{recursive:true});writeFileSync(out+'/results.json',JSON.stringify(result,null,2)+'\n');writeFileSync(out+'/cases.json',JSON.stringify(cases,null,2)+'\n');console.log(JSON.stringify({baseline:result.baseline,expanded:result.expanded,improved:result.improved_cases,regressed:result.regressed_cases,usable_claims:result.usable_claims,qualified:result.qualified_scientific_claims,out},null,2));db.close();
