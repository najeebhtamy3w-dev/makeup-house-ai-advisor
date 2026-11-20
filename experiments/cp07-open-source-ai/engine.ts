/**
 * CP07 Phase 9 — ISOLATED prototype. Not imported by the app, the Android worker or Render.
 * AIEngineAdapter + three modes:
 *   LOCAL_RULES            CP07 knowledge engine only (server/src/cp07/answer.ts) — the default and the fallback
 *   LOCAL_MODEL            same grounded items, REPHRASED by a local GGUF model via llama.cpp (node-llama-cpp, MIT)
 *   REMOTE_MODEL_OPTIONAL  interface only, MockRemoteEngine — no cloud service, no key, no cost
 * The model never retrieves, never decides suitability, never adds facts: it receives the grounded items with ids and may
 * only rewrite them. groundingCheck() (server/src/cp07/answer.ts) validates every output; any failure → LOCAL_RULES text.
 */
import { answerCp07, groundingCheck, type Cp07Answer, type Cp07Deps } from '../../server/src/cp07/answer.ts';
import type { DB } from '../../server/src/db.ts';
import type { TAdvisorContext } from '../../server/src/contracts.ts';

export interface GenerateOptions { maxTokens?: number; temperature?: number; timeoutMs?: number; jsonSchema?: object }
export interface Health { ok: boolean; engine: string; model?: string; detail?: string }
export interface AIEngineAdapter {
  readonly id: string;
  initialize(): Promise<void>;
  generate(system: string, user: string, opts?: GenerateOptions): Promise<{ text: string; tokens: number; ms: number }>;
  cancel(): void;
  healthCheck(): Promise<Health>;
  dispose(): Promise<void>;
}

/* ---------------- llama.cpp (node-llama-cpp) ---------------- */
// runtime-only specifier: the main project's type check and tests must not need this experiment's dependency installed
const LLAMA_PKG = 'node-llama-cpp';
export class LlamaCppEngine implements AIEngineAdapter {
  readonly id: string; private llama: any; private model: any; private ctx: any; private abort: AbortController | null = null;
  constructor(private modelPath: string, private contextSize = 4096, private threads = 4, private noThink = false) { this.id = `llama.cpp:${modelPath.split('/').pop()}`; }
  async initialize() {
    const { getLlama } = await import(LLAMA_PKG);
    this.llama = await getLlama({ gpu: false });
    this.model = await this.llama.loadModel({ modelPath: this.modelPath });
    this.ctx = await this.model.createContext({ contextSize: this.contextSize, threads: this.threads });
  }
  async generate(system: string, user: string, opts: GenerateOptions = {}) {
    const { LlamaChatSession } = await import(LLAMA_PKG);
    const seq = this.ctx.getSequence();
    const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: system });
    this.abort = new AbortController(); const timer = setTimeout(() => this.abort?.abort(), opts.timeoutMs ?? 120_000);
    const t0 = performance.now(); let tokens = 0;
    try {
      const grammar = opts.jsonSchema ? await this.llama.createGrammarForJsonSchema(opts.jsonSchema) : undefined;
      const text: string = await session.prompt(this.noThink ? `${user} /no_think` : user, { maxTokens: opts.maxTokens ?? 300, temperature: opts.temperature ?? 0.2, signal: this.abort.signal, stopOnAbortSignal: true, grammar, onTextChunk: () => { tokens++; } });
      return { text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), tokens, ms: performance.now() - t0 };
    } finally { clearTimeout(timer); session.dispose?.(); seq.dispose?.(); }
  }
  cancel() { this.abort?.abort(); }
  async healthCheck(): Promise<Health> { return { ok: Boolean(this.ctx), engine: 'llama.cpp', model: this.modelPath.split('/').pop() }; }
  async dispose() { await this.ctx?.dispose?.(); await this.model?.dispose?.(); await this.llama?.dispose?.(); this.ctx = this.model = this.llama = null; }
}

/* ---------------- REMOTE_MODEL_OPTIONAL: mock only ---------------- */
export class MockRemoteEngine implements AIEngineAdapter {
  readonly id = 'mock-remote'; constructor(private behaviour: 'echo_grounded' | 'fabricate' | 'down' = 'echo_grounded') {}
  async initialize() {}
  async generate(_s: string, user: string) {
    if (this.behaviour === 'down') throw new Error('unavailable');
    const lines = [...user.matchAll(/^- \[([^\]]+)\] (.+)$/gm)].map((m) => `${m[2]} [${m[1]}]`);
    const text = this.behaviour === 'fabricate' ? 'دراسة حديثة أثبتت أن هذا الكريم يعالج الحبوب 100% [pm-99999999] https://example.com' : lines.slice(0, 3).join('\n');
    return { text, tokens: text.length / 4, ms: 1 };
  }
  cancel() {}
  async healthCheck(): Promise<Health> { return { ok: this.behaviour !== 'down', engine: 'mock-remote' }; }
  async dispose() {}
}

/* ---------------- hybrid advisor ---------------- */
export const SYSTEM_AR = 'أنت مساعد صياغة لموظفي محل تجميل. أعد صياغة المعلومات المعطاة فقط بالعربية الواضحة في 3 إلى 5 جمل قصيرة. ' +
  'ممنوع إضافة أي معلومة أو رقم أو منتج أو مصدر غير موجود في القائمة. بعد كل جملة اكتب رمز المعلومة بين قوسين مربعين كما هو، مثل [dry_skin-2]. ' +
  'لا تكتب روابط. لا تشخّص ولا تصف دواء. إذا كانت المعلومات غير كافية فقل ذلك.';
export function groundedPrompt(a: Cp07Answer, question: string) {
  const items = a.sections.flatMap((s) => s.items).filter((i) => i.claim_id);
  return { items, user: `سؤال الموظف: ${question}\nالمعلومات المسموح بها فقط:\n${items.map((i) => `- [${i.claim_id}] ${i.text}`).join('\n')}\nاكتب الإجابة الآن.` };
}

export type Mode = 'LOCAL_RULES' | 'LOCAL_MODEL' | 'REMOTE_MODEL_OPTIONAL';
export interface HybridResult { mode_requested: Mode; mode_used: Mode; text: string; model_text?: string; grounding?: { ok: boolean; problems: string[] }; fallback_reason?: string; model_ms?: number; answer: Cp07Answer }
export async function hybridAnswer(db: DB, question: string, mode: Mode, engine: AIEngineAdapter | null, deps: Cp07Deps = {}, ctx?: TAdvisorContext, timeoutMs = 60_000): Promise<HybridResult> {
  const a = answerCp07(db, question, ctx, { ...deps, logGaps: false });
  const base: HybridResult = { mode_requested: mode, mode_used: 'LOCAL_RULES', text: a.text, answer: a };
  if (mode === 'LOCAL_RULES' || !engine) return { ...base, fallback_reason: mode === 'LOCAL_RULES' ? undefined : 'no engine' };
  // safety stops, out-of-scope and "insufficient evidence" answers are never rephrased by a model
  if (a.understanding.medical_red_flags.length || a.understanding.intent === 'out_of_scope' || !a.used_claim_ids.length) return { ...base, fallback_reason: 'not eligible for rephrasing (safety/scope/no evidence)' };
  const { items, user } = groundedPrompt(a, question);
  try {
    const h = await engine.healthCheck(); if (!h.ok) return { ...base, fallback_reason: 'engine unhealthy' };
    const r = await engine.generate(SYSTEM_AR, user, { maxTokens: 260, temperature: 0.2, timeoutMs });
    const check = groundingCheck(r.text, { claim_ids: items.map((i) => i.claim_id!), claim_texts: items.map((i) => i.text), source_ids: [...new Set(items.flatMap((i) => i.source_ids))], product_names: (a.products?.items ?? []).map((p) => p.name) });
    const arabicRatio = (r.text.match(/[؀-ۿ]/g)?.length ?? 0) / Math.max(1, (r.text.match(/\p{L}/gu)?.length ?? 0));
    if (arabicRatio < 0.7) check.problems.push(`non-Arabic output (${Math.round(arabicRatio * 100)}% Arabic letters)`);
    if (/[一-鿿]/.test(r.text)) check.problems.push('CJK characters in output');
    check.ok = !check.problems.length;
    if (!check.ok) return { ...base, model_text: r.text, grounding: check, fallback_reason: 'grounding check failed', model_ms: r.ms };
    return { mode_requested: mode, mode_used: mode, text: `${r.text}\n${a.text.split('\n').filter((l) => l.startsWith('【منتجات') || l.startsWith('【المصادر') || l.startsWith('- ') || l.startsWith('حالة المعلومة')).join('\n')}`, model_text: r.text, grounding: check, model_ms: r.ms, answer: a };
  } catch (e) { return { ...base, fallback_reason: `engine error: ${(e as Error).message}` }; }
}
