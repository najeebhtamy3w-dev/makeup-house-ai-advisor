#include "../native/embedding.hpp"
#include "nlohmann/json.hpp"
#include <iostream>
#include <string>
using nlohmann::json;
int main(int argc,char **argv){if(argc!=2)return 2;LocalEmbedding model;std::atomic<bool> cancel{false};try{model.load(argv[1],cancel);}catch(const std::exception&e){std::cout<<json({{"error",e.what()}})<<std::endl;return 1;}std::string line;while(std::getline(std::cin,line)){try{if(line.size()>300000)throw std::runtime_error("REQUEST_TOO_LARGE");auto request=json::parse(line);auto texts=request.at("texts").get<std::vector<std::string>>();auto vectors=model.encodeMany(texts,request.value("query",false));std::cout<<json({{"vectors",vectors},{"load_ms",model.load_ms},{"last_encode_ms",model.last_encode_ms},{"last_input_tokens",model.last_input_tokens},{"dimensions",384}})<<std::endl;}catch(const std::exception&e){std::cout<<json({{"error",e.what()}})<<std::endl;}}}
