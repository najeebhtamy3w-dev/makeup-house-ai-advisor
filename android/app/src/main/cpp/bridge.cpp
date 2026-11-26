#include <jni.h>
#include "runtime.hpp"
static LocalRuntime runtime;
static std::string utf8(JNIEnv *env,jstring s) {
    // Java strings use UTF-16; JNI modified UTF-8 cannot encode supplementary characters correctly.
    jclass cls=env->FindClass("java/lang/String");
    jmethodID m=env->GetMethodID(cls,"getBytes","(Ljava/lang/String;)[B");
    auto charset=env->NewStringUTF("UTF-8");auto b=(jbyteArray)env->CallObjectMethod(s,m,charset);
    auto p=env->GetByteArrayElements(b,nullptr);std::string out((char*)p,env->GetArrayLength(b));env->ReleaseByteArrayElements(b,p,JNI_ABORT);
    env->DeleteLocalRef(b);env->DeleteLocalRef(charset);env->DeleteLocalRef(cls);return out;
}
static void error(JNIEnv *e,const std::exception &x){e->ThrowNew(e->FindClass("java/lang/IllegalStateException"),x.what());}
extern "C" JNIEXPORT void JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeLoad(JNIEnv* e,jclass,jstring p){try{runtime.load(utf8(e,p));}catch(const std::exception &x){error(e,x);}}
extern "C" JNIEXPORT void JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeUnload(JNIEnv*,jclass){runtime.unload();}
extern "C" JNIEXPORT void JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeReset(JNIEnv*,jclass){runtime.cancelled=false;runtime.reset();}
extern "C" JNIEXPORT void JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeCancel(JNIEnv*,jclass){runtime.cancelled=true;}
extern "C" JNIEXPORT jdoubleArray JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeMetrics(JNIEnv* e,jclass){
    const jdouble values[]={runtime.load_ms,runtime.first_token_ms,runtime.generation_ms,static_cast<double>(runtime.generated_tokens),static_cast<double>(runtime.prompt_tokens),static_cast<double>(runtime.finish_reason)};
    auto out=e->NewDoubleArray(6);if(out)e->SetDoubleArrayRegion(out,0,6,values);return out;
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_com_makeuphouse_advisor_LocalAIPlugin_nativeGenerate(JNIEnv* e,jobject self,jstring p,jint limit,jstring task,jlongArray products,jobjectArray claims){
    try{
        GenerationConstraints constraints;
        if(products){const auto n=e->GetArrayLength(products);if(n>50)throw std::runtime_error("CONSTRAINT_LIMIT");auto values=e->GetLongArrayElements(products,nullptr);for(jsize i=0;i<n;i++)constraints.product_ids.push_back(values[i]);e->ReleaseLongArrayElements(products,values,JNI_ABORT);}
        if(claims){const auto n=e->GetArrayLength(claims);if(n>50)throw std::runtime_error("CONSTRAINT_LIMIT");for(jsize i=0;i<n;i++){auto value=(jstring)e->GetObjectArrayElement(claims,i);if(!value)throw std::runtime_error("CLAIM_ID_INVALID");constraints.claim_ids.push_back(utf8(e,value));e->DeleteLocalRef(value);}}
        validate_constraints(constraints);
        auto method=e->GetMethodID(e->GetObjectClass(self),"onProgress","(I)V");
        auto s=runtime.generate(utf8(e,p),limit,[&](auto n){e->CallVoidMethod(self,method,std::stoi(n));},utf8(e,task),constraints);
        auto b=e->NewByteArray(s.size());e->SetByteArrayRegion(b,0,s.size(),(jbyte*)s.data());return b;
    }catch(const std::exception &x){error(e,x);return nullptr;}
}
