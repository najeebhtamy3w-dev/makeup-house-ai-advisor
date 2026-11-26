// Standalone actual native vision smoke harness; synthetic fixtures, NOT Android or product acceptance.
#include "../native/vision.hpp"
#include "nlohmann/json.hpp"
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
#include <stdexcept>
#include <thread>
#include <chrono>
using json=nlohmann::json;
int main(int argc,char**argv){
 if(argc!=5){std::cerr<<"MODEL PROJECTOR IMAGE_A IMAGE_B\n";return 2;}
 std::atomic<bool> cancelled{false};llama_backend_init();auto mp=llama_model_default_params();mp.n_gpu_layers=0;mp.load_mode=LLAMA_LOAD_MODE_MMAP;
 auto*model=llama_model_load_from_file(argv[1],mp);if(!model)return 3;
 auto cp=llama_context_default_params();cp.n_ctx=4096;cp.n_batch=128;cp.n_threads=2;cp.n_threads_batch=2;cp.abort_callback=[](void*p){return static_cast<std::atomic<bool>*>(p)->load();};cp.abort_callback_data=&cancelled;
 auto*ctx=llama_init_from_model(model,cp);if(!ctx){llama_model_free(model);return 4;}
 int exit_code=0;
 {LocalVision vision;
 try{
  vision.load(argv[2],model,cancelled);
  for(int i=3;i<5;i++){
   std::ifstream file(argv[i],std::ios::binary);std::vector<unsigned char> image((std::istreambuf_iterator<char>(file)),{});
   auto r=vision.generate(ctx,model,image.data(),image.size(),"اذكر الكلمات الكبيرة ولون الملصق وشكل العبوة باختصار شديد، وصرح بما لم تقرأه.",128,cancelled);
   std::cout<<json({{"image",argv[i]},{"text",r.text},{"finish_reason",r.finish_reason},{"input_tokens",r.input_tokens},{"image_tokens",r.image_tokens},{"output_tokens",r.output_tokens},{"projector_load_ms",r.projector_load_ms},{"image_prefill_ms",r.image_prefill_ms},{"first_token_ms",r.first_token_ms},{"generation_ms",r.generation_ms},{"validated",false}}).dump()<<std::endl;
  }
  // Cancel BEFORE decoding, then recover on the next call using the same model/projector.
  cancelled=true;
  try{vision.generate(ctx,model,nullptr,0,"سؤال",16,cancelled);throw std::runtime_error("cancel not enforced");}catch(const std::runtime_error&e){if(std::string(e.what())!="CANCELLED")throw;}
  cancelled=false;std::cout<<json({{"pre_cancel","PASS"},{"projector_loaded_after_cancel",vision.loaded()}}).dump()<<std::endl;
  std::ifstream next(argv[3],std::ios::binary);std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(next)),{});
  std::thread interrupter([&]{std::this_thread::sleep_for(std::chrono::milliseconds(100));cancelled=true;});
  std::string cancel_result;
  try{vision.generate(ctx,model,bytes.data(),bytes.size(),"اذكر اسم العبوة فقط.",8,cancelled);cancel_result="FAIL_NOT_CANCELLED";}catch(const std::exception&e){cancel_result=e.what();}
  interrupter.join();std::cout<<json({{"during_prefill_cancel",cancel_result}}).dump()<<std::endl;
  if(cancel_result!="CANCELLED")throw std::runtime_error("mid-request cancellation not enforced");
  cancelled=false;auto recovered=vision.generate(ctx,model,bytes.data(),bytes.size(),"اذكر اسم العبوة فقط.",8,cancelled);
  std::cout<<json({{"after_cancel_recovery",recovered.output_tokens>0?"PASS":"FAIL"},{"text",recovered.text},{"finish_reason",recovered.finish_reason},{"output_tokens",recovered.output_tokens}}).dump()<<std::endl;
 }catch(const std::exception&e){std::cout<<json({{"error",e.what()}}).dump()<<std::endl;exit_code=5;}}
 llama_free(ctx);llama_model_free(model);llama_backend_free();return exit_code;
}
