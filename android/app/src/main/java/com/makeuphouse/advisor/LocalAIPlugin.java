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
    private static volatile boolean loaded=false, nativeReady=false;
    private volatile boolean foreground=true;
    private volatile boolean managerOperation=false;
    private volatile HttpURLConnection downloadConnection;
    private JSONObject manifest;
    private File directory, model, partial;
    private String runtimeError=null;
    private static native void nativeLoad(String path);
    private static native void nativeUnload();
    private static native void nativeReset();
    private static native void nativeCancel();
    private native byte[] nativeGenerate(String prompt,int limit,String task);
    private static native double[] nativeMetrics();
    @Override public void load() {
        directory=new File(getContext().getNoBackupFilesDir(),"local-ai");directory.mkdirs();
        model=new File(directory,"approved.gguf");partial=new File(directory,"approved.part");
        try(InputStream in=getContext().getAssets().open("model-manifest.json")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1)bytes.write(chunk,0,n);
            manifest=new JSONObject(bytes.toString("UTF-8"));
            System.loadLibrary("mh_local_ai");
            nativeReady=true;
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
        executor.execute(()->{try{if(runtimeError!=null)throw new IOException(runtimeError);call.resolve(work.call());}catch(Throwable e){call.reject(e.getMessage()==null?"RUNTIME_FAILED":e.getMessage());}finally{managerOperation=false;busy.set(false);}});
    });}
    private JSObject statusObject() throws Exception {
        JSObject out=new JSObject();out.put("runtime",manifest==null?"unavailable":manifest.getString("runtime"));out.put("manifest",manifest);
        out.put("installed",model.isFile());out.put("active",getContext().getSharedPreferences("local-ai",0).getBoolean("active",false));
        out.put("loaded",loaded);out.put("busy",busy.get());out.put("free_bytes",directory.getUsableSpace());out.put("downloaded",partial.length());out.put("error",runtimeError);
        out.put("abis",android.os.Build.SUPPORTED_ABIS);out.put("device",android.os.Build.MODEL);out.put("hardware",android.os.Build.HARDWARE);return out;
    }
    @PluginMethod public void status(PluginCall c){authorized(c,false,()->{try{c.resolve(statusObject());}catch(Exception e){c.reject("STATUS_FAILED");}});}
    private void verify(File f) throws Exception {
        if(f.length()!=manifest.getLong("size"))throw new IOException("MODEL_SIZE_MISMATCH");
        MessageDigest md=MessageDigest.getInstance("SHA-256");byte[] buf=new byte[1024*1024];
        try(InputStream in=new FileInputStream(f)){int n;while((n=in.read(buf))!=-1){if(cancelDownload.get())throw new IOException("CANCELLED");md.update(buf,0,n);}}
        StringBuilder hex=new StringBuilder();for(byte b:md.digest())hex.append(String.format("%02x",b));
        if(!hex.toString().equals(manifest.getString("sha256")))throw new IOException("MODEL_HASH_MISMATCH");
        try(RandomAccessFile in=new RandomAccessFile(f,"r")){if(in.readInt()!=0x47475546)throw new IOException("MODEL_FORMAT_INVALID");}
    }
    @PluginMethod public void install(PluginCall c){run(c,true,()->{
        cancelDownload.set(false);long expected=manifest.getLong("size"),offset=partial.length();
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
        verify(partial);nativeUnload();loaded=false;
        android.system.Os.rename(partial.getAbsolutePath(),model.getAbsolutePath());
        return statusObject();
    });}
    @PluginMethod public void activate(PluginCall c){run(c,true,()->{cancelDownload.set(false);verify(model);nativeLoad(model.getAbsolutePath());loaded=true;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",true).apply();return statusObject();});}
    @PluginMethod public void deactivate(PluginCall c){run(c,true,()->{nativeUnload();loaded=false;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",false).apply();return statusObject();});}
    @PluginMethod public void remove(PluginCall c){run(c,true,()->{nativeUnload();loaded=false;getContext().getSharedPreferences("local-ai",0).edit().putBoolean("active",false).apply();if(model.exists()&&!model.delete())throw new IOException("REMOVE_FAILED");if(partial.exists()&&!partial.delete())throw new IOException("REMOVE_FAILED");return statusObject();});}
    @PluginMethod public void generate(PluginCall c){run(c,false,()->{
        String task=c.getString("task","compose");
        if(!task.equals("compose")&&!task.equals("plan")&&!task.equals("decision"))throw new IOException("TASK_INVALID");
        int cap=task.equals("compose")?384:768,limit=c.getInt("max_tokens",cap);
        if(limit<1||limit>cap)throw new IOException("OUTPUT_LIMIT");
        String prompt=c.getString("prompt","");if(prompt.isEmpty()||prompt.length()>(task.equals("compose")?12000:24000))throw new IOException("CONTEXT_LIMIT");
        generationCancelled.set(false);nativeReset();
        if(!foreground)throw new IOException("BACKGROUND");
        if(!getContext().getSharedPreferences("local-ai",0).getBoolean("active",false))throw new IOException("MODEL_DISABLED");
        if(!loaded){cancelDownload.set(false);verify(model);nativeLoad(model.getAbsolutePath());loaded=true;}
        if(generationCancelled.get()||!foreground)throw new IOException("CANCELLED");
        long t=System.nanoTime();String text=new String(nativeGenerate(prompt,limit,task),StandardCharsets.UTF_8);
        double[] m=nativeMetrics();JSObject metrics=new JSObject();metrics.put("model_load_ms",m[0]);metrics.put("first_token_ms",m[1]);metrics.put("generation_ms",m[2]);metrics.put("tokens",(int)m[3]);
        JSObject out=new JSObject();out.put("text",text);out.put("ms",(System.nanoTime()-t)/1000000);out.put("metrics",metrics);return out;
    });}
    @PluginMethod public void cancel(PluginCall c){authorized(c,managerOperation,()->{generationCancelled.set(true);if(runtimeError==null)nativeCancel();cancelDownload.set(true);HttpURLConnection con=downloadConnection;if(con!=null)con.disconnect();c.resolve();});}
    @PluginMethod public void reset(PluginCall c){run(c,false,()->{nativeReset();return new JSObject();});}
    @PluginMethod public void test(PluginCall c){run(c,true,()->{
        cancelDownload.set(false);verify(model);boolean wasActive=getContext().getSharedPreferences("local-ai",0).getBoolean("active",false);
        if(!loaded){nativeLoad(model.getAbsolutePath());loaded=true;}nativeReset();
        String prompt="<|im_start|>system\nReturn JSON only: {\"sentences\":[{\"text\":\"test complete\",\"claim_ids\":[\"test\"]}]}<|im_end|>\n<|im_start|>user\nRun the test. /no_think<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
        long started=System.nanoTime();byte[] result=nativeGenerate(prompt,128,"compose");JSObject out=new JSObject();out.put("generated_bytes",result.length);out.put("ms",(System.nanoTime()-started)/1000000);out.put("test","REAL_NATIVE_INFERENCE");
        if(!wasActive){nativeUnload();loaded=false;}return out;
    });}
    public void onProgress(int tokens){JSObject p=new JSObject();p.put("tokens",tokens);notifyListeners("generationProgress",p);}
    @Override protected void handleOnPause(){foreground=false;if(runtimeError!=null)return;nativeCancel();cancelDownload.set(true);executor.execute(()->{nativeUnload();loaded=false;});}
    @Override protected void handleOnResume(){foreground=true;}
    @Override protected void handleOnDestroy(){if(runtimeError==null){nativeCancel();cancelDownload.set(true);executor.execute(()->{nativeUnload();loaded=false;});}grants.clear();denied.clear();}
    public static void trimMemory(){if(nativeReady){nativeCancel();executor.execute(()->{nativeUnload();loaded=false;});}}
}
