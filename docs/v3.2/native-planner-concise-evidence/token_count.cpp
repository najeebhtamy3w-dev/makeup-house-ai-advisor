#include "llama.h"
#include <fstream>
#include <iostream>
#include <iterator>
int main(int argc,char**argv){if(argc<3)return 2;llama_backend_init();auto mp=llama_model_default_params();mp.vocab_only=true;auto m=llama_model_load_from_file(argv[1],mp);if(!m)return 1;for(int i=2;i<argc;i++){std::ifstream f(argv[i]);std::string s((std::istreambuf_iterator<char>(f)),{});auto n=-llama_tokenize(llama_model_get_vocab(m),s.c_str(),s.size(),nullptr,0,true,true);std::cout<<argv[i]<<":"<<n<<"\n";}llama_model_free(m);return 0;}
