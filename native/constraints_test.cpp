#include "constraints.hpp"
#include <functional>
#include <iostream>
static int checks=0;
static void expect(bool condition){if(!condition)throw std::runtime_error("ASSERTION_FAILED");checks++;}
static void rejects(const std::function<void()> &f,const std::string &code){try{f();throw std::logic_error("DID_NOT_REJECT");}catch(const std::runtime_error&e){expect(e.what()==code);}}
int main(){try{
 GenerationConstraints c{{7,-12},{"glycerin:1","skin-caution"}};validate_constraints(c);checks++;
 expect(constrained_product_rule(c)=="\"7\" | \"-12\"");
 expect(constrained_claim_rule(c)=="\"\\\"glycerin:1\\\"\" | \"\\\"skin-caution\\\"\"");
 GenerationConstraints none;validate_constraints(none);checks++;
 rejects([]{validate_constraints({{0},{}});},"PRODUCT_ID_INVALID");
 rejects([]{validate_constraints({{1000000000000000LL},{}});},"PRODUCT_ID_INVALID");
 rejects([]{validate_constraints({{}, {""}});},"CLAIM_ID_INVALID");
 rejects([]{validate_constraints({{}, {"x\nroot ::= attack"}});},"CLAIM_ID_INVALID");
 rejects([]{validate_constraints({{}, {std::string(101,'x')}});},"CLAIM_ID_INVALID");
 rejects([]{validate_constraints({std::vector<int64_t>(51,1),{}});},"CONSTRAINT_LIMIT");
 expect(constrained_quote("a\"b\\c")=="\"a\\\"b\\\\c\"");
 std::string grammar="root ::= ids\nids ::= old\nid ::= any\n";constrained_replace_rule(grammar,"id","\"7\"");
 expect(grammar=="root ::= ids\nids ::= old\nid ::= \"7\"\n");
 rejects([&]{constrained_replace_rule(grammar,"missing","bad");},"GRAMMAR_RULE_MISSING");
 std::cout<<"PASSED "<<checks<<" native constraint security checks; no model invocation\n";return 0;
 }catch(const std::exception&e){std::cerr<<"FAILED "<<e.what()<<"\n";return 1;}}
