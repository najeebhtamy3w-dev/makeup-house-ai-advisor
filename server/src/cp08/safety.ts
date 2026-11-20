/**
 * CP08 — conservative safety layer (concept based). Runs BEFORE anything else and independently of any model.
 * Adds to — never replaces or weakens — the CP06.2 rules (advisor2/safety.ts) and the CP07 extra patterns.
 *
 * Why: the CP07 natural-language baseline caught only 10/18 urgent cases because rules matched fixed phrases
 * ("تورم" but not "منفوخة", "صعوبة التنفس" but not "ضيقة نفس"). Here each urgent sign is a CONCEPT with Yemeni / Gulf /
 * colloquial variants, and the most dangerous ones (airway, eye swelling) fire on the symptom alone.
 * A negated mention ("ما فيه تورم", "بدون حكة") does not fire.
 * Never diagnoses; returns a reason label for an escalation message.
 */
import { normAr } from '../advisor2/understand.ts';

export interface SafetyHit { kind: 'urgent' | 'referral'; code: string; label_ar: string }

// each pattern is tested on normalised text (ة→ه، أ/إ/آ→ا، ى→ي)
const SWELL = '(انتفخ|انتفخت|انتفخو|منتفخ|منتفخه|منفوخ|منفوخه|انتفاخ|نفخ|تنفخ|ورم|ورمت|وارم|وارمه|تورم|تورمت|متورم|متورمه)';
const FACE = '(وجه|وجهي|وجهها|وجهه|عيون|عيوني|عيونها|عيني|عينها|عين|جفن|جفني|جفوني|جفونها|شفايف|شفايفي|شفايفها|شفتي|شفتها|شفاه|لسان|لساني|لسانها|حلق|حلقي|حلقها|رقبتي|رقبه)';
const URGENT: [RegExp, string, string][] = [
  // airway / anaphylaxis signs — fire on their own
  [/(ضيق(ه)? (في |ب)?(ال)?(نفس|تنفس)|ضيقه نفس|صعوب(ه|ة) (في )?(ال)?تنفس|ما اقدر اتنفس|مو قادر(ه)? اتنفس|ما قدرت اتنفس|نفسي (ضايق|مقطوع|يضيق)|اختناق|اتخنق|اختنق|خنقه|حلق(ي|ها|ه) (يضيق|ضاق|يسكر|مسكر|يقفل)|لسان(ي|ها|ه) (ثقيل|منتفخ|ورم|كبر))/, 'airway', 'ضيق أو صعوبة في التنفس'],
  // swelling of the face / eyes / lips / tongue (any order, within the same sentence)
  [new RegExp(`(${SWELL}[^.،؟?]{0,45}${FACE}|${FACE}[^.،؟?]{0,45}${SWELL})`), 'face_swelling', 'تورم في الوجه أو العين أو الشفاه'],
  [/(مو قادر(ه)?|ما اقدر|ما قدرت) افتح عيني/, 'face_swelling', 'تورم في الوجه أو العين أو الشفاه'],
  // burns, blisters, raw or weeping skin, wounds after a product or procedure
  [/(فقاعات|فقاعه|بثور مائيه|نفطات|حروق|حرق شديد|حرقان (قوي|شديد)|حرقت|محروق|محروقه|انحرق|يطلع (منه )?ماء|يسيل منه|جروح|جرح مفتوح|تقرحات|تقرح|قروح|يتقشر قطع|يتسلخ|تسلخ)/, 'burn_wound', 'حروق أو فقاعات أو جروح أو تقرحات'],
  // infection signs
  [/(صديد|قيح|ملتهب(ه)? جدا|التهاب شديد|عدوى)/, 'infection_fever', 'علامات التهاب أو عدوى أو حرارة'],
  // fever only counts together with a skin sign (not "حرارة الجو")
  [/((حراره|سخونه|حمى)[^.؟?]{0,40}(طفح|حبه|حبوب|جرح|التهاب|ورم|بقع)|(طفح|حبه|حبوب|جرح|التهاب|ورم|بقع)[^.؟?]{0,40}(حراره|سخونه|حمى))/, 'infection_fever', 'علامات التهاب أو عدوى أو حرارة'],
  // spreading rash / very severe itch
  [/(طفح[^.،؟?]{0,25}(كل|منتشر|انتشر|جسمي|الجسم|شديد)|(جسمي|جسمها|الجسم) كله طفح|كل (جسمي|الجسم)[^.،؟?]{0,15}طفح|حكه (شديده|قويه)[^.،؟?]{0,30}(انتشر|ما خلتني|ما اقدر انام|ما نمت)|حكه شديده جدا|ما خلتني انام)/, 'severe_rash', 'طفح منتشر أو حكة شديدة'],
  // a changing / bleeding mole
  [/(شامه|شامات|الشامه|خال|حسنه|الحسنه)[^.،؟?]{0,30}(تتغير|تغير|كبرت|تكبر|غامق|لونها|شكلها|تنزف|ينزف|نزفت|نزف|تحك)/, 'mole_change', 'تغيّر أو نزيف في شامة'],
  [/(نزيف|ينزف|تنزف)/, 'bleeding', 'نزيف'],
];
const REFERRAL: [RegExp, string, string][] = [
  [/(حامل|حمل|مرضع|ارضع|رضاعه|ارضاع)/, 'pregnancy', 'الحمل أو الرضاعة: يُسأل الطبيب أو الصيدلي قبل المنتجات ذات المواد الفعالة.'],
  [/(روكتان|ايزوتريتينوين|isotretinoin|كورتيزون|بيتاميثازون|هيدروكورتيزون|مضاد حيوي|دواء من الدكتور|وصفه طبيه|علاج من الدكتور)/, 'medication', 'أدوية أو علاجات طبية: القرار للطبيب أو الصيدلي.'],
  [/(طفل|طفله|طفلي|طفلتي|رضيع|رضيعه|ولدي|بنتي|عمره (سنه|سنتين|[1-9] ?سن|[1-9] ?شهر)|عمرها (سنه|سنتين|[1-9] ?سن|[1-9] ?شهر))[^.؟?]{0,40}(اكزيما|طفح|حساسيه|حبوب|جفاف|قشره|حكه|بقع)/, 'child', 'الأطفال: يُستشار الطبيب أو الصيدلي عند أي مشكلة جلدية.'],
  [/(عمره|عمرها) ?(1[0-7]|[1-9])\b/, 'minor', 'العمر أقل من 18: المواد الفعالة تُستعمل بعد استشارة صيدلي أو طبيب.'],
  [/(اكزيما|صدفيه|بهاق|ثعلبه)/, 'skin_disease', 'حالة جلدية تحتاج تشخيصًا وعلاجًا من طبيب الجلدية.'],
  [/((بقع|بقعه) (دائريه|دائري|مستديره)|بقعه صلعا|بقعه صلعاء|بقع صلع|صلعه|فراغات في الراس|خصل كامله|خصل كبيره|يطيح خصل|تساقط مفاجئ|طاح فجاه|فجاه)/, 'sudden_hair_loss', 'التساقط المفاجئ أو على شكل بقع يحتاج تقييم طبيب جلدية مبكرًا.'],
  [/(من سنين|من شهور|من زمان|ما يروح|ما تروح|ما راح|ما راحت|يتكرر|مستمر)/, 'persistent', 'الأعراض المستمرة أو المتكررة رغم العناية تستحق تقييم طبيب جلدية.'],
  [/(حفر|ندب|ندبات|مؤلمه جدا|حبوب مؤلمه|حبوب كبيره تحت الجلد)/, 'severe_acne', 'الحبوب المؤلمة أو التي تترك ندبات تحتاج تقييم طبيب جلدية.'],
];
const NEG = /(ما فيه|مافيه|ما في|مافي|بدون|لا يوجد|ما عندي|ماعندي|مو|مش|ما صار|ما يصير|بلا|ليس|ما تسبب|ما يسبب)\s+$/;

// cosmetic under-eye puffiness asked about as a product need is not an allergic swelling ("كريم يخفف انتفاخ تحت العين")
export const COSMETIC_PUFFINESS = /(انتفاخ|انتفاخات|نفخه) (تحت|حول) (ال)?(عين|عيون)[^.؟?]{0,25}(صباح|الصبح|هالات|سهر|نوم)|(كريم|سيروم|جل|ماسك)[^.؟?]{0,20}(يخفف|لتخفيف|يقلل|يشد)[^.؟?]{0,15}(انتفاخ|انتفاخات)/;
function hits(q: string, table: [RegExp, string, string][], kind: SafetyHit['kind']): SafetyHit[] {
  const out: SafetyHit[] = [];
  for (const [re, code, label] of table) {
    const m = re.exec(q); if (!m) continue;
    if (code === 'face_swelling' && COSMETIC_PUFFINESS.test(q) && !/(بعد|من) (ال)?(كريم|مرطب|ماسك|منتج|كحل|مكياج|صبغه|عطر)/.test(q)) continue;
    const before = q.slice(Math.max(0, m.index - 14), m.index);
    if (NEG.test(before)) continue;   // "ما فيه تورم" / "بدون حكة"
    if (!out.some((h) => h.code === code)) out.push({ kind, code, label_ar: label });
  }
  return out;
}

/** urgent → escalate, no cosmetic products. referral → answer may continue but the referral is shown first. */
/** under-eye puffiness asked about as a cosmetic need, with no product reaction mentioned */
export const isCosmeticPuffiness = (q: string) => COSMETIC_PUFFINESS.test(q) && !/(بعد|من) (ال)?(كريم|مرطب|ماسك|منتج|كحل|مكياج|صبغه|عطر)/.test(q);
export function assessSafetyCp08(text: string): { urgent: SafetyHit[]; referrals: SafetyHit[] } {
  const q = normAr(text);
  return { urgent: hits(q, URGENT, 'urgent'), referrals: hits(q, REFERRAL, 'referral') };
}
