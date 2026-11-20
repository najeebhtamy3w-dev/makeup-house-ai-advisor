/**
 * CP06.2 Phase 5A — Scientific Safety Guardrails. Decides, BEFORE anything else is composed:
 *  - stop:     symptoms that need a health professional now → no product recommendation, a clear referral instead
 *  - referral: things a cosmetic advisor must not handle alone (medicines, pregnancy + retinoids, children, sudden hair loss…)
 *  - cautions: general care points
 * Never diagnoses, never names a medical treatment as advice. Separate from science/* (product suitability), unchanged.
 */
import { normAr } from './understand.ts';
import type { TAdvisorContext } from '../contracts.ts';

const STOP: [RegExp, string][] = [
  [/(تورم|انتفاخ|صعوبه (في )?التنفس|ضيق تنفس)/, 'تورم أو صعوبة تنفس'], [/(نزيف|ينزف|صديد|قيح|تقرح|تقرحات|جروح مفتوحه)/, 'نزيف أو صديد أو تقرحات'],
  [/(حروق|حرق شديد|فقاعات|بثور مائيه)/, 'حروق أو فقاعات'], [/(حمى|حراره مرتفعه|سخونه)/, 'حمى مع أعراض جلدية'],
  [/(طفح (شديد|منتشر)|حكه شديده جدا|حساسيه شديده)/, 'طفح أو حكة شديدة'], [/(شامه|خال) (تتغير|كبرت|تنزف|لونها تغير)/, 'تغيّر في شامة'],
  [/(عدوي|التهاب شديد)/, 'التهاب شديد أو عدوى محتملة'],
];
const REFER: [RegExp, string][] = [
  [/(مضاد حيوي|كورتيزون|كورتيزون|بيتاميثازون|روكتان|ايزوتريتينوين|حبوب للحبوب|دواء)/, 'السؤال عن أدوية أو علاجات طبية: القرار للطبيب أو الصيدلي، والمستشار التجميلي لا يصف أدوية.'],
  [/(حامل|حمل|مرضع|ارضاع)/, 'الحمل والرضاعة: يُراجع الطبيب قبل المنتجات العلاجية (مثل الريتينويدات).'],
  [/(طفل|طفله|رضيع|اطفال|بنتي الصغيره|ولدي الصغير)/, 'منتجات الأطفال والرضع: يُستشار الطبيب عند أي مشكلة جلدية.'],
  [/(مفاجئ|فجاه|بقع فارغه|بقعه صلعاء|كتل من الشعر)/, 'التساقط المفاجئ أو على شكل بقع يحتاج تقييم طبيب جلدية مبكرًا.'],
  [/(مستمر|من شهور|من زمان|ما يروح|ما راح|يتكرر)/, 'الأعراض المستمرة أو المتكررة رغم العناية تستحق تقييم طبيب جلدية.'],
];
export interface SafetyAssessment { stop: boolean; stop_reasons: string[]; referrals: string[]; flags: string[] }

export function assessSafety(text: string, ctx: TAdvisorContext): SafetyAssessment {
  const q = normAr(text); const stop_reasons = STOP.filter(([re]) => re.test(q)).map(([, why]) => why);
  const referrals = REFER.filter(([re]) => re.test(q)).map(([, msg]) => msg);
  if (ctx.using.includes('retinoid') && /(حامل|حمل)/.test(q)) referrals.push('الريتينويدات مع الحمل: يُستشار الطبيب قبل الاستمرار.');
  const flags = [...stop_reasons.length ? ['urgent'] : [], ...referrals.length ? ['referral'] : []];
  return { stop: stop_reasons.length > 0, stop_reasons, referrals: [...new Set(referrals)], flags };
}

/** what an advisor answer must never contain (checked on EVERY composed text, deterministic or AI) */
export const FORBIDDEN_OUTPUT: [RegExp, string][] = [
  [/(\d+\s*(ريال|درهم|دولار|\$|usd|sar|yer|aed))|(\$\s*\d+)|(سعر|خصم|تخفيض)/i, 'سعر'],
  [/(يعالج نهائيا|علاج نهائي|يشفي|شفاء تام|مضمون 100|نتيجه مضمونه)/, 'وعد علاجي'],
  [/(تشخيصك هو|انت مصاب|مصابه ب|لديك مرض|حالتك هي)/, 'تشخيص'],
  [/(تناولي|تناول|خذي|خذ) (حبوب|اقراص|مضاد|دواء)/, 'وصف دواء'],
];
export function outputViolations(text: string): string[] { const q = normAr(text); return FORBIDDEN_OUTPUT.filter(([re]) => re.test(q)).map(([, w]) => w); }
