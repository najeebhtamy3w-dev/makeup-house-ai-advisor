package com.makeuphouse.advisor;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Native operations own a single serial executor. Model weights never enter JS, SQLite or backups. */
@CapacitorPlugin(name="LocalAI")
public class LocalAIPlugin extends Plugin {
    private static final ExecutorService executor=Executors.newSingleThreadExecutor();
    private static final AtomicBoolean busy=new AtomicBoolean(false);
    private final AtomicBoolean cancelDownload=new AtomicBoolean(false), generationCancelled=new AtomicBoolean(false);
    private final Map<String,Runnable> grants=new ConcurrentHashMap<>();
    private static volatile boolean loaded=false, nativeReady=false, visionLoaded=false;
    private volatile boolean foreground=true;
    private volatile boolean managerOperation=false;
    private volatile boolean nativeInvocationStarted=false;
    private volatile HttpURLConnection downloadConnection;
    private JSONObject manifest;
    private File directory, model, partial;
    private String runtimeError=null;
    private VisionAsset visionAsset;
    private String visionAssetError=null;
    private volatile String phase="idle", lastOperationError=null;
    private volatile long verifiedLength=-1, verifiedModified=-1;
    private volatile String verifiedHash=null;
    private static native void nativeLoad(String path);
    private static native void nativeUnload();
    private static native void nativeReset();
    private static native void nativeCancel();
    private native byte[] nativeGenerate(String prompt,int limit,String task,long[] allowedProducts,String[] allowedClaims);
    private static native double[] nativeMetrics();
    private static native void nativeLoadVision(String path);
    private native byte[] nativeDescribeImage(byte[] image,String question,int limit);
    private static native double[] nativeVisionMetrics();
    @Override public void load() {
        directory=new File(getContext().getNoBackupFilesDir(),"local-ai");directory.mkdirs();
        model=new File(directory,"approved.gguf");partial=new File(directory,"approved.part");
        try(InputStream in=getContext().getAssets().open("model-manifest.json")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1)bytes.write(chunk,0,n);
            manifest=new JSONObject(bytes.toString("UTF-8"));
            System.loadLibrary("mh_local_ai");
            nativeReady=true;
            try(InputStream source=getContext().getAssets().open("vision-manifest.json")){ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] buf=new byte[4096];int read;while((read=source.read(buf))!=-1)data.write(buf,0,read);visionAsset=new VisionAsset(getContext(),new JSONObject(data.toString("UTF-8")));}catch(Exception e){visionAssetError="VISION_MANIFEST_UNAVAILABLE";}
        }catch(Throwable e){runtimeError="RUNTIME_UNAVAILABLE";}
    }
    // Role is re-read through the authenticated local worker for EVERY call, including direct Capacitor callers.
    // The local WebView/worker is the existing application's trusted auth boundary; no remote content is loaded.
    private void authorized(PluginCall call,boolean manager,Runnable work) {
        String token=call.getString("token","");String nonce=UUID.randomUUID().toString();
        grants.put(nonce,work);denied.put(nonce,()->call.reject("FORBIDDEN"));
        String js="(async()=>{let ok=false;try{const r=await fetch('/api/auth/me',{headers:{authorization:'Bearer '+"+JSONObject.quote(token)+"}});const j=await r.json();ok=r.ok&&!!j.user"+(manager?"&&j.user.role==='manager'":"")+";}catch(e){}window.Capacitor.Plugins.LocalAI.authorizationResult({nonce:"+JSONObject.quote(nonce)+",ok});})()";
        getActivity().runOnUiThread(()->getBridge().getWebView().evaluateJavascript(js,null));
        getBridge().getWebView().postDelayed(()->{if(grants.remove(nonce)!=null){denied.remove(nonce);call.reject("AUTH_TIMEOUT");}},10000);
        // On denial the callback rejects the originating call, not a silent timeout.
    }
    private final Map<String,Runnable> denied=new ConcurrentHashMap<>();
    @PluginMethod public void authorizationResult(PluginCall call){String n=call.getString("nonce","");Runnable r=grants.remove(n),d=denied.remove(n);if(r!=null){if(call.getBoolean("ok",false))r.run();else if(d!=null)d.run();}call.resolve();}
    private void run(PluginCall call,boolean manager,Callable<JSObject> work){authorized(call,manager,()->{
        if(!busy.compareAndSet(false,true)){call.reject("BUSY");return;}
        managerOperation=manager;
        executor.execute(()->{try{lastOperationError=null;nativeInvocationStarted=false;if(runtimeError!=null)throw new IOException(runtimeError);call.resolve(work.call());}catch(Throwable e){lastOperationError=e.getMessage()==null?"RUNTIME_FAILED":e.getMessage();phase="error";JSObject failure=new JSObject();failure.put("model_started",nativeInvocationStarted);call.reject(lastOperationError,failure);}finally{managerOperation=false;busy.set(false);if(!phase.equals("error"))phase="idle";}});
    });}
    private JSObject statusObject() throws Exception {return statusObject(false);}
    private JSObject statusObject(boolean diagnostics) throws Exception {
        JSObject out=new JSObject();out.put("runtime",manifest==null?"unavailable":manifest.getString("runtime"));out.put("manifest",manifest);
        out.put("installed",model.isFile());out.put("active",getContext().getSharedPreferences("local-ai",0).getBoolean("active",false));
        out.put("loaded",loaded);out.put("busy",busy.get());out.put("free_bytes",directory.getUsableSpace());out.put("downloaded",partial.length());out.put("error",runtimeError);
        out.put("abis",new JSArray(Arrays.asList(android.os.Build.SUPPORTED_ABIS)));
        boolean verified=model.isFile()&&verifiedHash!=null&&model.length()==verifiedLength&&model.lastModified()==verifiedModified;out.put("verified",verified);out.put("verified_sha256",verified?verifiedHash:JSONObject.NULL);out.put("phase",runtimeError!=null?"unavailable":busy.get()?phase:lastOperationError!=null?"failed":loaded?"ready":model.isFile()?"installed_unloaded":"not_installed");out.put("last_operation_error",lastOperationError);out.put("device",android.os.Build.MODEL);out.put("hardware",android.os.Build.HARDWARE);
        JSObject capabilities=new JSObject();capabilities.put("text",true);capabilities.put("vision",visionLoaded);capabilities.put("vision_backend_compiled",true);capabilities.put("vision_acceptance","EXPERIMENTAL_UNVALIDATED_NOT_DEVICE_ACCEPTED");capabilities.put("raw_manager_diagnostic",true);capabilities.put("typed_id_constraints",true);out.put("capabilities",capabilities);out.put("vision_projector",visionAsset==null?JSONObject.NULL:visionAsset.status());out.put("vision_loaded",visionLoaded);out.put("vision_asset_error",visionAssetError);out.put("context_tokens",4096);out.put("native_api_version",2);
        if(diagnostics){
            JSObject identity=new JSObject();identity.put("application_id",getContext().getPackageName());
            try {
                android.content.pm.PackageManager pm=getContext().getPackageManager();
                android.content.pm.PackageInfo info=pm.getPackageInfo(getContext().getPackageName(),android.os.Build.VERSION.SDK_INT>=28?android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES:android.content.pm.PackageManager.GET_SIGNATURES);
                identity.put("version_name",info.versionName);identity.put("version_code",android.os.Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode);
                android.content.pm.Signature[] signatures=android.os.Build.VERSION.SDK_INT>=28?(info.signingInfo.hasMultipleSigners()?info.signingInfo.getApkContentsSigners():info.signingInfo.getSigningCertificateHistory()):info.signatures;
                JSArray certificates=new JSArray();for(android.content.pm.Signature signature:signatures){byte[] digest=MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format(Locale.ROOT,"%02x",b));certificates.put(hex.toString());}
                identity.put("signing_certificate_history_sha256",certificates);identity.put("source","Android PackageManager public certificate; not private keystore");
            }catch(Exception e){identity.put("certificate_status","UNAVAILABLE");}
            out.put("application_identity",identity);
            JSObject metrics=new JSObject();metrics.put("process_pss_kb",android.os.Debug.getPss());
            metrics.put("native_heap_bytes",android.os.Debug.getNativeHeapAllocatedSize());
            metrics.put("android_sdk",android.os.Build.VERSION.SDK_INT);
            if(android.os.Build.VERSION.SDK_INT>=31)metrics.put("soc_model",android.os.Build.SOC_MODEL);
            android.app.ActivityManager am=(android.app.ActivityManager)getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if(am!=null){android.app.ActivityManager.MemoryInfo info=new android.app.ActivityManager.MemoryInfo();am.getMemoryInfo(info);metrics.put("system_total_memory_bytes",info.totalMem);metrics.put("system_available_memory_bytes",info.availMem);metrics.put("system_low_memory",info.lowMemory);}
            out.put("diagnostics",metrics);
        }
        return out;
    }
    @PluginMethod public void status(PluginCall c){boolean diagnostics=c.getBoolean("diagnostics",false);authorized(c,diagnostics,()->{try{c.resolve(statusObject(diagnostics));}catch(Exception e){c.reject("STATUS_FAILED");}});}
    private void verify(File f) throws Exception {
        phase="verifying";
        if(f.length()!=manifest.getLong("size"))throw new IOException("MODEL_SIZE_MISMATCH");
        MessageDigest md=MessageDigest.getInstance("SHA-256");byte[] buf=new byte[1024*1024];
        try(InputStream in=new FileInputStream(f)){int n;while((n=in.read(buf))!=-1){if(cancelDownload.get())throw new IOException("CANCELLED");md.update(buf,0,n);}}
        StringBuilder hex=new StringBuilder();for(byte b:md.digest())hex.append(String.format("%02x",b));
        if(!hex.toString().equals(manifest.getString("sha256")))throw new IOException("MODEL_HASH_MISMATCH");
        try(RandomAccessFile in=new RandomAccessFile(f,"r")){if(in.readInt()!=0x47475546)throw new IOException("MODEL_FORMAT_INVALID");}
        if(f.equals(model)){verifiedLength=f.length();verifiedModified=f.lastModified();verifiedHash=hex.toString();}
    }
    @PluginMethod public void install(PluginCall c){run(c,true,()->{
        cancelDownload.set(false);if(model.isFile()){verify(model);return statusObject();}
        phase="downloading";cancelDownload.set(false);long expected=manifest.getLong("size"),offset=partial.length();
        if(offset>expected){partial.delete();offset=0;}
        if(directory.getUsableSpace()<expected-offset+256L*1024*1024)throw new IOException("INSUFFICIENT_STORAGE");
        if(offset<expected){
            URL url=new URL(manifest.getString("url"));HttpURLConnection con=null;
            try {
                // Only HTTPS redirects; URLs originate solely in the pinned app manifest.
                for(int redirects=0;redirects<6;redirects++){
                    if(!url.getProtocol().equals("https"))throw new IOException("UNSAFE_REDIRECT");
                    con=(HttpURLConnection)url.openConnection();downloadConnection=con;con.setInstanceFollowRedirects(false);con.setConnectTimeout(20000);con.setReadTimeout(20000);con.setRequestProperty("Accept-Encoding","identity");
                    if(offset>0)con.setRequestProperty("Range","bytes="+offset+"-");int code=con.getResponseCode();
                    if(code>=300&&code<400){String next=con.getHeaderField("Location");con.disconnect();if(next==null)throw new IOException("DOWNLOAD_REDIRECT");url=new URL(url,next);continue;}
                    if(code!=200&&code!=206)throw new IOException("DOWNLOAD_HTTP_"+code);
                    if(code==206){String range=con.getHeaderField("Content-Range");if(range==null||!range.startsWith("bytes "+offset+"-")||!range.endsWith("/"+expected))throw new IOException("DOWNLOAD_RANGE");}
                    else offset=0;
                    try(InputStream in=con.getInputStream();OutputStream out=new FileOutputStream(partial,offset>0)){
                        byte[] buf=new byte[256*1024];int n;long count=offset,last=0;
                        while((n=in.read(buf))!=-1){if(cancelDownload.get()||!foreground)throw new IOException("CANCELLED");count+=n;if(count>expected)throw new IOException("MODEL_TOO_LARGE");out.write(buf,0,n);long now=System.currentTimeMillis();if(now-last>250){JSObject p=new JSObject();p.put("bytes",count);p.put("total",expected);notifyListeners("downloadProgress",p);last=now;}}
                    }break;
                }
            }finally{if(con!=null)con.disconnect();downloadConnection=null;}
        }
        verify(partial);nativeUnload();loaded=false;visionLoaded=false;
        android.system.Os.rename(partial.getAbsolutePath(),model.getAbsolutePath());verifiedLength=model.length();verifiedModified=model.lastModified();verifiedHash=manifest.getString("sha256");
        return statusObject();
    });}
    @PluginMethod public void activate(PluginCall c){run(c,true,()->{cancelDownload.set(false);verify(model);phase="loading";loaded=false;visionLoaded=false;nativeLoad(model.getAbsolutePath());loaded=true;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",true).apply();return statusObject();});}
    @PluginMethod public void deactivate(PluginCall c){run(c,true,()->{nativeUnload();loaded=false;visionLoaded=false;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",false).apply();return statusObject();});}
    @PluginMethod public void remove(PluginCall c){run(c,true,()->{nativeUnload();loaded=false;visionLoaded=false;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",false).apply();if(model.exists()&&!model.delete())throw new IOException("REMOVE_FAILED");if(partial.exists()&&!partial.delete())throw new IOException("REMOVE_FAILED");return statusObject();});}
    @PluginMethod public void generate(PluginCall c){run(c,false,()->{
        String task=c.getString("task","compose");
        if(!task.equals("compose")&&!task.equals("plan")&&!task.equals("decision")&&!task.equals("dialogue"))throw new IOException("TASK_INVALID");
        int cap=task.equals("compose")?384:768,limit=c.getInt("max_tokens",cap);
        if(limit<1||limit>cap)throw new IOException("OUTPUT_LIMIT");
        String prompt=c.getString("prompt","");if(prompt.isEmpty()||prompt.length()>(task.equals("compose")?12000:24000))throw new IOException("CONTEXT_LIMIT");
        JSArray productInput=c.getArray("allowed_product_ids",new JSArray()),claimInput=c.getArray("allowed_claim_ids",new JSArray());
        if(productInput.length()>50||claimInput.length()>50)throw new IOException("CONSTRAINT_LIMIT");
        long[] allowedProducts=new long[productInput.length()];String[] allowedClaims=new String[claimInput.length()];
        for(int i=0;i<productInput.length();i++){Object id=productInput.get(i);if(!(id instanceof Number))throw new IOException("PRODUCT_ID_INVALID");double value=((Number)id).doubleValue();if(!Double.isFinite(value)||value!=Math.rint(value)||value==0||Math.abs(value)>999999999999999L)throw new IOException("PRODUCT_ID_INVALID");allowedProducts[i]=((Number)id).longValue();}
        for(int i=0;i<claimInput.length();i++){Object id=claimInput.get(i);if(!(id instanceof String)||((String)id).isEmpty()||((String)id).getBytes(StandardCharsets.UTF_8).length>100||((String)id).chars().anyMatch(x->x<32||x==127))throw new IOException("CLAIM_ID_INVALID");allowedClaims[i]=(String)id;}
        generationCancelled.set(false);nativeReset();
        if(!foreground)throw new IOException("BACKGROUND");
        if(!getContext().getSharedPreferences("local-ai",0).getBoolean("active",false))throw new IOException("MODEL_DISABLED");
        if(!loaded){cancelDownload.set(false);verify(model);phase="loading";loaded=false;visionLoaded=false;nativeLoad(model.getAbsolutePath());loaded=true;}
        if(generationCancelled.get()||!foreground)throw new IOException("CANCELLED");
        phase="generating";long t=System.nanoTime();nativeInvocationStarted=true;String text=new String(nativeGenerate(prompt,limit,task,allowedProducts,allowedClaims),StandardCharsets.UTF_8);
        double[] m=nativeMetrics();JSObject metrics=new JSObject();metrics.put("model_load_ms",m[0]);metrics.put("first_token_ms",m[1]);metrics.put("generation_ms",m[2]);metrics.put("tokens",(int)m[3]);metrics.put("input_tokens",(int)m[4]);metrics.put("finish_reason",finishReason((int)m[5]));metrics.put("model_id",manifest.getString("id"));metrics.put("model_version",manifest.getString("version"));metrics.put("runtime",manifest.getString("runtime"));
        JSObject out=new JSObject();out.put("text",text);out.put("ms",(System.nanoTime()-t)/1000000);out.put("metrics",metrics);return out;
    });}
    private static String finishReason(int code){return code==1?"stop":code==2?"length":code==3?"cancelled":code==4?"error":"none";}
    /** Manager-only RAW test. Never used by the consultation route or recorded as scientific evidence. */
    @PluginMethod public void diagnose(PluginCall c){run(c,true,()->{
        String question=c.getString("prompt","").trim();int limit=c.getInt("max_tokens",256);
        if(question.isEmpty()||question.length()>4000)throw new IOException("CONTEXT_LIMIT");if(limit<1||limit>256)throw new IOException("OUTPUT_LIMIT");
        if(!foreground)throw new IOException("BACKGROUND");generationCancelled.set(false);cancelDownload.set(false);nativeReset();
        // This diagnostic deliberately tests the local model without plan/schema/retrieval/validator/fallback.
        if(!loaded){verify(model);phase="loading";loaded=false;visionLoaded=false;nativeLoad(model.getAbsolutePath());loaded=true;}
        String prompt="<|im_start|>system\nYou are a beauty and cosmetic science assistant. Answer naturally in Arabic. This is a raw manager diagnostic, not approved advice. Do not reveal hidden reasoning. Do not diagnose, prescribe drugs, invent evidence or provide prices. State uncertainty. /no_think<|im_end|>\n<|im_start|>user\n"+question+"<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
        phase="generating";long started=System.nanoTime();nativeInvocationStarted=true;String text=new String(nativeGenerate(prompt,limit,"diagnostic",new long[0],new String[0]),StandardCharsets.UTF_8);double[] m=nativeMetrics();
        JSObject out=new JSObject();out.put("text",text);out.put("test","RAW_NATIVE_DIAGNOSTIC_NOT_CONSULTATION");out.put("validated",false);out.put("model_id",manifest.getString("id"));out.put("model_version",manifest.getString("version"));out.put("input_tokens",(int)m[4]);out.put("output_tokens",(int)m[3]);out.put("first_token_ms",m[1]);out.put("generation_ms",m[2]);out.put("model_load_ms",m[0]);out.put("elapsed_ms",(System.nanoTime()-started)/1000000);out.put("finish_reason",finishReason((int)m[5]));out.put("loaded",loaded);return out;
    });}
    @PluginMethod public void installVision(PluginCall c){run(c,true,()->{
        if(visionAsset==null)throw new IOException("VISION_MANIFEST_MISSING");cancelDownload.set(false);
        visionAsset.install(cancelDownload,(state,bytes,total)->{phase=state;JSObject p=new JSObject();p.put("bytes",bytes);p.put("total",total);notifyListeners("downloadProgress",p);});return statusObject();
    });}
    @PluginMethod public void removeVision(PluginCall c){run(c,true,()->{
        // Free vision before deleting its mapped projector; the valid text file is preserved.
        nativeUnload();loaded=false;visionLoaded=false;if(visionAsset!=null)visionAsset.remove();return statusObject();
    });}
    /** Raw visual observation for manager review. Never a verified scientific consultation or product identity. */
    @PluginMethod public void describeImage(PluginCall c){run(c,true,()->{
        if(visionAsset==null)throw new IOException("VISION_MANIFEST_MISSING");
        if(!foreground)throw new IOException("BACKGROUND");
        String encoded=c.getString("image_base64","");if(encoded.isEmpty()||encoded.length()>2796204||encoded.startsWith("data:"))throw new IOException("VISION_IMAGE_SIZE");
        byte[] image=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);if(image.length>2097152)throw new IOException("VISION_IMAGE_SIZE");
        String question=c.getString("question","صف النص والألوان والشكل الظاهر فقط، واذكر غير المقروء دون تخمين.").trim();if(question.isEmpty()||question.length()>1000)throw new IOException("VISION_PROMPT_INVALID");
        generationCancelled.set(false);cancelDownload.set(false);nativeReset();
        if(!getContext().getSharedPreferences("local-ai",0).getBoolean("active",false))throw new IOException("MODEL_DISABLED");
        if(!loaded){verify(model);phase="loading";visionLoaded=false;nativeLoad(model.getAbsolutePath());loaded=true;}
        File projector=visionAsset.verify(cancelDownload);if(generationCancelled.get()||!foreground)throw new IOException("CANCELLED");
        phase="loading_vision";nativeLoadVision(projector.getAbsolutePath());visionLoaded=true;
        if(generationCancelled.get()||!foreground)throw new IOException("CANCELLED");
        phase="generating_vision";nativeInvocationStarted=true;
        String text=new String(nativeDescribeImage(image,question,192),StandardCharsets.UTF_8);double[] m=nativeVisionMetrics();
        JSObject out=new JSObject();out.put("text",text);out.put("vision",true);out.put("validated",false);out.put("test","UNVALIDATED_VISUAL_OBSERVATION_NOT_SCIENTIFIC_ADVICE");out.put("model_id",manifest.getString("id"));out.put("model_version",manifest.getString("version"));out.put("projector_sha256",visionAsset.status().getString("verified_sha256"));out.put("projector_load_ms",m[0]);out.put("image_prefill_ms",m[1]);out.put("first_token_ms",m[2]);out.put("generation_ms",m[3]);out.put("input_tokens",(int)m[4]);out.put("image_tokens",(int)m[5]);out.put("output_tokens",(int)m[6]);out.put("finish_reason",finishReason((int)m[7]));out.put("warning","ملاحظة بصرية غير متحققة؛ قد يخطئ النموذج. لا تثبت الهوية أو INCI أو الأصالة أو السلامة أو التوفر.");return out;
    });}
    @PluginMethod public void cancel(PluginCall c){authorized(c,managerOperation,()->{generationCancelled.set(true);if(runtimeError==null)nativeCancel();cancelDownload.set(true);if(visionAsset!=null)visionAsset.cancel();HttpURLConnection con=downloadConnection;if(con!=null)con.disconnect();c.resolve();});}
    @PluginMethod public void reset(PluginCall c){run(c,false,()->{nativeReset();return new JSObject();});}
    @PluginMethod public void test(PluginCall c){run(c,true,()->{
        cancelDownload.set(false);verify(model);boolean wasActive=getContext().getSharedPreferences("local-ai",0).getBoolean("active",false);
        if(!loaded){phase="loading";visionLoaded=false;nativeLoad(model.getAbsolutePath());loaded=true;}nativeReset();
        String prompt="<|im_start|>system\nReturn JSON only: {\"sentences\":[{\"text\":\"test complete\",\"claim_ids\":[\"test\"]}]}<|im_end|>\n<|im_start|>user\nRun the test. /no_think<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
        long started=System.nanoTime();nativeInvocationStarted=true;byte[] result=nativeGenerate(prompt,128,"compose",new long[0],new String[0]);JSObject out=new JSObject();out.put("generated_bytes",result.length);out.put("ms",(System.nanoTime()-started)/1000000);out.put("test","REAL_NATIVE_INFERENCE");
        if(!wasActive){nativeUnload();loaded=false;visionLoaded=false;}return out;
    });}
    public void onProgress(int tokens){JSObject p=new JSObject();p.put("tokens",tokens);notifyListeners("generationProgress",p);}
    @Override protected void handleOnPause(){foreground=false;if(runtimeError!=null)return;nativeCancel();cancelDownload.set(true);if(visionAsset!=null)visionAsset.cancel();executor.execute(()->{nativeUnload();loaded=false;visionLoaded=false;});}
    @Override protected void handleOnResume(){foreground=true;}
    @Override protected void handleOnDestroy(){if(runtimeError==null){nativeCancel();cancelDownload.set(true);if(visionAsset!=null)visionAsset.cancel();executor.execute(()->{nativeUnload();loaded=false;visionLoaded=false;});}grants.clear();denied.clear();}
    public static void trimMemory(){if(nativeReady){nativeCancel();executor.execute(()->{nativeUnload();loaded=false;visionLoaded=false;});}}
}
