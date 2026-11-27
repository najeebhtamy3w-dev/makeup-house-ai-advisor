#include "constraints.hpp"
#include <iostream>
#include <string>
int main(){std::string task="plan";GenerationConstraints constraints;
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
# Application schema requires a real tool for work intents; do not pick a specific tool for the model.
workintent ::= "\"capabilities\"" | "\"consultation\"" | "\"ingredient\"" | "\"compatibility\"" | "\"compare\"" | "\"routine\"" | "\"alternative\"" | "\"availability\""
freeintent ::= "\"clarify\"" | "\"out_of_scope\""
toolsrequired ::= "[" ws tool (ws "," ws tool){0,3} ws "]"
plan ::= "{" ws "\"intent\"" ws ":" ws (workintent planwork | freeintent planfree)
planwork ::= planbody toolsrequired planend
planfree ::= planbody tools4 planend
planbody ::= ws "," ws "\"skin\"" ws ":" ws skin ws "," ws "\"hair\"" ws ":" ws hair ws "," ws "\"concerns\"" ws ":" ws concerns ws "," ws "\"ingredients\"" ws ":" ws ingredients ws "," ws "\"product_refs\"" ws ":" ws ids ws "," ws "\"constraints\"" ws ":" ws constraints ws "," ws "\"missing\"" ws ":" ws missing ws "," ws "\"question\"" ws ":" ws s300 ws "," ws "\"queries\"" ws ":" ws queries ws "," ws "\"tools\"" ws ":" ws
planend ::= ws "," ws "\"correction\"" ws ":" ws ("true" | "false") ws "}"
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
    // Application conversation is not a scientific recommendation. Its schema cannot
    // ask for product/routine analysis or loop over tools, and still cites observed app facts.
    if(task=="dialogue") {
        for(const auto *rule:{"recommendations","routine","notes","tools2"})
            constrained_replace_rule(structured_grammar,rule,R"GBNF("[" ws "]")GBNF");
        constrained_replace_rule(structured_grammar,"segmentkind",R"GBNF("\"capability\"" | "\"limitation\"" | "\"clarification\"")GBNF");
        constrained_replace_rule(structured_grammar,"segments",R"GBNF("[" ws segment (ws "," ws segment){0,2} ws "]")GBNF");
        constrained_replace_rule(structured_grammar,"decision",R"GBNF("{" ws "\"selected_claim_ids\"" ws ":" ws claims6 ws "," ws "\"recommendations\"" ws ":" ws recommendations ws "," ws "\"routine\"" ws ":" ws routine ws "," ws "\"clarification\"" ws ":" ws "null" ws "," ws "\"inference_notes\"" ws ":" ws notes ws "," ws "\"next_tools\"" ws ":" ws tools2 ws "," ws "\"response_segments\"" ws ":" ws segments ws "}")GBNF");
    }

std::cout<<structured_grammar;}
