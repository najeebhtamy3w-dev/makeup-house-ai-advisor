#include "runtime.hpp"
#include <fstream>
#include <iostream>
#include <stdexcept>
int main(int argc,char**argv){
 if(argc!=3)return 2;
 try{
  LocalRuntime r;int passed=0;
  try{r.generate("test",4,[](auto){});throw std::logic_error("accepted missing model");}catch(const std::runtime_error &e){if(std::string(e.what())!="MODEL_MISSING")throw;}passed++;
  try{r.load("/no/such/model.gguf");throw std::logic_error("accepted missing file");}catch(const std::runtime_error &e){if(std::string(e.what())!="MODEL_INVALID")throw;}passed++;
  std::string bad=std::string(argv[2])+".invalid";{std::ofstream corrupt(bad);corrupt<<"not a GGUF";}
  try{r.load(bad);throw std::logic_error("accepted corrupt file");}catch(const std::runtime_error &e){if(std::string(e.what())!="MODEL_INVALID")throw;}std::remove(bad.c_str());passed++;
  std::ifstream f(argv[2]);std::string prompt((std::istreambuf_iterator<char>(f)),{});
  r.load(argv[1]);passed++;
  int events=0;try{r.generate(prompt,64,[&](auto){if(++events==3)r.cancelled=true;});throw std::logic_error("did not cancel");}catch(const std::runtime_error&e){if(std::string(e.what())!="CANCELLED")throw;}if(events!=3)throw std::logic_error("stream count");passed++;
  r.cancelled=false;auto first=r.generate(prompt,128,[](auto){});if(first.empty())throw std::logic_error("empty generation");passed++;
  r.reset();auto second=r.generate(prompt,128,[](auto){});if(first!=second)throw std::logic_error("context leaked");passed++;
  try{r.generate(std::string(30000,'x'),4,[](auto){});throw std::logic_error("accepted overflow");}catch(const std::runtime_error&e){if(std::string(e.what())!="CONTEXT_LIMIT")throw;}passed++;
  r.unload();try{r.generate(prompt,4,[](auto){});throw std::logic_error("accepted unloaded model");}catch(const std::runtime_error&e){if(std::string(e.what())!="MODEL_MISSING")throw;}passed++;
  std::cout<<"PASSED "<<passed<<" real native host lifecycle checks (NOT ANDROID)\n";return 0;
 }catch(const std::exception&e){std::cerr<<"FAILED "<<e.what()<<"\n";return 1;}
}
