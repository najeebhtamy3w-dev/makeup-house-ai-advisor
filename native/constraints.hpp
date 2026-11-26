#pragma once
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

// Trusted application-owned IDs only. This is NOT a caller-provided grammar or schema.
struct GenerationConstraints {
    std::vector<int64_t> product_ids;
    std::vector<std::string> claim_ids;
};
inline void validate_constraints(const GenerationConstraints &c) {
    if(c.product_ids.size()>50 || c.claim_ids.size()>50)throw std::runtime_error("CONSTRAINT_LIMIT");
    for(auto id:c.product_ids)if(id==0 || id < -999999999999999LL || id > 999999999999999LL)throw std::runtime_error("PRODUCT_ID_INVALID");
    for(const auto &id:c.claim_ids){
        if(id.empty() || id.size()>100)throw std::runtime_error("CLAIM_ID_INVALID");
        for(unsigned char ch:id)if(ch<32 || ch==127)throw std::runtime_error("CLAIM_ID_INVALID");
    }
}
// JSON and GBNF quoted literals share the escapes needed here. Applying twice encodes
// a terminal whose output is a complete JSON string; IDs never become executable rules.
inline std::string constrained_quote(const std::string &s) {
    std::string out="\"";
    for(unsigned char ch:s){
        switch(ch){case '\\':out+="\\\\";break;case '"':out+="\\\"";break;case '\n':out+="\\n";break;case '\r':out+="\\r";break;case '\t':out+="\\t";break;default:out+=static_cast<char>(ch);}
    }
    return out+"\"";
}
inline std::string constrained_product_rule(const GenerationConstraints &c) {
    std::string rule;for(auto id:c.product_ids){if(!rule.empty())rule+=" | ";rule+=constrained_quote(std::to_string(id));}return rule.empty()?"\"0\"":rule;
}
inline std::string constrained_claim_rule(const GenerationConstraints &c) {
    std::string rule;for(const auto &id:c.claim_ids){if(!rule.empty())rule+=" | ";rule+=constrained_quote(constrained_quote(id));}return rule.empty()?"\"\\\"\\\"\"":rule;
}
inline void constrained_replace_rule(std::string &grammar,const std::string &name,const std::string &rhs) {
    const auto needle="\n"+name+" ::= ";const auto start=grammar.find(needle);
    if(start==std::string::npos)throw std::runtime_error("GRAMMAR_RULE_MISSING");
    const auto value=start+needle.size();const auto end=grammar.find('\n',value);
    grammar.replace(value,end-value,rhs);
}
