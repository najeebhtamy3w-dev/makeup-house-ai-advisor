package com.makeuphouse.advisor;

import java.io.*;
import java.nio.file.Files;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Real local streams/files; the deliberately unresolvable HTTPS source is never contacted. */
public final class VerifiedAssetImportTest {
    interface Action { void run() throws Exception; }
    private static int passed;
    private static final AtomicInteger networkAttempts = new AtomicInteger();
    private static byte[] bytes = new byte[196613];
    private static final byte[] previous = new byte[]{'G','G','U','F',9,8,7,6};
    private static File directory;
    private static final String SOURCE_URL = "https://offline-import-must-not-resolve.invalid/model.gguf";
    private static String sha(byte[] value) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(value)) result.append(String.format("%02x", b & 255));
        return result.toString();
    }
    private static ResumableAssetDownload.DownloadSpec spec(byte[] value) throws Exception {
        return new ResumableAssetDownload.DownloadSpec(SOURCE_URL, value.length, sha(value));
    }
    private static void check(boolean condition, String reason) { if (!condition) throw new AssertionError(reason); }
    private static void test(String name, Action action) throws Exception { action.run(); passed++; System.out.println("PASS " + name); }
    private static File oldTarget(String name) throws Exception {
        File target = new File(directory, name + ".gguf"); Files.write(target.toPath(), previous); return target;
    }
    private static void unchanged(File target) throws Exception {
        check(Arrays.equals(Files.readAllBytes(target.toPath()), previous), "Prior target was modified");
        String[] staging = directory.list((parent, name) -> name.startsWith(".mh-verified-import-"));
        check(staging != null && staging.length == 0, "Owned staging files remain after failure");
    }
    private static void fails(String expected, Action action) throws Exception {
        try { action.run(); throw new AssertionError("Expected failure " + expected); }
        catch (IOException error) { check(error.getMessage().contains(expected), "Unexpected error " + error); }
    }
    public static void main(String[] args) throws Exception {
        URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) {
                networkAttempts.incrementAndGet(); throw new AssertionError("Offline import tried network access");
            }
        } : null);
        directory = Files.createTempDirectory("mh-offline-import-").toFile();
        new Random(79).nextBytes(bytes); System.arraycopy(new byte[]{'G','G','U','F'},0,bytes,0,4);
        test("read-only local source imports without a folder grant or any resolvable network source", () -> {
            File source = new File(directory, "external-original.gguf"); Files.write(source.toPath(), bytes);
            check(source.setReadOnly(), "Could not mark fixture read-only");
            File target = oldTarget("valid"); AtomicInteger callbacks = new AtomicInteger(); AtomicInteger maximumRead = new AtomicInteger();
            AtomicBoolean closed = new AtomicBoolean();
            try (InputStream file = new FileInputStream(source)) {
                InputStream input = new FilterInputStream(file) {
                    @Override public int read(byte[] buffer, int offset, int length) throws IOException { maximumRead.accumulateAndGet(length,Math::max); return super.read(buffer,offset,length); }
                    @Override public void close() throws IOException { closed.set(true); super.close(); }
                };
                File result = VerifiedAssetImport.importTo(input,target,spec(bytes),new AtomicBoolean(),(count,total) -> check(count>=0&&count<=total,"Invalid progress"),() -> { check(Arrays.equals(Files.readAllBytes(target.toPath()),previous),"Target replaced before callback"); callbacks.incrementAndGet(); });
                check(result.equals(target), "Wrong installed target"); check(!closed.get(), "Utility closed caller-owned source");
            }
            check(maximumRead.get()<=65536, "Read exceeds bounded buffer"); check(callbacks.get()==1, "BeforeInstall callback count");
            check(Arrays.equals(Files.readAllBytes(target.toPath()),bytes),"Installed bytes differ");
            check(Arrays.equals(Files.readAllBytes(source.toPath()),bytes),"Read-only original modified");
        });
        test("SHA corruption cannot replace a valid existing target", () -> {
            File target=oldTarget("hash"); byte[] corrupt=bytes.clone();corrupt[500]^=1;AtomicInteger callback=new AtomicInteger();
            fails("DOWNLOAD_SHA256_MISMATCH",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(corrupt),target,spec(bytes),new AtomicBoolean(),null,callback::incrementAndGet));
            unchanged(target);check(callback.get()==0,"Callback before verification");
        });
        test("short input retains prior asset and does not invoke installer", () -> {
            File target=oldTarget("short");AtomicInteger callback=new AtomicInteger();
            fails("IMPORT_SIZE_MISMATCH",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(Arrays.copyOf(bytes,300)),target,spec(bytes),new AtomicBoolean(),null,callback::incrementAndGet));
            unchanged(target);check(callback.get()==0,"Installer invoked for short input");
        });
        test("oversized input is rejected before bytes beyond the declared size are written", () -> {
            File target=oldTarget("oversize");byte[] tooLarge=Arrays.copyOf(bytes,bytes.length+1);AtomicInteger callback=new AtomicInteger();
            fails("IMPORT_SIZE_MISMATCH",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(tooLarge),target,spec(bytes),new AtomicBoolean(),null,callback::incrementAndGet));
            unchanged(target);check(callback.get()==0,"Installer invoked for oversized input");
        });
        test("matching hash for non-GGUF bytes still rejects the asset", () -> {
            File target=oldTarget("magic");byte[] bad=bytes.clone();bad[0]='X';AtomicInteger callback=new AtomicInteger();
            fails("DOWNLOAD_GGUF_HEADER",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(bad),target,spec(bad),new AtomicBoolean(),null,callback::incrementAndGet));
            unchanged(target);check(callback.get()==0,"Installer invoked for non-GGUF");
        });
        test("USB disconnection after partial reads preserves existing target and caller source ownership", () -> {
            File target=oldTarget("usb");AtomicInteger callback=new AtomicInteger();AtomicBoolean closed=new AtomicBoolean();
            InputStream interrupted=new InputStream(){int count;@Override public int read() throws IOException{throw new IOException("USB_DISCONNECTED");}
                @Override public int read(byte[] buffer,int offset,int length)throws IOException{if(count>0)throw new IOException("USB_DISCONNECTED");int n=Math.min(length,4096);System.arraycopy(bytes,0,buffer,offset,n);count+=n;return n;}
                @Override public void close(){closed.set(true);}};
            fails("USB_DISCONNECTED",()->VerifiedAssetImport.importTo(interrupted,target,spec(bytes),new AtomicBoolean(),null,callback::incrementAndGet));
            unchanged(target);check(callback.get()==0&&!closed.get(),"Installer invoked or external stream closed");
        });
        test("cancellation during streaming preserves target without invoking installer", () -> {
            File target=oldTarget("cancel");AtomicInteger callback=new AtomicInteger();AtomicBoolean cancel=new AtomicBoolean();
            fails("IMPORT_CANCELLED",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(bytes),target,spec(bytes),cancel,(n,total)->{if(n>0)cancel.set(true);},callback::incrementAndGet));
            unchanged(target);check(callback.get()==0,"Installer invoked after cancellation");
        });
        test("pre-cancelled import does not read the external source", () -> {
            File target=oldTarget("pre-cancel");AtomicInteger reads=new AtomicInteger(),callback=new AtomicInteger();
            InputStream input=new InputStream(){@Override public int read(){reads.incrementAndGet();return -1;}};
            fails("IMPORT_CANCELLED",()->VerifiedAssetImport.importTo(input,target,spec(bytes),new AtomicBoolean(true),null,callback::incrementAndGet));
            unchanged(target);check(reads.get()==0&&callback.get()==0,"Cancelled import touched source/installer");
        });
        test("failure while releasing native runtime leaves prior bytes untouched", () -> {
            File target=oldTarget("callback");
            fails("NATIVE_RELEASE_FAILED",()->VerifiedAssetImport.importTo(new ByteArrayInputStream(bytes),target,spec(bytes),new AtomicBoolean(),null,()->{throw new IOException("NATIVE_RELEASE_FAILED");}));unchanged(target);
        });
        check(networkAttempts.get()==0,"Network access was attempted");
        System.out.println("NETWORK_REQUESTS=0");
        System.out.println("PASSED "+passed+" real offline import checks (NOT ANDROID/SAF FIELD ACCEPTANCE)");
    }
}
