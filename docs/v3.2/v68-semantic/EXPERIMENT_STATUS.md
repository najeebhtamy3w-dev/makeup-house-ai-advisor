# Experimental embedding boundary

LocalEmbedding in native/embedding.cpp is an isolated Host experiment only. It is not listed in CMake, JNI or the Android asset installer. Do not treat its presence as a functioning Android semantic agent.

Actual neural384-dimensional mean-pooled L2 vectors with query/passage prefixes were generated; these are not hash vectors. Q8 conversion initially failed missing token type metadata; preserved exact failure. Exploratory override was based on official type_vocab_size2, not production adoption. Alternative F16 loads without that override. Cross-language top1: Q8 0/4; F16 1/4. Same-language exploratoryF16 top1 4/4, versus lexical3/4, but four hand-sized cases are not broad retrieval acceptance.

The converted context length511 versus official configuration512 may relate to conversion of position embeddings. No causal proof or official reference implementation comparison was obtained. Do not describe the conversion as proven corrupt. No Android or Samsung inference occurred.
