#include "runtime.hpp"
#include "nlohmann/json.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

using json=nlohmann::json;

// Bound framing before JSON parsing. Oversized requests are drained, not retained in RAM.
static bool read_request(std::string &line,bool &too_large) {
    line.clear();too_large=false;bool have=false;char c;
    while(std::cin.get(c)) {
        have=true;if(c=='\n')break;
        if(line.size()<131072)line.push_back(c);else too_large=true;
    }
    return have;
}
static json metrics(const LocalRuntime &r) {
    return {{"model_load_ms",r.load_ms},{"first_token_ms",r.first_token_ms},
            {"generation_ms",r.generation_ms},{"tokens",r.generated_tokens},{"input_tokens",r.prompt_tokens},{"finish_reason",r.finish_reason==1?"stop":r.finish_reason==2?"length":r.finish_reason==3?"cancelled":r.finish_reason==4?"error":"none"}};
}
int main(int argc,char **argv) {
    if(argc!=2){std::cerr<<"Usage: mh-ai-session MODEL\n";return 2;}
    LocalRuntime runtime;
    try {runtime.load(argv[1]);}
    catch(const std::exception &e){std::cout<<json({{"id",nullptr},{"text",nullptr},{"metrics",nullptr},{"error",e.what()}}).dump()<<std::endl;return 1;}
    std::string line;bool too_large;
    while(read_request(line,too_large)) {
        json id=nullptr;bool generation_started=false;
        try {
            if(too_large)throw std::runtime_error("REQUEST_TOO_LARGE");
            const auto callback=[](int depth,json::parse_event_t,json&){if(depth>12)throw std::runtime_error("REQUEST_DEPTH");return true;};
            const auto req=json::parse(line,callback);
            if(!req.is_object())throw std::runtime_error("REQUEST_INVALID");
            for(auto i=req.begin();i!=req.end();++i)if(i.key()!="id"&&i.key()!="prompt"&&i.key()!="task"&&i.key()!="max_tokens"&&i.key()!="allowed_product_ids"&&i.key()!="allowed_claim_ids")throw std::runtime_error("REQUEST_FIELD");
            if(req.contains("id")) {
                if(!req["id"].is_string()&&!req["id"].is_number_integer()&&!req["id"].is_null())throw std::runtime_error("REQUEST_ID");
                if(req["id"].is_string()&&req["id"].get<std::string>().size()>120)throw std::runtime_error("REQUEST_ID");
                id=req["id"];
            }
            if(!req.contains("prompt")||!req["prompt"].is_string())throw std::runtime_error("PROMPT_INVALID");
            const auto prompt=req["prompt"].get<std::string>();
            if(prompt.empty()||prompt.size()>65536)throw std::runtime_error("PROMPT_INVALID");
            const auto task=req.value("task",std::string("compose"));
            if(task!="compose"&&task!="plan"&&task!="decision"&&task!="dialogue"&&task!="diagnostic")throw std::runtime_error("TASK_INVALID");
            if(req.contains("max_tokens")&&!req["max_tokens"].is_number_integer())throw std::runtime_error("OUTPUT_LIMIT");
            const int cap=task=="diagnostic"?256:task=="compose"?384:768,limit=req.value("max_tokens",cap);
            if(limit<1||limit>cap)throw std::runtime_error("OUTPUT_LIMIT");
            GenerationConstraints constraints;
            if(req.contains("allowed_product_ids")) {
                if(!req["allowed_product_ids"].is_array()||req["allowed_product_ids"].size()>50)throw std::runtime_error("CONSTRAINT_LIMIT");
                for(const auto &id:req["allowed_product_ids"]) {if(!id.is_number_integer())throw std::runtime_error("PRODUCT_ID_INVALID");constraints.product_ids.push_back(id.get<int64_t>());}
            }
            if(req.contains("allowed_claim_ids")) {
                if(!req["allowed_claim_ids"].is_array()||req["allowed_claim_ids"].size()>50)throw std::runtime_error("CONSTRAINT_LIMIT");
                for(const auto &id:req["allowed_claim_ids"]) {if(!id.is_string())throw std::runtime_error("CLAIM_ID_INVALID");constraints.claim_ids.push_back(id.get<std::string>());}
            }
            validate_constraints(constraints);
            runtime.cancelled=false;runtime.reset();generation_started=true;
            const auto text=runtime.generate(prompt,limit,[](auto){},task,constraints);
            std::cout<<json({{"id",id},{"text",text},{"metrics",metrics(runtime)},{"error",nullptr}}).dump()<<std::endl;
        } catch(const std::exception &e) {
            runtime.reset();runtime.cancelled=false;
            std::cout<<json({{"id",id},{"text",nullptr},{"metrics",generation_started?metrics(runtime):json(nullptr)},{"error",e.what()}}).dump()<<std::endl;
        }
    }
    runtime.unload();return 0;
}
