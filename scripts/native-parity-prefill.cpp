// Investigative only: compare legacy wrapper batching with upstream common batching.
#include "llama.h"
#include "common.h"
#include "sampling.h"
#include "nlohmann/json.hpp"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <numeric>
#include <string>
#include <vector>
using json=nlohmann::json;
static std::string read(const char *p){std::ifstream f(p);return {std::istreambuf_iterator<char>(f),{}};}
static std::string piece(const llama_vocab *v,int id){std::vector<char>b(256);int n=llama_token_to_piece(v,id,b.data(),b.size(),0,true);if(n<0){b.resize(-n);n=llama_token_to_piece(v,id,b.data(),b.size(),0,true);}return n>0?std::string(b.data(),n):"";}
int main(int argc,char**argv){
 if(argc!=3&&argc!=4)return 2;
 llama_backend_init();auto mp=llama_model_default_params();mp.n_gpu_layers=0;mp.load_mode=LLAMA_LOAD_MODE_MMAP;
 auto model=llama_model_load_from_file(argv[1],mp);if(!model)return 3;auto v=llama_model_get_vocab(model);
 auto cp=llama_context_default_params();cp.n_ctx=4096;cp.n_batch=128;cp.n_ubatch=128;cp.n_threads=4;cp.n_threads_batch=4;
 auto ctx=llama_init_from_model(model,cp);if(!ctx)return 4;auto prompt=read(argv[2]);
 int n=-llama_tokenize(v,prompt.data(),prompt.size(),nullptr,0,true,true);std::vector<llama_token>tokens(n);
 llama_tokenize(v,prompt.data(),prompt.size(),tokens.data(),n,true,true);
 auto upstream_tokens=common_tokenize(ctx,prompt,true,true);
 json out={{"scope","HOST_PREFILL_INVESTIGATION_NOT_SEMANTIC_ACCEPTANCE"},{"tokens",tokens},{"common_tokens",upstream_tokens},{"same_tokens",tokens==upstream_tokens},{"add_bos",llama_vocab_get_add_bos(v)},{"add_eos",llama_vocab_get_add_eos(v)},{"bos_id",llama_vocab_bos(v)},{"first_token",tokens.front()},{"last_token",tokens.back()},{"profiles",json::array()}};
 std::vector<float>baseline;int nv=llama_vocab_n_tokens(v);
 for(int profile=0;profile<3;profile++){
  // Third profile repeats the wrapper after both caches have been cleared.
  llama_memory_clear(llama_get_memory(ctx),true);
  json positions=json::array();
  for(int i=0;i<n;i+=128){int count=std::min(128,n-i);int rc;
   if(profile==1){auto b=common_batch_get_one(ctx,tokens.data()+i,count);rc=llama_process(ctx,LLAMA_PROCESS_TYPE_DECODE,b.get());}
   else rc=llama_decode(ctx,llama_batch_get_one(tokens.data()+i,count));
   if(rc){std::cerr<<"decode error "<<rc<<std::endl;return 5;}
   positions.push_back({{"input_end",i+count},{"memory_max",llama_memory_seq_pos_max(llama_get_memory(ctx),0)}});
  }
  const auto logits=llama_get_logits_ith(ctx,-1);std::vector<float>values(logits,logits+nv);if(profile==0)baseline=values;
  double maxdiff=0;int differences=0;for(int i=0;i<nv;i++){maxdiff=std::max(maxdiff,double(std::abs(values[i]-baseline[i])));differences+=values[i]!=baseline[i];}
  std::vector<int>order(nv);std::iota(order.begin(),order.end(),0);std::partial_sort(order.begin(),order.begin()+20,order.end(),[&](int a,int b){return values[a]>values[b];});json top=json::array();for(int i=0;i<20;i++)top.push_back({{"id",order[i]},{"piece",piece(v,order[i])},{"logit",values[order[i]]}});
  out["profiles"].push_back({{"name",profile==0?"wrapper_legacy_batch":profile==1?"upstream_common_batch":"wrapper_after_clear"},{"positions",positions},{"max_logit_delta_vs_wrapper",maxdiff},{"different_logits",differences},{"top20",top}});
 }
 if(argc==4){
  const auto grammar=read(argv[3]);std::vector<int>forced;std::vector<std::vector<float>>reference;
  out["generation_steps"]=json::array();
  for(int profile=0;profile<3;profile++){
   llama_memory_clear(llama_get_memory(ctx),true);
   for(int i=0;i<n;i+=128)if(llama_decode(ctx,llama_batch_get_one(tokens.data()+i,std::min(128,n-i))))return 6;
   llama_sampler*direct=nullptr;common_sampler*upstream=nullptr;
   if(profile==0){direct=llama_sampler_chain_init(llama_sampler_chain_default_params());llama_sampler_chain_add(direct,llama_sampler_init_grammar(v,grammar.c_str(),"root"));llama_sampler_chain_add(direct,llama_sampler_init_greedy());}
   else{common_params_sampling p;p.seed=680026;p.temp=0;p.top_k=0;p.top_p=1;p.min_p=0;p.penalty_last_n=0;p.penalty_repeat=1;p.penalty_present=0;p.penalty_freq=0;p.grammar=common_grammar(COMMON_GRAMMAR_TYPE_USER,grammar);upstream=common_sampler_init(model,p);}
   json steps=json::array();
   const int count=profile==0?64:static_cast<int>(forced.size());
   for(int i=0;i<count;i++){
    const auto l=llama_get_logits_ith(ctx,-1);std::vector<float>current(l,l+nv);if(profile==0)reference.push_back(current);
    double delta=0;int different=0;for(int j=0;j<nv;j++){delta=std::max(delta,double(std::abs(current[j]-reference[i][j])));different+=current[j]!=reference[i][j];}
    int selected=profile==0?llama_sampler_sample(direct,ctx,-1):common_sampler_sample(upstream,ctx,-1,profile==2);
    if(profile==0)forced.push_back(selected);
    int feed=forced[i];if(profile!=0)common_sampler_accept(upstream,feed,true);
    steps.push_back({{"step",i},{"sampled",selected},{"teacher_forced",feed},{"same_selection",selected==feed},{"piece",piece(v,selected)},{"max_logit_delta",delta},{"different_logits",different}});
    if(llama_vocab_is_eog(v,feed))break;
    if(llama_decode(ctx,llama_batch_get_one(&feed,1)))return 7;
   }
   if(direct)llama_sampler_free(direct);if(upstream)common_sampler_free(upstream);
   out["generation_steps"].push_back({{"profile",profile==0?"direct_grammar_then_greedy":profile==1?"upstream_default_rejection":"upstream_grammar_first"},{"teacher_forcing","All profiles consume direct baseline token prefix, even if proposed token differs."},{"steps",steps}});
  }
 }
 std::cout<<out.dump(2)<<std::endl;llama_free(ctx);llama_model_free(model);llama_backend_free();
}
