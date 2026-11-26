#include "runtime.hpp"
#include <algorithm>
#include <stdexcept>
#include <thread>
#include <vector>
#include <chrono>
using Clock=std::chrono::steady_clock;
static double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
struct GenerationTimer { double &value; Clock::time_point start; ~GenerationTimer(){value=elapsed(start);} };

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
    auto cp=llama_context_default_params(); cp.n_ctx=4096; cp.n_batch=128;
    cp.n_threads=std::min(4u,std::max(1u,std::thread::hardware_concurrency())); cp.n_threads_batch=cp.n_threads;
    cp.abort_callback=[](void *p) { return static_cast<LocalRuntime*>(p)->cancelled.load(); }; cp.abort_callback_data=this;
    context=llama_init_from_model(model,cp);
    if(!context) { unload(); throw std::runtime_error("CONTEXT_FAILED"); }
    load_ms=elapsed(start);
}
std::string LocalRuntime::generate(const std::string &prompt,int limit,const std::function<void(const std::string&)> &progress,const std::string &task,const GenerationConstraints &constraints) {
    if(task!="compose" && task!="plan" && task!="decision" && task!="diagnostic") throw std::runtime_error("TASK_INVALID");
    validate_constraints(constraints);
    const int output_cap=task=="diagnostic"?256:task=="compose"?384:768;
    if(limit<1 || limit>output_cap) throw std::runtime_error("OUTPUT_LIMIT");
    if(!context) throw std::runtime_error("MODEL_MISSING");
    auto start=Clock::now(); generated_tokens=0;prompt_tokens=0;finish_reason=0;first_token_ms=0;generation_ms=0;reset();
    GenerationTimer timing{generation_ms,start};
    auto vocab=llama_model_get_vocab(model);
    int n=-llama_tokenize(vocab,prompt.c_str(),prompt.size(),nullptr,0,true,true);
    if(n<=0 || n>(task=="compose"?1536:3072)) throw std::runtime_error("CONTEXT_LIMIT");
    prompt_tokens=n;
    std::vector<llama_token> tokens(n);
    if(llama_tokenize(vocab,prompt.c_str(),prompt.size(),tokens.data(),n,true,true)<0) throw std::runtime_error("TOKENIZE_FAILED");
    for(int i=0;i<n;i+=128) {
        if(cancelled) throw std::runtime_error("CANCELLED");
        if(llama_decode(context,llama_batch_get_one(tokens.data()+i,std::min(128,n-i)))) throw std::runtime_error(cancelled?"CANCELLED":"DECODE_FAILED");
    }
    // Upstream grammar sampler guarantees JSON structure; scientific meaning is still independently validated.
    const char *compose_grammar=R"GBNF(
root ::= "{" ws "\"sentences\"" ws ":" ws "[" ws sentence (ws "," ws sentence){0,3} ws "]" ws "}"
sentence ::= "{" ws "\"text\"" ws ":" ws string ws "," ws "\"claim_ids\"" ws ":" ws "[" ws string (ws "," ws string){0,2} ws "]" ws "}"
string ::= "\"" ([^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4}))* "\""
ws ::= [ \t\n\r]{0,4}
)GBNF";
    // Exact task schemas prevent syntactically valid but unusable string tool calls.
    // Independent application validation still enforces evidence, authority and semantics.
    std::string structured_grammar=std::string("root ::= ")+(task=="plan"?"plan":"decision")+"\n"+R"GBNF(
ws ::= [ \t\n\r]{0,4}
char ::= [^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4})
s80 ::= "\"" char{0,80} "\""
s100 ::= "\"" char{0,100} "\""
s200 ::= "\"" char{0,200} "\""
s300 ::= "\"" char{0,300} "\""
s700 ::= "\"" char{1,700} "\""
s350 ::= "\"" char{4,350} "\""
id ::= "-"? [1-9] [0-9]{0,14}
ids ::= "[" ws (id (ws "," ws id){0,4})? ws "]"
toolname ::= "\"scientific_specialist\"" | "\"get_system_capabilities\"" | "\"get_product_images\"" | "\"retrieve_scientific_evidence\"" | "\"search_local_products\"" | "\"search_global_products\"" | "\"get_product_details\"" | "\"analyze_ingredient_compatibility\"" | "\"compare_products\"" | "\"check_local_availability\"" | "\"check_valid_batches\"" | "\"build_cosmetic_routine\"" | "\"find_global_alternatives\"" | "\"retrieve_conversation_context\""
specialist ::= "\"skin\"" | "\"hair\"" | "\"inci\"" | "\"formulation\"" | "\"evidence\""
tool ::= "{" ws "\"name\"" ws ":" ws toolname ws "," ws "\"query\"" ws ":" ws s200 ws "," ws "\"product_ids\"" ws ":" ws ids (ws "," ws "\"specialist\"" ws ":" ws specialist)? ws "}"
tools4 ::= "[" ws (tool (ws "," ws tool){0,3})? ws "]"
tools2 ::= "[" ws (tool (ws "," ws tool){0,1})? ws "]"
intent ::= "\"capabilities\"" | "\"consultation\"" | "\"ingredient\"" | "\"compatibility\"" | "\"compare\"" | "\"routine\"" | "\"alternative\"" | "\"availability\"" | "\"clarify\"" | "\"out_of_scope\""
skinitem ::= "\"dry\"" | "\"oily\"" | "\"combination\"" | "\"sensitive\"" | "\"normal\""
skin ::= "[" ws (skinitem (ws "," ws skinitem){0,4})? ws "]"
hairitem ::= "\"dry\"" | "\"oily\"" | "\"colored\"" | "\"curly\"" | "\"damaged\"" | "\"normal\""
hair ::= "[" ws (hairitem (ws "," ws hairitem){0,5})? ws "]"
concern ::= "\"oil\"" | "\"dryness\"" | "\"sensitivity\"" | "\"acne\"" | "\"pigmentation\"" | "\"dandruff\"" | "\"hair_loss\"" | "\"breakage\"" | "\"sun\"" | "\"hydration\"" | "\"irritation\"" | "\"unknown\""
concerns ::= "[" ws (concern (ws "," ws concern){0,5})? ws "]"
ingredients ::= "[" ws (s80 (ws "," ws s80){0,7})? ws "]"
constraint ::= "\"fragrance_free\"" | "\"lightweight\"" | "\"non_comedogenic\"" | "\"sulfate_free\"" | "\"alcohol_free\"" | "\"oil_free\"" | "\"for_sensitive\"" | "\"beginner\"" | "\"minimal\"" | "\"local_only\"" | "\"no_essential_oil\""
constraints ::= "[" ws (constraint (ws "," ws constraint){0,7})? ws "]"
missingitem ::= "\"skin\"" | "\"hair\"" | "\"product\"" | "\"ingredients\"" | "\"goal\"" | "\"usage\"" | "\"pregnancy\"" | "\"reaction\""
missing ::= "[" ws (missingitem (ws "," ws missingitem){0,7})? ws "]"
queries ::= "[" ws (s200 (ws "," ws s200){0,3})? ws "]"
plan ::= "{" ws "\"intent\"" ws ":" ws intent ws "," ws "\"skin\"" ws ":" ws skin ws "," ws "\"hair\"" ws ":" ws hair ws "," ws "\"concerns\"" ws ":" ws concerns ws "," ws "\"ingredients\"" ws ":" ws ingredients ws "," ws "\"product_refs\"" ws ":" ws ids ws "," ws "\"constraints\"" ws ":" ws constraints ws "," ws "\"missing\"" ws ":" ws missing ws "," ws "\"question\"" ws ":" ws s300 ws "," ws "\"queries\"" ws ":" ws queries ws "," ws "\"tools\"" ws ":" ws tools4 ws "," ws "\"correction\"" ws ":" ws ("true" | "false") ws "}"
claims6 ::= "[" ws (s100 (ws "," ws s100){0,5})? ws "]"
claims4 ::= "[" ws s100 (ws "," ws s100){0,3} ws "]"
premises ::= "[" ws s100 (ws "," ws s100){0,2} ws "]"
tradeoff ::= "\"hydration\"" | "\"oil_control\"" | "\"sensitivity\"" | "\"fragrance\"" | "\"hair_conditioning\"" | "\"uncertain\"" | "\"global_only\""
tradeoffs ::= "[" ws (tradeoff (ws "," ws tradeoff){0,3})? ws "]"
recommendation ::= "{" ws "\"product_id\"" ws ":" ws id ws "," ws "\"claim_ids\"" ws ":" ws claims4 ws "," ws "\"tradeoffs\"" ws ":" ws tradeoffs ws "}"
recommendations ::= "[" ws (recommendation (ws "," ws recommendation){0,3})? ws "]"
period ::= "\"morning\"" | "\"evening\"" | "\"both\"" | "\"hair\""
step ::= "\"cleanse\"" | "\"moisturize\"" | "\"protect\"" | "\"condition\"" | "\"active\""
routineitem ::= "{" ws "\"period\"" ws ":" ws period ws "," ws "\"step\"" ws ":" ws step ws "," ws "\"product_id\"" ws ":" ws (id | "null") ws "," ws "\"claim_ids\"" ws ":" ws claims4 ws "}"
routine ::= "[" ws (routineitem (ws "," ws routineitem){0,5})? ws "]"
relation ::= "\"complement\"" | "\"conflict\"" | "\"uncertain\""
note ::= "{" ws "\"premise_ids\"" ws ":" ws premises ws "," ws "\"relation\"" ws ":" ws relation ws "," ws "\"summary\"" ws ":" ws s350 ws "}"
notes ::= "[" ws (note (ws "," ws note){0,2})? ws "]"
segmentkind ::= "\"explanation\"" | "\"inference\"" | "\"clarification\"" | "\"capability\"" | "\"limitation\""
segmentclaims ::= "[" ws (claimid (ws "," ws claimid){0,5})? ws "]"
segment ::= "{" ws "\"text\"" ws ":" ws s700 ws "," ws "\"claim_ids\"" ws ":" ws segmentclaims ws "," ws "\"kind\"" ws ":" ws segmentkind ws "}"
segments ::= "[" ws (segment (ws "," ws segment){0,5})? ws "]"
decision ::= "{" ws "\"selected_claim_ids\"" ws ":" ws claims6 ws "," ws "\"recommendations\"" ws ":" ws recommendations ws "," ws "\"routine\"" ws ":" ws routine ws "," ws "\"clarification\"" ws ":" ws (s300 | "null") ws "," ws "\"inference_notes\"" ws ":" ws notes ws "," ws "\"next_tools\"" ws ":" ws tools2 (ws "," ws "\"response_segments\"" ws ":" ws segments)? ws "}"
)GBNF";
    // Enum-constrained IDs are derived from observed application records, not model text.
    // Empty allowlists force empty reference arrays; no fallback to arbitrary numeric IDs.
    if(task!="compose" && task!="diagnostic") {
        constrained_replace_rule(structured_grammar,"id",constrained_product_rule(constraints));
        if(constraints.product_ids.empty()) {
            constrained_replace_rule(structured_grammar,"ids",R"GBNF("[" ws "]")GBNF");
            constrained_replace_rule(structured_grammar,"recommendations",R"GBNF("[" ws "]")GBNF");
            const std::string nullable="(id | \"null\")";
            const auto pos=structured_grammar.find(nullable);
            if(pos!=std::string::npos)structured_grammar.replace(pos,nullable.size(),"\"null\"");
        }
        structured_grammar+="\nclaimid ::= "+constrained_claim_rule(constraints)+"\n";
        constrained_replace_rule(structured_grammar,"claims6",constraints.claim_ids.empty()?R"GBNF("[" ws "]")GBNF":R"GBNF("[" ws (claimid (ws "," ws claimid){0,5})? ws "]")GBNF");
        constrained_replace_rule(structured_grammar,"claims4",constraints.claim_ids.empty()?R"GBNF("[" ws "]")GBNF":R"GBNF("[" ws claimid (ws "," ws claimid){0,3} ws "]")GBNF");
        constrained_replace_rule(structured_grammar,"premises",constraints.claim_ids.empty()?R"GBNF("[" ws "]")GBNF":R"GBNF("[" ws claimid (ws "," ws claimid){0,2} ws "]")GBNF");
        if(constraints.claim_ids.empty()) {
            constrained_replace_rule(structured_grammar,"segmentclaims",R"GBNF("[" ws "]")GBNF");
            constrained_replace_rule(structured_grammar,"recommendations",R"GBNF("[" ws "]")GBNF");
            constrained_replace_rule(structured_grammar,"routine",R"GBNF("[" ws "]")GBNF");
            constrained_replace_rule(structured_grammar,"notes",R"GBNF("[" ws "]")GBNF");
        }
    }
    auto sampler=llama_sampler_chain_init(llama_sampler_chain_default_params());
    if(task!="diagnostic") {
    auto gs=llama_sampler_init_grammar(vocab,task=="compose"?compose_grammar:structured_grammar.c_str(),"root");
    if(!gs){llama_sampler_free(sampler);throw std::runtime_error("GRAMMAR_FAILED");}
    llama_sampler_chain_add(sampler,gs);
    }
    llama_sampler_chain_add(sampler,llama_sampler_init_greedy());
    std::string output;
    try {
        for(int i=0;i<limit;i++) {
            if(cancelled) throw std::runtime_error("CANCELLED");
            auto tok=llama_sampler_sample(sampler,context,-1);
            if(llama_vocab_is_eog(vocab,tok)) {finish_reason=1;break;}
            if(generated_tokens++==0)first_token_ms=elapsed(start);
            std::vector<char> piece(256); int len=llama_token_to_piece(vocab,tok,piece.data(),piece.size(),0,true);
            if(len<0) {piece.resize(-len);len=llama_token_to_piece(vocab,tok,piece.data(),piece.size(),0,true);}
            if(len>0) output.append(piece.data(),len);
            // Raw bytes stay native: only a token count is emitted before scientific validation.
            progress(std::to_string(i+1));
            if(llama_decode(context,llama_batch_get_one(&tok,1))) throw std::runtime_error(cancelled?"CANCELLED":"DECODE_FAILED");
        }
    } catch(...) { finish_reason=cancelled?3:4;llama_sampler_free(sampler);reset();throw; }
    if(finish_reason==0)finish_reason=2;
    llama_sampler_free(sampler);reset();return output;
}
