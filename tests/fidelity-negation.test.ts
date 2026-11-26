/** Regression for reproduced validator polarity leak; no model/clinical acceptance is inferred. */
import test from 'node:test';import assert from'node:assert/strict';import{fidelityCheck}from'../server/src/cp08/fidelity.ts';
const limits={id:'limits',text:'لا أشخص الأمراض ولا أصف الأدوية ولا أختلق المكونات أو التركيز أو الدراسات.'};
const check=(text:string,claims=[limits])=>fidelityCheck(text,claims,{minSupport:0.7});
const inversion=(text:string,claims=[limits])=>check(text,claims).problems.some(x=>x.problem.startsWith('negation inversion'));
test('found clinical capability polarity inversion is rejected despite near-total lexical support',()=>{
 const bad='أشخص الأمراض وأصف الأدوية وأختلق المكونات أو التركيز أو الدراسات. [limits]';assert.equal(check(bad).ok,false);assert.ok(inversion(bad));
});
test('one surviving negative clause cannot conceal another affirmative clinical claim',()=>{
 assert.ok(inversion('لا أشخص الأمراض وأصف الأدوية ولا أختلق المكونات. [limits]'));
 assert.ok(inversion('أشخص الأمراض، ولا أصف الأدوية ولا أختلق المكونات. [limits]'));
});
test('normalization and conjunctions preserve explicit negation in legitimate paraphrases',()=>{
 for(const text of ['لا أشخّص الأمراض ولا أصف الأدوية ولا أختلق المكونات أو التركيز أو الدراسات. [limits]','لن أشخص الأمراض ولن أصف الأدوية ولن أختلق المكونات أو التركيز أو الدراسات. [limits]','أنا لا أستطيع أن أشخص الأمراض، ولا أصف الأدوية. [limits]']){assert.equal(inversion(text),false);assert.equal(check(text).ok,true,text);}
});
test('unrelated negative fact does not invalidate a positively supported capability',()=>{
 const claims=[{id:'scope',text:'أشرح المكونات وأقارن المنتجات.'},{id:'limits',text:'لا أشخص الأمراض ولا أصف الأدوية.'}];
 assert.equal(check('أشرح المكونات وأقارن المنتجات. [scope, limits]',claims).ok,true);
 assert.equal(inversion('أشرح المكونات وأقارن المنتجات. [scope, limits]',claims),false);
});
test('negated scientific evidence existence cannot become affirmative evidence',()=>{
 const claims=[{id:'limits',text:'لا يوجد دليل كاف على فعالية هذا المنتج.'}];assert.ok(inversion('يوجد دليل كاف على فعالية هذا المنتج. [limits]',claims));assert.equal(check('لا يوجد دليل كاف على فعالية هذا المنتج. [limits]',claims).ok,true);
});
test('source may contain negative and positive clauses without requiring unrelated negation in output',()=>{
 const claims=[{id:'limits',text:'لا أحفظ الصور، وأشرح المكونات.'}];assert.equal(check('أشرح المكونات. [limits]',claims).ok,true);
});
test('new scientific numbers and unsupported certainty remain rejected',()=>{
 const claims=[{id:'limits',text:'قد يساعد المرطب في تخفيف الجفاف لدى بعض الأشخاص.'}];assert.equal(check('يساعد المرطب بنسبة 37% بالتأكيد في تخفيف الجفاف. [limits]',claims).ok,false);
});
