---
license: mit
base_model: intfloat/multilingual-e5-small
language:
- multilingual
library_name: gguf
tags:
- embeddings
- sentence-similarity
- feature-extraction
- gguf
- llama.cpp
- e5
pipeline_tag: feature-extraction
---

# multilingual-e5-small — GGUF (F16)

A GGUF (F16) conversion of [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small),
for serving embeddings with `llama.cpp` / `llama-server --embeddings`.

- **Dimensions:** 384
- **Pooling:** mean (required)
- **Normalization:** L2 (use cosine similarity)
- **Context length:** 512 tokens
- **Architecture:** XLM-RoBERTa (BERT-family encoder)
- **License:** MIT (inherited from the base model)

## Prefixes are mandatory

`multilingual-e5-small` was trained with asymmetric prefixes. You **must** prepend:

- `query: ` to search queries
- `passage: ` to documents being indexed

Retrieval quality collapses without them.

## Usage with llama-server

```bash
llama-server -m multilingual-e5-small-f16.gguf --embeddings --pooling mean -c 512
```

Then POST to the OpenAI-compatible endpoint:

```bash
curl http://127.0.0.1:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "multilingual-e5-small-f16.gguf", "input": ["query: what is retrieval augmented generation"]}'
```

## Fidelity

F16 embeddings track the reference `sentence-transformers` output closely
(cosine similarity min 0.9976, mean 0.9992 across a 20-sentence multilingual
sample spanning English, French and Chinese); the small residual is dominated
by SentencePiece tokenization differences, and top-1 ranking is preserved.

## Conversion

Converted from the original safetensors weights with `convert_hf_to_gguf.py`
from [llama.cpp](https://github.com/ggml-org/llama.cpp).
