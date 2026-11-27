# Targeted native parity investigation — Host only

The exact earlier problematic serialized prompt (674 tokens) was evaluated without generating an answer. One SHA-verified baseline model/context used identical4096 context,128 batch/microbatch,4 CPU threads and full memory clears. Cached pinned upstream shared libraries were used for both paths. No grammar or sampler is applied before the logits comparison.

| Profile | Token IDs | Full-vocabulary first-step logits compared with wrapper |
| --- | --- | --- |
| Wrapper legacy `llama_batch_get_one` / `llama_decode` |674 IDs | Reference |
| Upstream `common_tokenize`, `common_batch_get_one` / `llama_process` | Identical674 IDs | Bit-identical:0 different logits among248320; maximum difference0 |
| Wrapper again after clearing hybrid memory | Same IDs | Bit-identical:0 different logits; maximum difference0 |

Per-chunk memory positions match the consumed prefix. `add_bos=false`; GGUF has no BOS/add-BOS override, and recognized pretokenizer=qwen35. The production closed-thinking assistant suffix matches the embedded GGUF template's default nonthinking branch. Source inspection confirms hybrid clear invokes both attention/recurrent clears and zeroes recurrent buffers. `llama_sampler_sample` accepts selected tokens internally.

These results rule out a demonstrated tokenization/BOS, prefill batch-API or initial-state-reset difference for this controlled prompt. They do not establish generation-step/sampler parity, common-init-default parity, arbitrary reset sequences or semantic quality. The older wrapper-versus-CLI generation difference remains unresolved at this stage; no runtime correction or Gate02 PASS is claimed.

## Bounded generation-step extension

The same prompt/model/context was then tested through64 generated token positions, using the exact saved v68 exported grammar for all three sampler profiles: direct grammar-then-greedy, upstream common sampler with default rejection, and upstream common sampler with grammar_first. All penalties/filtering were disabled and temperature was0. Each later profile consumed the same direct-baseline prefix even if its proposed token differed, preventing divergence from being hidden by a changed prefix.

All64 selected token IDs match in all three profiles. Full-vocabulary pre-sampling logits are bit-identical at every compared step: maximum difference0,0 differing logits. No initial sampler acceptance/mask-order/decode discrepancy was reproduced. The direct prefix still begins with intent clarify and empty fields; this proves parity, not understanding.

The previous full CLI-versus-wrapper discrepancy is not explained by tokenization, same-context batching/reset or these64 controlled decoding/sampling steps. The experiment does not claim every CLI initialization/default matches the wrapper, later-than64-token equivalence, a repaired native defect or any conversational acceptance. Preserve the old discrepancy rather than asserting its cause. Full extension data and protocol are in generation-parity.json and generation-protocol.json; bounded run completed successfully in72seconds.

Sources: `scripts/native-parity-prefill.cpp`; reproducible compile arguments in compile-command.json. Compiled executable is outside Git; protocol files record hashes. logits.json retains token arrays, positions and top20 logits while reporting a full-vocabulary comparison. Original inputs and stderr remain intact.

The official exact nonthinking sampling configuration was already investigated in docs/v3.2/v68-core: temperature1,top_p1,top_k20,presence2,repeat1,seed680026. Saved paired outputs still failed capability/mixed-skin/follow-up understanding; do not repeat it as an untested remedy. `/no_think` text is not the official thinking-mode control for Qwen3.5, but the correct closed-thinking template is present; no causal semantic improvement follows from this observation alone.
