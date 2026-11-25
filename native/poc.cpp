#include "runtime.hpp"
#include <fstream>
#include <iostream>
#include <sstream>
int main(int argc,char **argv) {
    try {
        if(argc<3) return 2;
        std::ifstream f(argv[2]);std::stringstream s;s<<f.rdbuf();
        LocalRuntime r;r.load(argv[1]);
        std::cout<<r.generate(s.str(),384,[](auto){})<<std::endl;
        std::cerr<<"\nMETRICS {\"load_ms\":"<<r.load_ms<<",\"first_token_ms\":"<<r.first_token_ms<<",\"generation_ms\":"<<r.generation_ms<<",\"tokens\":"<<r.generated_tokens<<"}\n";
        r.reset();r.unload();return 0;
    }catch(const std::exception &e){std::cerr<<e.what()<<std::endl;return 1;}
}
