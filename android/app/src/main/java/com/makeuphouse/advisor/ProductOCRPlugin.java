package com.makeuphouse.advisor;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.googlecode.tesseract.android.TessBaseAPI;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Offline text extraction only. Output is untrusted evidence, never product identity approval. */
@CapacitorPlugin(name="ProductOCR")
public class ProductOCRPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false), cancelled = new AtomicBoolean(false);
    private final Map<String,Runnable> grants = new ConcurrentHashMap<>();
    private final Map<String,PluginCall> pending = new ConcurrentHashMap<>();
    private final Object engineLock = new Object();
    private volatile TessBaseAPI engine;
    private volatile boolean destroyed=false;
    private void authorized(PluginCall call, Runnable work) {
        if(destroyed){call.reject("OCR_UNAVAILABLE");return;}
        String nonce = UUID.randomUUID().toString();
        grants.put(nonce, work); pending.put(nonce, call);
        timer.schedule(() -> { grants.remove(nonce); PluginCall p = pending.remove(nonce); if(p!=null)p.reject("AUTH_TIMEOUT"); }, 10, TimeUnit.SECONDS);
        String js="(async()=>{let ok=false;try{const r=await fetch('/api/auth/me',{headers:{authorization:'Bearer '+"+JSONObject.quote(call.getString("token",""))+"}});const j=await r.json();ok=r.ok&&!!j.user&&(j.user.role==='manager'||j.user.role==='staff');}catch(e){}window.Capacitor.Plugins.ProductOCR.authorizationResult({nonce:"+JSONObject.quote(nonce)+",ok});})()";
        getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js,null));
    }
    @PluginMethod public void authorizationResult(PluginCall call) {
        String nonce=call.getString("nonce",""); Runnable work=grants.remove(nonce); PluginCall original=pending.remove(nonce);
        if(work!=null&&original!=null){if(Boolean.TRUE.equals(call.getBoolean("ok",false)))work.run();else original.reject("FORBIDDEN");} call.resolve();
    }
    @PluginMethod public void capabilities(PluginCall call) { authorized(call,()->{
        JSObject result=new JSObject(); result.put("ocr",true);result.put("vision",false);result.put("engine","Tesseract4Android 4.9.0");result.put("languages","eng+ara");result.put("offline",true);result.put("busy",busy.get());result.put("max_image_bytes",2097152);result.put("max_pixels",8000000);result.put("timeout_ms",20000);result.put("acceptance","ANDROID_NOT_TESTED"); call.resolve(result);
    });}
    private void stop(TessBaseAPI expected) { synchronized(engineLock){if(engine!=null&&engine==expected){cancelled.set(true);engine.stop();}} }
    private void requestCancel() {
        cancelled.set(true);
        // Never wait for native initialization on the UI thread.
        final TessBaseAPI requested=engine;
        timer.execute(()->{synchronized(engineLock){if(requested!=null&&engine==requested)requested.stop();}});
    }
    @PluginMethod public void cancel(PluginCall call){ authorized(call,()->{requestCancel();call.resolve();}); }
    private File prepare() throws Exception {
        File root=new File(getContext().getFilesDir(),"ocr"), data=new File(root,"tessdata"); if(!data.exists()&&!data.mkdirs())throw new IOException("OCR_STORAGE");
        JSONObject manifest;
        try(InputStream in=getContext().getAssets().open("ocr/manifest.json")){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);manifest=new JSONObject(out.toString("UTF-8"));}
        for(int i=0;i<manifest.getJSONArray("models").length();i++){
            JSONObject item=manifest.getJSONArray("models").getJSONObject(i);String id=item.getString("id");if(!id.equals("eng")&&!id.equals("ara"))throw new IOException("OCR_MANIFEST");
            File file=new File(data,id+".traineddata");
            if(!valid(file,item)){File part=new File(data,id+".part");try(InputStream in=getContext().getAssets().open("ocr/tessdata/"+id+".traineddata");OutputStream out=new FileOutputStream(part)){byte[] b=new byte[65536];int n;long size=0;while((n=in.read(b))!=-1){size+=n;if(size>item.getLong("size"))throw new IOException("OCR_ASSET_SIZE");out.write(b,0,n);}}if(!valid(part,item))throw new IOException("OCR_ASSET_HASH");if(!part.renameTo(file))throw new IOException("OCR_ASSET_INSTALL");}
        }return root;
    }
    private boolean valid(File file,JSONObject item)throws Exception {if(!file.isFile()||file.length()!=item.getLong("size"))return false;MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",b));return hex.toString().equals(item.getString("sha256"));}
    @PluginMethod public void recognize(PluginCall call) { authorized(call,()->{
        if(destroyed){call.reject("OCR_UNAVAILABLE");return;}
        if(!busy.compareAndSet(false,true)){call.reject("OCR_BUSY");return;}cancelled.set(false);
        worker.execute(()->{Bitmap bitmap=null;ScheduledFuture<?> deadline=null;long started=System.nanoTime();try{
            String input=call.getString("image_base64","");if(input.length()>2796204||input.length()==0||input.startsWith("data:"))throw new IOException("OCR_IMAGE_SIZE_OR_FORMAT");
            byte[] bytes=Base64.decode(input,Base64.DEFAULT);if(bytes.length>2097152)throw new IOException("OCR_IMAGE_TOO_LARGE");
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);if(bounds.outWidth<=0||bounds.outHeight<=0||(long)bounds.outWidth*bounds.outHeight>8000000)throw new IOException("OCR_IMAGE_DIMENSIONS");
            BitmapFactory.Options options=new BitmapFactory.Options();options.inPreferredConfig=Bitmap.Config.ARGB_8888;bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException("OCR_IMAGE_DECODE");
            File root=prepare();if(cancelled.get())throw new IOException("OCR_CANCELLED");
            synchronized(engineLock){engine=new TessBaseAPI();if(!engine.init(root.getAbsolutePath(),"eng+ara",TessBaseAPI.OEM_LSTM_ONLY))throw new IOException("OCR_INIT_FAILED");}
            if(cancelled.get())throw new IOException("OCR_CANCELLED");
            engine.setImage(bitmap);final TessBaseAPI requestEngine=engine;deadline=timer.schedule(()->stop(requestEngine),20,TimeUnit.SECONDS);
            // getUTF8Text alone is not interruptible. hOCR recognition explicitly supports stop().
            engine.getHOCRText(0);if(cancelled.get())throw new IOException("OCR_CANCELLED_OR_TIMEOUT");
            String text=engine.getUTF8Text();if(cancelled.get())throw new IOException("OCR_CANCELLED_OR_TIMEOUT");if(text==null)text="";if(text.length()>16000)throw new IOException("OCR_OUTPUT_TOO_LARGE");
            int confidence=engine.meanConfidence();JSObject result=new JSObject();result.put("ocr",true);result.put("vision",false);result.put("text",text);result.put("mean_confidence",confidence);result.put("language","eng+ara");result.put("warning","نص OCR غير مُراجع؛ راجع الحروف والمكونات. لا يثبت هوية المنتج أو أصالته أو سلامته.");result.put("duration_ms",(System.nanoTime()-started)/1000000);JSArray blocks=new JSArray();for(String line:text.split("\\n")){if(blocks.length()>=200)break;if(!line.trim().isEmpty()){JSObject block=new JSObject();block.put("text",line);block.put("kind","text_line_candidate");blocks.put(block);}}result.put("candidate_blocks",blocks);call.resolve(result);
        }catch(Throwable error){call.reject(error instanceof OutOfMemoryError?"OCR_MEMORY_LIMIT":error.getMessage()==null?"OCR_FAILED":error.getMessage());}
        finally{if(deadline!=null)deadline.cancel(false);synchronized(engineLock){if(engine!=null){engine.recycle();engine=null;}}if(bitmap!=null)bitmap.recycle();busy.set(false);}});
    });}
    @Override protected void handleOnDestroy(){
        destroyed=true;requestCancel();
        for(PluginCall call:pending.values())call.reject("OCR_UNAVAILABLE");pending.clear();grants.clear();
        worker.shutdown();timer.shutdown();super.handleOnDestroy();
    }
}
