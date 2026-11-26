#pragma once
#include "llama.h"
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

struct mtmd_context;
struct VisionResult {
    std::string text, finish_reason;
    int input_tokens=0, image_tokens=0, output_tokens=0;
    double projector_load_ms=0, image_prefill_ms=0, first_token_ms=0, generation_ms=0;
};
/** Owner must serialize with text inference and free this BEFORE unloading its llama_model.
 *  This produces UNVALIDATED visual observations only; never an approved product/scientific claim.
 */
class LocalVision {
    mtmd_context *vision=nullptr;
    const llama_model *text_model=nullptr;
    std::string projector_path;
    double load_ms=0;
public:
    LocalVision()=default;
    LocalVision(const LocalVision&)=delete;
    LocalVision& operator=(const LocalVision&)=delete;
    ~LocalVision();
    void unload();
    bool loaded() const {return vision!=nullptr;}
    void load(const std::string &path,const llama_model *model,std::atomic<bool> &cancelled);
    VisionResult generate(llama_context *context,const llama_model *model,
        const unsigned char *encoded,size_t size,const std::string &question,int limit,
        std::atomic<bool> &cancelled,const std::function<void(int)> &progress={});
    // Header validation occurs BEFORE a native image decoder can allocate an unbounded bitmap.
    static void validate_image(const unsigned char *encoded,size_t size);
};
