import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { retryLocalPrompt, validateLocalText } from '../server/src/local-ai.ts';
const [binary, model, directory] = process.argv.slice(2);
if (!binary || !model || !directory) throw new Error('BINARY MODEL EXISTING_EVALUATION_DIRECTORY required');
const source = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
const results = [];
for (let i = 0; i < source.results.length; i++) {
  const row = source.results[i];
  if (!row.validation) { results.push(row); continue; }
  const prompt = readFileSync(join(directory, `${i}-prompt.txt`), 'utf8');
  const data = JSON.parse(prompt.split('<|im_start|>user\n')[1]!.split('<|im_end|>')[0]!.replace(/\n\/no_think$/, '').trim());
  const primary = validateLocalText(readFileSync(join(directory, `${i}-raw.txt`), 'utf8').trim(), data.facts, row.question);
  if (primary.ok) { results.push({ ...row, primary, final: primary, attempts: 1 }); continue; }
  const path = join(directory, `${i}-retry-prompt.txt`); writeFileSync(path, retryLocalPrompt(prompt));
  const start = performance.now();
  const r = spawnSync(binary, [model, path], { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(directory, `${i}-retry-raw.txt`), r.stdout ?? '');writeFileSync(join(directory, `${i}-retry-native.log`), r.stderr ?? '');
  const final = validateLocalText((r.stdout ?? '').trim(), data.facts, row.question);
  results.push({ ...row, primary, final, attempts: 2, retry_exit: r.status, retry_ms: performance.now() - start });
}
writeFileSync(join(directory, 'bounded-retry-results.json'), JSON.stringify({ platform: 'Linux x86_64 HOST; NOT ANDROID', results }, null, 2));
console.log(results.map(r => ({ question: r.question, attempts: r.attempts, accepted: r.final?.ok, bypass: r.result })));
