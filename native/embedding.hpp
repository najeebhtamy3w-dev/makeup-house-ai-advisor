#pragma once
#include "llama.h"
#include <atomic>
#include <string>
#include <vector>

/** Dedicated E5 encoder, serialized by its owner. Never a replacement for the generative model.
 * The owner verifies the pinned model SHA before load and unloads the LLM when required by RAM policy.
 */
class LocalEmbedding {
    llama_model *model=nullptr;
    llama_context *context=nullptr;
    std::atomic<bool> *cancelled=nullptr;
public:
    ~LocalEmbedding(){unload();}
    LocalEmbedding()=default;
    LocalEmbedding(const LocalEmbedding&)=delete;
    LocalEmbedding& operator=(const LocalEmbedding&)=delete;
    void load(const std::string &path,std::atomic<bool> &cancel);
    void unload();
    bool loaded()const{return context!=nullptr;}
    // Prefix is mandatory in E5, even for Arabic. Input must fit 256 tokens; no silent truncation.
    std::vector<float> encode(const std::string &text,bool query);
    std::vector<std::vector<float>> encodeMany(const std::vector<std::string>&texts,bool query);
    double load_ms=0,last_encode_ms=0;
    int last_input_tokens=0;
    static constexpr int dimensions=384;
};
