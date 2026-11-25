#include "runtime.hpp"
#include <algorithm>
#include <stdexcept>
#include <thread>
#include <vector>
#include <chrono>
using Clock=std::chrono::steady_clock;
static double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}

void LocalRuntime::unload() {
    if (context) llama_free(context);
    if (model) llama_model_free(model);
    context=nullptr; model=nullptr;
}
void LocalRuntime::reset() { if(context) llama_memory_clear(llama_get_memory(context), true); }
void LocalRuntime::load(const std::string &path) {
    auto start=Clock::now();
    unload(); cancelled=false;
    llama_backend_init();
    auto mp=llama_model_default_params(); mp.n_gpu_layers=0; mp.load_mode=LLAMA_LOAD_MODE_MMAP;
    model=llama_model_load_from_file(path.c_str(),mp);
    if(!model) throw std::runtime_error("MODEL_INVALID");
    auto cp=llama_context_default_params(); cp.n_ctx=2048; cp.n_batch=128;
    cp.n_threads=std::min(4u,std::max(1u,std::thread::hardware_concurrency())); cp.n_threads_batch=cp.n_threads;
    cp.abort_callback=[](void *p) { return static_cast<LocalRuntime*>(p)->cancelled.load(); }; cp.abort_callback_data=this;
    context=llama_init_from_model(model,cp);
    if(!context) { unload(); throw std::runtime_error("CONTEXT_FAILED"); }
    load_ms=elapsed(start);
}
std::string LocalRuntime::generate(const std::string &prompt,int limit,const std::function<void(const std::string&)> &progress) {
    if(!context) throw std::runtime_error("MODEL_MISSING");
    auto start=Clock::now(); generated_tokens=0;first_token_ms=0;reset();
    auto vocab=llama_model_get_vocab(model);
    int n=-llama_tokenize(vocab,prompt.c_str(),prompt.size(),nullptr,0,true,true);
    if(n<=0 || n>1536) throw std::runtime_error("CONTEXT_LIMIT");
    std::vector<llama_token> tokens(n);
    if(llama_tokenize(vocab,prompt.c_str(),prompt.size(),tokens.data(),n,true,true)<0) throw std::runtime_error("TOKENIZE_FAILED");
    for(int i=0;i<n;i+=128) {
        if(cancelled) throw std::runtime_error("CANCELLED");
        if(llama_decode(context,llama_batch_get_one(tokens.data()+i,std::min(128,n-i)))) throw std::runtime_error(cancelled?"CANCELLED":"DECODE_FAILED");
    }
    // Upstream grammar sampler guarantees JSON structure; scientific meaning is still independently validated.
    const char *grammar=R"GBNF(
root ::= "{" ws "\"sentences\"" ws ":" ws "[" ws sentence (ws "," ws sentence){0,3} ws "]" ws "}"
sentence ::= "{" ws "\"text\"" ws ":" ws string ws "," ws "\"claim_ids\"" ws ":" ws "[" ws string (ws "," ws string){0,2} ws "]" ws "}"
string ::= "\"" ([^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4}))* "\""
ws ::= [ \t\n\r]*
)GBNF";
    auto sampler=llama_sampler_chain_init(llama_sampler_chain_default_params());
    auto gs=llama_sampler_init_grammar(vocab,grammar,"root");
    if(!gs){llama_sampler_free(sampler);throw std::runtime_error("GRAMMAR_FAILED");}
    llama_sampler_chain_add(sampler,gs);llama_sampler_chain_add(sampler,llama_sampler_init_greedy());
    std::string output;
    try {
        for(int i=0;i<std::min(limit,384);i++) {
            if(cancelled) throw std::runtime_error("CANCELLED");
            auto tok=llama_sampler_sample(sampler,context,-1);
            if(llama_vocab_is_eog(vocab,tok)) break;
            if(generated_tokens++==0)first_token_ms=elapsed(start);
            std::vector<char> piece(256); int len=llama_token_to_piece(vocab,tok,piece.data(),piece.size(),0,true);
            if(len<0) {piece.resize(-len);len=llama_token_to_piece(vocab,tok,piece.data(),piece.size(),0,true);}
            if(len>0) output.append(piece.data(),len);
            // Raw bytes stay native: only a token count is emitted before scientific validation.
            progress(std::to_string(i+1));
            if(llama_decode(context,llama_batch_get_one(&tok,1))) throw std::runtime_error(cancelled?"CANCELLED":"DECODE_FAILED");
        }
    } catch(...) { llama_sampler_free(sampler);reset();throw; }
    generation_ms=elapsed(start);llama_sampler_free(sampler);reset();return output;
}
