package com.makeuphouse.advisor;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Optional projector only. The authenticated plugin serializes calls with the text runtime.
 * This class neither loads a model nor uploads images; installation is not vision acceptance. */
public final class VisionAsset {
    public interface Progress { void update(String phase, long bytes, long total); }
    private static final long EXPECTED_SIZE = 668227264L;
    private static final String REVISION = "f6d5376be1edb4d416d56da11e5397a961aca8ae";
    private static final String HASH = "7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7";
    private static final String URL_PIN = "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/" + REVISION + "/mmproj-F16.gguf";
    private final File directory, file, partial;
    private volatile long verifiedLength = -1, verifiedModified = -1;
    private volatile String verifiedHash;
    private volatile HttpURLConnection connection;
    private volatile AtomicBoolean activeCancel;

    public VisionAsset(Context context, JSONObject manifest) throws Exception {
        if (!manifest.getString("id").equals("qwen35-2b-vision-projector-f16") ||
            !manifest.getString("model_id").equals("qwen35-2b-q4km") ||
            !manifest.getString("version").equals(REVISION) || manifest.getLong("size") != EXPECTED_SIZE ||
            !manifest.getString("sha256").equals(HASH) || !manifest.getString("url").equals(URL_PIN))
            throw new IOException("VISION_MANIFEST_MISMATCH");
        directory = new File(context.getNoBackupFilesDir(), "local-ai");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("VISION_STORAGE");
        file = new File(directory, "vision-projector.gguf");
        partial = new File(directory, "vision-projector.part");
        checkPaths();
    }

    private void checkPaths() throws IOException {
        String prefix = directory.getCanonicalPath() + File.separator;
        if (!file.getCanonicalPath().equals(prefix + file.getName()) ||
            !partial.getCanonicalPath().equals(prefix + partial.getName())) throw new IOException("VISION_ASSET_PATH");
    }
    private static void checkCancelled(AtomicBoolean cancelled) throws IOException {
        if (cancelled.get() || Thread.currentThread().isInterrupted()) throw new IOException("CANCELLED");
    }
    /** Metadata cache reports only this process's prior successful full verification. */
    public JSONObject status() throws Exception {
        checkPaths(); boolean verified = file.isFile() && HASH.equals(verifiedHash) && file.length() == verifiedLength && file.lastModified() == verifiedModified;
        JSONObject out = new JSONObject(); out.put("id", "qwen35-2b-vision-projector-f16");out.put("version", REVISION);
        out.put("installed", file.isFile());out.put("verified", verified);out.put("verified_sha256", verified ? HASH : JSONObject.NULL);
        out.put("size", EXPECTED_SIZE);out.put("downloaded", partial.isFile() ? partial.length() : 0);
        out.put("acceptance", "PROJECTOR_INSTALLATION_IS_NOT_VISION_ACCEPTANCE");return out;
    }
    /** Full size/hash/GGUF verification; no automatic repair or replacement of an existing file. */
    public synchronized File verify(AtomicBoolean cancelled) throws Exception {
        checkPaths(); verifyFile(file, EXPECTED_SIZE, HASH, cancelled);
        verifiedLength = file.length();verifiedModified = file.lastModified();verifiedHash = HASH;return file;
    }
    static void verifyFile(File source, long expectedSize, String expectedHash, AtomicBoolean cancelled) throws Exception {
        checkCancelled(cancelled);
        if (!source.isFile() || source.length() != expectedSize) throw new IOException("VISION_SIZE_MISMATCH");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");byte[] buffer = new byte[1024 * 1024];
        try (InputStream in = new FileInputStream(source)) { int count;while ((count = in.read(buffer)) != -1) {checkCancelled(cancelled);digest.update(buffer, 0, count);} }
        StringBuilder hex = new StringBuilder();for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        if (!hex.toString().equals(expectedHash)) throw new IOException("VISION_HASH_MISMATCH");
        try (RandomAccessFile in = new RandomAccessFile(source, "r")) {if (in.readInt() != 0x47475546) throw new IOException("VISION_FORMAT_INVALID");}
    }
    static boolean validRange(String value, long offset, long size) {
        if (value == null || !value.matches("bytes [0-9]+-[0-9]+/[0-9]+")) return false;
        try {String[] p = value.substring(6).split("[-/]");long start=Long.parseLong(p[0]),end=Long.parseLong(p[1]),total=Long.parseLong(p[2]);return start==offset && end>=start && end<size && total==size;}
        catch (NumberFormatException e) {return false;}
    }
    private static void privateFile(File target) throws IOException {
        if (!target.setReadable(false, false) || !target.setWritable(false, false) || !target.setReadable(true, true) || !target.setWritable(true, true)) throw new IOException("VISION_FILE_PERMISSIONS");
    }
    public void cancel() {AtomicBoolean flag=activeCancel;if(flag!=null)flag.set(true);HttpURLConnection current=connection;if(current!=null)current.disconnect();}
    public synchronized File install(AtomicBoolean cancelled, Progress progress) throws Exception {
        checkPaths();checkCancelled(cancelled);activeCancel=cancelled;
        try {
            if (file.isFile()) {progress.update("verifying", file.length(), EXPECTED_SIZE);return verify(cancelled);}
            long offset=partial.isFile()?partial.length():0;
            if(offset>EXPECTED_SIZE)throw new IOException("VISION_PARTIAL_TOO_LARGE");
            if(directory.getUsableSpace()<EXPECTED_SIZE-offset+128L*1024*1024)throw new IOException("INSUFFICIENT_STORAGE");
            if(offset<EXPECTED_SIZE){
                URL url=new URL(URL_PIN);boolean completed=false;
                for(int redirects=0;redirects<6;redirects++){
                    checkCancelled(cancelled);if(!url.getProtocol().equals("https"))throw new IOException("UNSAFE_REDIRECT");
                    HttpURLConnection current=(HttpURLConnection)url.openConnection();connection=current;
                    try {
                        current.setInstanceFollowRedirects(false);current.setConnectTimeout(20000);current.setReadTimeout(20000);current.setRequestProperty("Accept-Encoding","identity");
                        if(offset>0)current.setRequestProperty("Range","bytes="+offset+"-");
                        int code=current.getResponseCode();checkCancelled(cancelled);
                        if(code>=300&&code<400){String location=current.getHeaderField("Location");if(location==null)throw new IOException("VISION_REDIRECT");url=new URL(url,location);continue;}
                        if(code!=200&&code!=206)throw new IOException("VISION_HTTP_"+code);
                        if(code==206&&!validRange(current.getHeaderField("Content-Range"),offset,EXPECTED_SIZE))throw new IOException("VISION_DOWNLOAD_RANGE");
                        if(code==200)offset=0; // Server ignored Range: truncate and restart, never append a full response.
                        try(InputStream in=current.getInputStream();FileOutputStream out=new FileOutputStream(partial,offset>0)){
                            privateFile(partial);byte[] buffer=new byte[256*1024];int count;long total=offset,last=0;
                            while((count=in.read(buffer))!=-1){checkCancelled(cancelled);total+=count;if(total>EXPECTED_SIZE)throw new IOException("VISION_TOO_LARGE");out.write(buffer,0,count);long now=System.nanoTime();if(now-last>250000000L){progress.update("downloading",total,EXPECTED_SIZE);last=now;}}
                            out.getFD().sync();
                        }
                        completed=true;break;
                    } finally {current.disconnect();if(connection==current)connection=null;}
                }
                if(!completed)throw new IOException("VISION_REDIRECT_LIMIT");
            }
            progress.update("verifying",partial.length(),EXPECTED_SIZE);verifyFile(partial,EXPECTED_SIZE,HASH,cancelled);checkCancelled(cancelled);
            // Private same-filesystem rename is atomic; approved.gguf and all databases are untouched.
            android.system.Os.rename(partial.getAbsolutePath(),file.getAbsolutePath());privateFile(file);
            verifiedLength=file.length();verifiedModified=file.lastModified();verifiedHash=HASH;progress.update("verified",EXPECTED_SIZE,EXPECTED_SIZE);return file;
        } finally {connection=null;activeCancel=null;}
    }
    public synchronized void remove() throws Exception {
        checkPaths();verifiedLength=-1;verifiedModified=-1;verifiedHash=null;
        if(file.exists()&&!file.delete())throw new IOException("VISION_REMOVE_FAILED");
        if(partial.exists()&&!partial.delete())throw new IOException("VISION_REMOVE_FAILED");
    }
}
