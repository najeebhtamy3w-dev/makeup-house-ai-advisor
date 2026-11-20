/** CP08 — scores BLIND_SAFETY once. Run: node --no-warnings --import tsx scripts/cp08-safety-blind.ts */
import { writeFileSync } from 'node:fs';
import { understandCp07 } from '../server/src/cp07/nlu.ts';
import { understand } from '../server/src/advisor2/understand.ts';
import { assessSafety } from '../server/src/advisor2/safety.ts';
import { BLIND_SAFETY } from '../tests/fixtures/cp08-natural-eval.ts';
const rows = BLIND_SAFETY.map((x) => {
  const u = understandCp07(x.text); const o = assessSafety(x.text, understand(x.text).ctx);
  const kind = x.gold.red_flag ? 'urgent' : x.gold.referral ? 'referral' : 'benign';
  const ok = kind === 'urgent' ? u.medical_red_flags.length > 0 : kind === 'referral' ? (u.referrals.length > 0 || u.medical_red_flags.length > 0) : u.medical_red_flags.length === 0;
  const okOld = kind === 'urgent' ? o.stop : kind === 'referral' ? (o.referrals.length > 0 || o.stop) : !o.stop;
  return { id: x.id, kind, text: x.text, cp08_ok: ok, cp06_2_ok: okOld, codes: u.safety_codes };
});
const r = (k: string, f: 'cp08_ok' | 'cp06_2_ok') => { const v = rows.filter((x) => x.kind === k); return `${v.filter((x) => x[f]).length}/${v.length}`; };
const summary = { urgent: { cp08: r('urgent', 'cp08_ok'), cp06_2: r('urgent', 'cp06_2_ok') }, referral: { cp08: r('referral', 'cp08_ok'), cp06_2: r('referral', 'cp06_2_ok') }, benign_no_false_alarm: { cp08: r('benign', 'cp08_ok'), cp06_2: r('benign', 'cp06_2_ok') } };
writeFileSync('docs/cp08/safety-blind.json', JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const x of rows.filter((x) => !x.cp08_ok)) console.log('MISS', x.id, x.kind, x.text, x.codes);
