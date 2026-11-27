package com.makeuphouse.advisor;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real loopback HTTP; no external models/network and no Android dependencies. */
public final class ResumableAssetDownloadTest {
    interface Action { void run() throws Exception; }
    interface Handler { void handle(HttpExchange e) throws Exception; }
    static int passed;
    static byte[] data = new byte[131072];
    static File root;
    static HttpServer server;
    static String base;
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static String hash(byte[] bytes) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder s = new StringBuilder();
        for (byte b : h) s.append(String.format("%02x", b & 255)); return s.toString();
    }
    static void test(String name, Action a) throws Exception { a.run(); passed++; System.out.println("PASS " + name); }
    static void path(String path, Handler h) {
        server.createContext(path, e -> { try { h.handle(e); } catch (Exception ignored) { e.close(); } });
    }
    static File partial(String name) { return new File(root, name + ".part"); }
    static File meta(String name) { return new File(root, name + ".properties"); }
    static ResumableAssetDownload downloader(String route, int attempts) throws Exception {
        return ResumableAssetDownload.forLoopbackTest(new ResumableAssetDownload.DownloadSpec(base + route, data.length, hash(data)), attempts, 1000);
    }
    static void failure(String code, Action action) throws Exception {
        try { action.run(); throw new AssertionError("Expected " + code); }
        catch (IOException e) { check(e.getMessage().contains(code), "Wrong failure: " + e); }
    }
    static void good(File file) throws Exception { check(Arrays.equals(data, Files.readAllBytes(file.toPath())), "Exact final fixture differs"); }
    static long offset(HttpExchange e) {
        String r = e.getRequestHeaders().getFirst("Range");
        return r == null ? 0 : Long.parseLong(r.substring(6, r.length()-1));
    }
    static void send(HttpExchange e, int status, long start, long end, String etag) throws Exception {
        if (etag != null) e.getResponseHeaders().set("ETag", etag);
        if (status == 206) e.getResponseHeaders().set("Content-Range", "bytes " + start + "-" + end + "/" + data.length);
        e.sendResponseHeaders(status, end - start + 1);
        try (OutputStream out = e.getResponseBody()) { out.write(data, (int)start, (int)(end-start+1)); }
    }

    public static void main(String[] args) throws Exception {
        new Random(76).nextBytes(data); System.arraycopy(new byte[]{'G','G','U','F'},0,data,0,4);
        root = Files.createTempDirectory("mh-resume-test-").toFile();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        ExecutorService workers = Executors.newCachedThreadPool(); server.setExecutor(workers);
        base = "http://127.0.0.1:" + server.getAddress().getPort(); server.start();
        try {
            test("bounded206 segments continue with exact Range and If-Range", () -> {
                AtomicInteger calls = new AtomicInteger(); AtomicBoolean validators = new AtomicBoolean(true);
                path("/segments", e -> { long start=offset(e); calls.incrementAndGet();
                    if(start>0 && !"\"fixture-v1\"".equals(e.getRequestHeaders().getFirst("If-Range")))validators.set(false);
                    send(e,206,start,Math.min(data.length-1,start+16383),"\"fixture-v1\""); });
                File f=downloader("/segments",2).download(partial("segments"),meta("segments"),new AtomicBoolean(),null);
                good(f); check(calls.get()==8 && validators.get(),"Segment continuation/validator missing");
            });
            test("dropped200 body retained then resumed206", () -> {
                AtomicInteger calls=new AtomicInteger();
                path("/drop", e -> { if(calls.getAndIncrement()==0){e.getResponseHeaders().set("ETag","\"drop-v1\"");e.sendResponseHeaders(200,data.length);e.getResponseBody().write(data,0,32768);e.getResponseBody().flush();e.close();}
                    else {check(offset(e)==32768,"Lost partial after unexpected EOF");send(e,206,32768,data.length-1,"\"drop-v1\"");} });
                good(downloader("/drop",3).download(partial("drop"),meta("drop"),new AtomicBoolean(),null));check(calls.get()==2,"Unexpected extra requests");
            });
            test("persistentEOF keeps bytes and source metadata", () -> {
                path("/eof",e->{e.getResponseHeaders().set("ETag","\"eof-v1\"");e.sendResponseHeaders(200,data.length);e.getResponseBody().write(data,0,8192);e.getResponseBody().flush();e.close();});
                failure("DOWNLOAD_UNEXPECTED_EOF",()->downloader("/eof",1).download(partial("eof"),meta("eof"),new AtomicBoolean(),null));
                check(partial("eof").length()==8192&&meta("eof").isFile(),"Failed stream discarded partial/metadata");
            });
            test("200 ignores Range preserves existing bytes without truncate", () -> {
                byte[] before=Arrays.copyOf(data,4096);Files.write(partial("ignored").toPath(),before);
                path("/ignored",e->send(e,200,0,data.length-1,"\"v2\""));
                failure("RANGE_NOT_SUPPORTED_WITH_PARTIAL",()->downloader("/ignored",2).download(partial("ignored"),meta("ignored"),new AtomicBoolean(),null));
                check(Arrays.equals(before,Files.readAllBytes(partial("ignored").toPath())),"Ignored Range destroyed partial");
            });
            test("416 never destroys partial and valid complete bypasses network", () -> {
                AtomicInteger calls=new AtomicInteger();path("/range416",e->{calls.incrementAndGet();e.getResponseHeaders().set("Content-Range","bytes */"+data.length);e.sendResponseHeaders(416,-1);e.close();});
                Files.write(partial("complete").toPath(),data);good(downloader("/range416",2).download(partial("complete"),meta("complete"),new AtomicBoolean(),null));check(calls.get()==0,"Valid complete unnecessarily fetched");
                byte[] before=Arrays.copyOf(data,4096);Files.write(partial("range416").toPath(),before);
                failure("DOWNLOAD_RANGE_UNSATISFIED_REFRESH",()->downloader("/range416",2).download(partial("range416"),meta("range416"),new AtomicBoolean(),null));
                check(Arrays.equals(before,Files.readAllBytes(partial("range416").toPath())),"416 discarded partial");
            });
            test("malformed numeric and mismatched Content-Range rejected before write", () -> {
                String[] ranges={"bytes 0-999999999999999999999999/131072","bytes 1-3/131072","bytes 0-3/*","bytes 0-131072/131072","bytes 0-3/131073","bytes 0--1/131072"};
                for(int i=0;i<ranges.length;i++){final String range=ranges[i];String route="/bad-range-"+i;final String name="bad-range-"+i;
                    path(route,e->{e.getResponseHeaders().set("Content-Range",range);e.sendResponseHeaders(206,4);try(OutputStream out=e.getResponseBody()){out.write(data,0,4);}});
                    failure("DOWNLOAD_RANGE",()->downloader(route,1).download(partial(name),meta(name),new AtomicBoolean(),null));check(partial(name).length()==0,"Invalid range wrote bytes");}
            });
            test("expired signed redirect retries ORIGINAL pinned URL", () -> {
                AtomicInteger originals=new AtomicInteger();path("/pinned",e->{int n=originals.incrementAndGet();e.getResponseHeaders().set("Location",n==1?"/expired":"/fresh");e.sendResponseHeaders(302,-1);e.close();});
                path("/expired",e->{e.sendResponseHeaders(403,-1);e.close();});path("/fresh",e->send(e,200,0,data.length-1,"\"fresh\""));
                good(downloader("/pinned",3).download(partial("pinned"),meta("pinned"),new AtomicBoolean(),null));check(originals.get()==2,"Retried expired CDN URL");
            });
            test("ETag change does not append new representation", () -> {
                AtomicInteger calls=new AtomicInteger();path("/etag",e->{int n=calls.getAndIncrement();long start=offset(e);if(n==0){send(e,206,0,4095,"\"old\"");}else if(n==1){check("\"old\"".equals(e.getRequestHeaders().getFirst("If-Range")),"Missing If-Range");send(e,206,start,data.length-1,"\"new\"");}else send(e,200,0,data.length-1,"\"new\"");});
                failure("RANGE_NOT_SUPPORTED_WITH_PARTIAL",()->downloader("/etag",3).download(partial("etag"),meta("etag"),new AtomicBoolean(),null));
                check(Arrays.equals(Arrays.copyOf(data,4096),Files.readAllBytes(partial("etag").toPath())),"Mixed ETag bytes appended");
            });
            test("wrong hash and wrong GGUF never return installed result", () -> {
                path("/wronghash",e->{byte[] corrupt=data.clone();corrupt[100]^=1;e.sendResponseHeaders(200,corrupt.length);try(OutputStream out=e.getResponseBody()){out.write(corrupt);}});
                failure("DOWNLOAD_SHA256_MISMATCH",()->downloader("/wronghash",2).download(partial("wronghash"),meta("wronghash"),new AtomicBoolean(),null));check(partial("wronghash").length()==data.length,"Hash failure discarded bytes");
                path("/html",e->{byte[] corrupt=data.clone();corrupt[0]='<';e.sendResponseHeaders(200,corrupt.length);try(OutputStream out=e.getResponseBody()){out.write(corrupt);}});
                failure("DOWNLOAD_GGUF_HEADER",()->downloader("/html",2).download(partial("html"),meta("html"),new AtomicBoolean(),null));
            });
            test("cancellation preserves partial and affects only owning downloader", () -> {
                path("/cancel",e->send(e,200,0,data.length-1,"\"cancel\""));path("/other",e->send(e,200,0,data.length-1,"\"other\""));
                AtomicBoolean flag=new AtomicBoolean();ResumableAssetDownload first=downloader("/cancel",1),second=downloader("/other",1);
                failure("DOWNLOAD_CANCELLED",()->first.download(partial("cancel"),meta("cancel"),flag,(phase,bytes,total)->{if(phase.equals("downloading")){flag.set(true);first.cancel();}}));
                check(partial("cancel").length()>0&&meta("cancel").isFile(),"Cancellation discarded resume state");
                good(second.download(partial("other"),meta("other"),new AtomicBoolean(),null));
            });
            test("held regular descriptor alias resumes without sibling mutations", () -> {
                File document=partial("external-document");Files.write(document.toPath(),Arrays.copyOf(data,4096));
                path("/descriptor",e->send(e,206,offset(e),data.length-1,"\"descriptor\""));
                try(RandomAccessFile held=new RandomAccessFile(document,"rw")){
                    File alias=null;
                    File[] descriptors=new File("/proc/self/fd").listFiles();
                    if(descriptors!=null)for(File fd:descriptors){try{if(fd.getCanonicalFile().equals(document.getCanonicalFile())){alias=fd;break;}}catch(IOException ignored){}}
                    check(alias!=null,"Held document descriptor not found");
                    good(downloader("/descriptor",2).download(alias,meta("descriptor"),new AtomicBoolean(),null));
                    held.seek(0);check(held.readByte()=='G',"Downloader closed the caller's descriptor");
                }
                good(document);
            });
            test("cancel cannot disconnect another concurrent download", () -> {
                path("/parallel-a",e->send(e,200,0,data.length-1,"\"a\""));path("/parallel-b",e->send(e,200,0,data.length-1,"\"b\""));
                CountDownLatch bReading=new CountDownLatch(1),aCancelled=new CountDownLatch(1);
                ResumableAssetDownload a=downloader("/parallel-a",1),b=downloader("/parallel-b",1);AtomicBoolean aFlag=new AtomicBoolean();
                Future<File> other=workers.submit(()->b.download(partial("parallel-b"),meta("parallel-b"),new AtomicBoolean(),(phase,bytes,total)->{
                    if(phase.equals("downloading")){bReading.countDown();try{check(aCancelled.await(3,TimeUnit.SECONDS),"A did not cancel");}catch(InterruptedException e){throw new RuntimeException(e);}}
                }));
                check(bReading.await(3,TimeUnit.SECONDS),"B did not become active");
                failure("DOWNLOAD_CANCELLED",()->a.download(partial("parallel-a"),meta("parallel-a"),aFlag,(phase,bytes,total)->{
                    if(phase.equals("downloading")){aFlag.set(true);a.cancel();aCancelled.countDown();}
                }));
                good(other.get(3,TimeUnit.SECONDS));
            });
            test("metadata source mismatch and production HTTP rejected", () -> {
                Properties p=new Properties();p.setProperty("url","https://different.invalid/file");p.setProperty("size",Long.toString(data.length));p.setProperty("sha256",hash(data));try(OutputStream out=new FileOutputStream(meta("mismatch"))){p.store(out,"");}
                byte[] before=Files.readAllBytes(meta("mismatch").toPath());failure("DOWNLOAD_METADATA_MISMATCH",()->downloader("/other",1).download(partial("mismatch"),meta("mismatch"),new AtomicBoolean(),null));check(Arrays.equals(before,Files.readAllBytes(meta("mismatch").toPath())),"Mismatched metadata overwritten");
                ResumableAssetDownload production=new ResumableAssetDownload(new ResumableAssetDownload.DownloadSpec(base+"/other",data.length,hash(data)));
                failure("DOWNLOAD_HTTPS_REQUIRED",()->production.download(partial("http"),meta("http"),new AtomicBoolean(),null));
            });
            System.out.println("PASSED "+passed+" real HTTP streaming/resume cases; fixtures="+root);
        } finally { server.stop(0); workers.shutdownNow(); }
    }
}
