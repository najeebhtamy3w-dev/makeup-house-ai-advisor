# CP07 — isolated open-source AI prototype

**Not part of the app.** Nothing here is imported by `server/`, `web/`, `mobile/` or `android/`. No weights in Git.

## What it does
`engine.ts` defines `AIEngineAdapter` (`initialize / generate / cancel / healthCheck / dispose`) and three modes:

| Mode | Engine | Notes |
|---|---|---|
| `LOCAL_RULES` | CP07 knowledge engine (`server/src/cp07/answer.ts`) | default and the fallback for every failure |
| `LOCAL_MODEL` | `LlamaCppEngine` — llama.cpp via `node-llama-cpp` 3.22.3 (MIT), CPU only | may only **rephrase** grounded items; `groundingCheck()` validates; any failure → LOCAL_RULES |
| `REMOTE_MODEL_OPTIONAL` | `MockRemoteEngine` only | no cloud call, no key, no cost |

Safety stops, out-of-scope questions and "insufficient evidence" answers are never sent to a model.

## Run (dev machine, CPU)
```bash
cd experiments/cp07-open-source-ai && npm ci && cd ../..
# weights are NOT in Git — download Apache-2.0 GGUF files, e.g.:
#   https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf
#   https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
#   https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf
#   https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf
#   https://huggingface.co/ggml-org/SmolLM3-3B-GGUF/resolve/main/SmolLM3-Q4_K_M.gguf
# verify SHA-256 against docs/CP07_LICENSE_AND_DEPENDENCY_AUDIT.md
node --no-warnings --import tsx experiments/cp07-open-source-ai/bench-model.ts /path/Qwen3-1.7B-Q8_0.gguf --no-think
```
`--no-think` appends `/no_think` for Qwen3 / SmolLM3 (disables the reasoning trace).
Results go to `docs/cp07/models/<model>.json` (summary + every raw output for human review).

## Inputs
Synthetic catalogue (`scripts/cp07-benchmark.ts → syntheticCatalogue`), the seeded knowledge base, and held-out questions from `tests/fixtures/cp07-benchmark.ts`. No shop data, no customer text, no network during inference.

## Tests
`tests/cp07.test.ts` exercises the hybrid modes with `MockRemoteEngine` (grounded echo accepted; fabrication and outage fall back; safety never rephrased). The real-model runs are benchmarks, not unit tests (weights are not in CI).

## Rollback
Delete this folder. Nothing else depends on it.
