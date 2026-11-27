#include "embedding.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <thread>
namespace {using Clock=std::chrono::steady_clock;double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}}
void LocalEmbedding::unload(){if(context)llama_free(context);if(model)llama_model_free(model);context=nullptr;model=nullptr;cancelled=nullptr;}
void LocalEmbedding::load(const std::string &path,std::atomic<bool>&cancel){
 unload();if(cancel.load())throw std::runtime_error("EMBEDDING_CANCELLED");cancelled=&cancel;auto started=Clock::now();llama_backend_init();
 auto mp=llama_model_default_params();mp.n_gpu_layers=0;mp.load_mode=LLAMA_LOAD_MODE_MMAP;
 model=llama_model_load_from_file(path.c_str(),mp);if(!model){unload();throw std::runtime_error("EMBEDDING_MODEL_INVALID");}
 char architecture[64]{};llama_model_meta_val_str(model,"general.architecture",architecture,sizeof architecture);
 if(std::string(architecture)!="bert"||llama_model_n_embd_out(model)!=dimensions){unload();throw std::runtime_error("EMBEDDING_MODEL_UNSUPPORTED");}
 auto cp=llama_context_default_params();cp.n_ctx=256;cp.n_batch=256;cp.n_ubatch=256;cp.embeddings=true;cp.pooling_type=LLAMA_POOLING_TYPE_MEAN;cp.attention_type=LLAMA_ATTENTION_TYPE_NON_CAUSAL;
 cp.n_threads=std::min(4u,std::max(1u,std::thread::hardware_concurrency()));cp.n_threads_batch=cp.n_threads;
 cp.abort_callback=[](void *p){return static_cast<std::atomic<bool>*>(p)->load();};cp.abort_callback_data=&cancel;
 context=llama_init_from_model(model,cp);if(!context){unload();throw std::runtime_error("EMBEDDING_CONTEXT_FAILED");}
 if(llama_pooling_type(context)!=LLAMA_POOLING_TYPE_MEAN){unload();throw std::runtime_error("EMBEDDING_POOLING_INVALID");}
 load_ms=ms(started);
}
std::vector<float> LocalEmbedding::encode(const std::string &text,bool query){
 if(!context||!cancelled)throw std::runtime_error("EMBEDDING_NOT_LOADED");
 if(cancelled->load())throw std::runtime_error("EMBEDDING_CANCELLED");
 if(text.empty()||text.size()>4096)throw std::runtime_error("EMBEDDING_INPUT_SIZE");
 const auto started=Clock::now();last_encode_ms=0;last_input_tokens=0;
 const std::string input=(query?"query: ":"passage: ")+text;const auto *vocab=llama_model_get_vocab(model);
 const int needed=-llama_tokenize(vocab,input.data(),input.size(),nullptr,0,true,false);
 if(needed<1||needed>256)throw std::runtime_error("EMBEDDING_TOKEN_LIMIT");
 std::vector<llama_token> tokens(needed);if(llama_tokenize(vocab,input.data(),input.size(),tokens.data(),needed,true,false)!=needed)throw std::runtime_error("EMBEDDING_TOKENIZE_FAILED");
 last_input_tokens=needed;llama_memory_clear(llama_get_memory(context),true);
 auto batch=llama_batch_init(needed,0,1);
 if(!batch.token||!batch.pos||!batch.n_seq_id||!batch.seq_id||!batch.logits){llama_batch_free(batch);throw std::runtime_error("EMBEDDING_MEMORY");}
 batch.n_tokens=needed;for(int i=0;i<needed;i++){batch.token[i]=tokens[i];batch.pos[i]=i;batch.n_seq_id[i]=1;batch.seq_id[i][0]=0;batch.logits[i]=true;}
 const int status=llama_decode(context,batch);llama_batch_free(batch);
 if(status||cancelled->load()){llama_memory_clear(llama_get_memory(context),true);throw std::runtime_error(cancelled->load()?"EMBEDDING_CANCELLED":"EMBEDDING_DECODE_FAILED");}
 const float *raw=llama_get_embeddings_seq(context,0);if(!raw)throw std::runtime_error("EMBEDDING_OUTPUT_MISSING");
 std::vector<float> result(raw,raw+dimensions);double norm=0;for(float value:result){if(!std::isfinite(value))throw std::runtime_error("EMBEDDING_NONFINITE");norm+=double(value)*value;}
 if(norm<1e-12)throw std::runtime_error("EMBEDDING_ZERO_NORM");norm=std::sqrt(norm);for(float&value:result)value=static_cast<float>(value/norm);
 llama_memory_clear(llama_get_memory(context),true);last_encode_ms=ms(started);return result;
}
std::vector<std::vector<float>> LocalEmbedding::encodeMany(const std::vector<std::string>&texts,bool query){
 if(texts.empty()||texts.size()>64)throw std::runtime_error("EMBEDDING_BATCH_LIMIT");
 std::vector<std::vector<float>> result;result.reserve(texts.size());for(const auto &text:texts)result.push_back(encode(text,query));return result;
}
