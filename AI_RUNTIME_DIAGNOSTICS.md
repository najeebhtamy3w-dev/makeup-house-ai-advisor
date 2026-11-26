# Runtime diagnostics

Manager-only raw diagnostics invoke the real native model without intent routing, retrieval, grammar, validators or fallback. Output is explicitly unvalidated and is not an approved consultation. Metrics include model identity/revision, input/output tokens, load time, TTFT, generation time, finish reason and current loaded state. No hidden model reasoning is deliberately exposed.

Main consultation traces distinguish attempts, completed native invocations, tool calls, retrieved IDs, validation, retry, fallback reason and outcome. Running the model is not a successful generative consultation. Text is buffered until independent validation; token counts are streamed, not unverified scientific prose.

Native lifecycle 11/11, typed constraints 13/13 and parser guards 9/9 passed on Host. New Android execution, cancellation after resume, memory pressure, thermal and battery behavior remain NOT TESTED on Samsung. The owner's baseline 61-byte/6236ms snapshot is historical field evidence, not acceptance of this source.

Current integration uses CPU and the text path of a vision-capable Qwen family. Installing a separate projector alone does not enable image inference. OCR is a separate local text extractor and must not be labeled VLM.
