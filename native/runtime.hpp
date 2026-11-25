#pragma once
#include "llama.h"
#include <atomic>
#include <functional>
#include <string>

// One owner (the plugin's serial executor). Cancellation alone is cross-thread.
class LocalRuntime {
    llama_model *model = nullptr;
    llama_context *context = nullptr;
public:
    std::atomic<bool> cancelled{false};
    double load_ms=0, first_token_ms=0, generation_ms=0;
    int generated_tokens=0;
    ~LocalRuntime() { unload(); }
    void load(const std::string &path);
    void unload();
    void reset();
    std::string generate(const std::string &prompt, int limit, const std::function<void(const std::string&)> &progress);
};
