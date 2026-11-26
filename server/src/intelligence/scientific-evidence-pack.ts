/** Original Arabic summaries of inspected primary public pages, not copied papers and not
 * qualified scientific review. Installation is additive and EXPLICIT; manual pending claims
 * remain excluded by the existing knowledge authority until the normal review workflow. */
import type { DB } from '../db.ts';
export const SCIENTIFIC_PACK_VERSION='2026-11-26.1';
export const SCIENTIFIC_PACK_SOURCES=[
 {id:'sci_fda_hair_dyes',title:'Hair Dyes',url:'https://www.fda.gov/cosmetics/cosmetic-products/hair-dyes',section:'Coal-tar Hair Dye Safety Checklist',topic:'sci_hair_dye',domain:'hair',title_ar:'صبغات الشعر وحدود السلامة'},
 {id:'sci_fda_hair_cleansing',title:'Hair Cleansing Products',url:'https://www.fda.gov/cosmetics/cosmetic-products/hair-cleansing-products',section:'Hair Cleansing Products — adverse events and limits of inference',topic:'sci_hair_cleansing',domain:'scalp',title_ar:'منتجات تنظيف الشعر والإبلاغ عن التفاعلات'},
 {id:'sci_fda_allergens',title:'Allergens in Cosmetics',url:'https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics',section:'What Consumers Can Do; Symptoms of Allergic Reactions; Testing for Allergens',topic:'sci_cosmetic_allergens',domain:'safety',title_ar:'الحساسية التجميلية وحدود ادعاءات الملصق'},
 {id:'sci_fda_safe_use',title:'Using Cosmetics Safely',url:'https://www.fda.gov/cosmetics/resources-consumers-cosmetics/using-cosmetics-safely',section:'Understanding Cosmetic Labels; General Tips; Report Problems to FDA',topic:'sci_cosmetic_safe_use',domain:'general',title_ar:'الاستخدام والتخزين الآمن للمستحضرات'},
] as const;
export const SCIENTIFIC_PACK_CLAIMS=[
 {id:'sci_dye_label',source:'sci_fda_hair_dyes',kind:'advice',text:'عند صبغ الشعر تُتبع تعليمات العبوة والتحذيرات ومدة التطبيق المحددة؛ لا تُطيل المدة بحثًا عن نتيجة أقوى.',limit:'التعليمات الخاصة بمنتج موثق مقدمة على أي روتين عام؛ لا تُخمن المدة.'},
 {id:'sci_dye_scalp',source:'sci_fda_hair_dyes',kind:'caution',text:'توصي FDA بعدم صبغ الشعر أو فرده حين تكون فروة الرأس متهيجة أو مصابة بحروق شمسية أو متضررة.',limit:'إرشاد احترازي، لا يشخص سبب تهيج الفروة ولا يصف علاجًا.'},
 {id:'sci_dye_no_mix',source:'sci_fda_hair_dyes',kind:'caution',text:'لا تُخلط منتجات صبغ مختلفة على نحو غير موضح في تعليمات العبوة؛ وتُستخدم القفازات ويُشطف الشعر وفق تعليمات المنتج.',limit:'لا يجيز للمستشار تصميم مزج كيميائي أو وصف نسب خلط.'},
 {id:'sci_dye_eyes',source:'sci_fda_hair_dyes',kind:'caution',text:'لا تُستخدم صبغة شعر منزلية لصبغ الرموش أو الحواجب؛ وصولها للعين قد يسبب أذى خطيرًا.',limit:'ليس تقييمًا لترخيص منتجات مهنية متخصصة أو تعليمات استعمال لها.'},
 {id:'sci_cleanser_event',source:'sci_fda_hair_cleansing',kind:'education',text:'تذكر FDA بلاغات عن تساقط أو تكسر أو حكة وطفح مع بعض منتجات تنظيف الشعر؛ هذه البلاغات وحدها لا تثبت أن كل منتج من الفئة يسبب المشكلة.',limit:'لا يُستنتج التشخيص أو السببية من تزامن الاستعمال والأعراض وحده.'},
 {id:'sci_cleanser_category',source:'sci_fda_hair_cleansing',kind:'education',text:'تحتاج العلاقة المحتملة بين بعض منظفات الشعر والتساقط إلى مزيد من البحث؛ لا يجوز تحويل بيانات حيوانية محدودة إلى حكم مؤكد على شعر إنسان أو تركيبة أخرى.',limit:'يلزم فحص المنتج والصيغة والسياق وأدلة بشرية مناسبة قبل ادعاء السببية.'},
 {id:'sci_allergen_labels',source:'sci_fda_allergens',kind:'caution',text:'عبارات مثل hypoallergenic أو for sensitive skin لا تضمن عدم التحسس؛ تُراجع قائمة المكونات والتجربة السابقة وتعليمات المنتج.',limit:'هذا يصف حدود الادعاء، ولا يعني أن كل مكوّن أو كل منتج مسبب للحساسية.'},
 {id:'sci_allergen_hidden',source:'sci_fda_allergens',kind:'education',text:'قد تُدرج مكونات عطرية تحت اسم عام مثل fragrance أو perfume دون تسمية كل مادة على الملصق؛ لذا لا تكشف القائمة دائمًا تفاصيل الخليط العطري.',limit:'حدود الملصقات الأمريكية؛ لا يجوز اختلاق أسماء المواد غير المعلنة.'},
 {id:'sci_allergen_testing',source:'sci_fda_allergens',kind:'education',text:'اختبارات الحساسية التشخيصية التي يجريها مختص تختلف عن تجربة منتج منزلي على مساحة صغيرة؛ الأخيرة لا تُثبت استحالة حدوث تفاعل.',limit:'لا ينفذ التطبيق تشخيص حساسية ولا يحدد مسببها دون تقييم مختص.'},
 {id:'sci_allergen_referral',source:'sci_fda_allergens',kind:'referral',text:'الأعراض الشديدة مثل صعوبة التنفس أو البلع أو تورم الوجه بعد مستحضر تتجاوز الاستشارة التجميلية وتحتاج مساعدة طبية عاجلة.',limit:'الإحالة الفورية الحتمية تعمل قبل النموذج؛ لا تنتظر بحثًا أو مقارنة منتجات.'},
 {id:'sci_natural_limits',source:'sci_fda_safe_use',kind:'education',text:'كون المكوّن طبيعيًا أو عضويًا لا يحدد وحده أمان المنتج؛ تؤخذ التركيبة وتعليمات الاستعمال والتحمل في الاعتبار.',limit:'لا تقييم فردي للسلامة من منشأ المكوّن أو عبارة تسويقية فقط.'},
 {id:'sci_storage_limits',source:'sci_fda_safe_use',kind:'advice',text:'قد تتضرر المستحضرات بسوء التخزين والحرارة أو الرطوبة؛ تاريخ العبوة وحده ليس ضمانًا لبقاء المنتج صالحًا بعد سوء التخزين.',limit:'لا تُخمن مدة صلاحية أو فترة بعد الفتح غير موثقة من المنتج.'},
 {id:'sci_reaction_stop',source:'sci_fda_safe_use',kind:'caution',text:'عند ظهور تفاعل غير متوقع بعد مستحضر، يوقف استعماله ويُطلب تقييم صحي مناسب لشدة الأعراض؛ لا يُعالج التفاعل بإضافة منتجات تجميلية عشوائية.',limit:'ليست وصفة علاج، ولا تؤخر مسار الطوارئ عند أعراض خطيرة.'},
] as const;
export function installScientificEvidencePack(db:DB){
 const at=new Date().toISOString();let sources=0,claims=0;db.exec('SAVEPOINT scientific_evidence_pack');
 try{
  const sourceIds=new Map<string,string>();
  for(const s of SCIENTIFIC_PACK_SOURCES){
   db.prepare('INSERT OR IGNORE INTO knowledge_topics(id,domain,title_ar,title_en) VALUES (?,?,?,?)').run(s.topic,s.domain,s.title_ar,s.title);
   sources+=Number(db.prepare("INSERT OR IGNORE INTO knowledge_sources(id,title,url,publisher,source_type,evidence_level,license_status,language,accessed_at,origin,created_at) VALUES (?,?,?,'U.S. Food and Drug Administration','health_agency','expert_patient_education','link_and_summary_only','en',?,'manual',?)").run(s.id,s.title,s.url,at,at).changes);
   sourceIds.set(s.id,(db.prepare('SELECT id FROM knowledge_sources WHERE url=?').get(s.url) as {id:string}).id);
  }
  for(const c of SCIENTIFIC_PACK_CLAIMS){
   const s=SCIENTIFIC_PACK_SOURCES.find(s=>s.id===c.source)!;
   const added=Number(db.prepare("INSERT OR IGNORE INTO knowledge_claims(id,topic_id,kind,subject,text_ar,structured_en,limitations,evidence_level,state,review_level,origin,created_at,updated_at) VALUES (?,?,?,?,?,? ,?,'expert_patient_education','pending_review','none','manual',?,?)").run(c.id,s.topic,c.kind,s.topic,c.text,'Primary FDA consumer guidance; original Arabic summary; version '+SCIENTIFIC_PACK_VERSION,c.limit,at,at).changes);claims+=added;
   if(added){db.prepare('INSERT INTO knowledge_claim_sources(claim_id,source_id,locator) VALUES (?,?,?)').run(c.id,sourceIds.get(c.source)!,s.section+'; inspected 2026-11-26; original Arabic summary');db.prepare("INSERT INTO knowledge_review_history(claim_id,action,to_state,actor_role,reason,at) VALUES (?,'source_pack_ingested','pending_review','system',?,?)").run(c.id,'Primary-source pack '+SCIENTIFIC_PACK_VERSION+'; not human scientific approval',at);}
  }
  db.exec('RELEASE scientific_evidence_pack');return {version:SCIENTIFIC_PACK_VERSION,sources,claims,status:'pending_human_review',automatically_approved:0};
 }catch(e){db.exec('ROLLBACK TO scientific_evidence_pack');db.exec('RELEASE scientific_evidence_pack');throw e;}
}
