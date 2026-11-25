#include "runtime.hpp"
#include <fstream>
#include <iostream>
#include <sstream>
int main(int argc,char **argv) {
    try {
        if(argc<3 || argc>5) return 2;
        std::ifstream f(argv[2]);if(!f) throw std::runtime_error("PROMPT_FILE_MISSING");std::stringstream s;s<<f.rdbuf();
        const std::string task=argc>3?argv[3]:"compose";
        const int limit=argc>4?std::stoi(argv[4]):(task=="compose"?384:768);
        LocalRuntime r;r.load(argv[1]);
        std::cout<<r.generate(s.str(),limit,[](auto){},task)<<std::endl;
        std::cerr<<"\nMETRICS {\"load_ms\":"<<r.load_ms<<",\"first_token_ms\":"<<r.first_token_ms<<",\"generation_ms\":"<<r.generation_ms<<",\"tokens\":"<<r.generated_tokens<<"}\n";
        r.reset();r.unload();return 0;
    }catch(const std::exception &e){std::cerr<<e.what()<<std::endl;return 1;}
}
