/** Exact production streaming code on Host JVM; no Android/SAF/device acceptance is implied. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('persistent store exact stream validates 96MiB under 32MiB heap; size/hash/magic/cancel fail independently',t=>{
 const nativeCompiler=spawnSync('javac',['-version']);
 const compiler=nativeCompiler.error?['java','-m','jdk.compiler/com.sun.tools.javac.Main']:['javac'];
 if(spawnSync(compiler[0],[...compiler.slice(1),'-version']).status!==0||spawnSync('java',['-version']).error){t.skip('Host JDK unavailable; Android SAF acceptance remains pending');return;}
 const source=readFileSync('android/app/src/main/java/com/makeuphouse/advisor/PersistentModelStore.java','utf8');
 const method=(signature:string)=>{const start=source.indexOf(signature);assert.ok(start>=0);const end=source.indexOf('\n    }\n',start);assert.ok(end>start);return source.slice(start,end+7);};
 const hash=createHash('sha256');hash.update('GGUF');const zeros=Buffer.alloc(65536);let left=96*1024*1024-4;while(left){const n=Math.min(left,zeros.length);hash.update(zeros.subarray(0,n));left-=n;}
 const expected=hash.digest('hex');
 const code=`import java.io.*;import java.security.MessageDigest;import java.util.*;import java.util.concurrent.atomic.AtomicBoolean;
 public class PersistentStoreStreamHarness {
 private static final int BUFFER=65536;
 ${method('private static void check(')}
 ${source.split('\n').find(line=>line.includes('private static String hex('))}
 ${method('private static String transfer(')}
 static void require(boolean value,String name){if(!value)throw new AssertionError(name);}
 interface Work {void run()throws Exception;}
 static void rejected(String error,Work work)throws Exception{try{work.run();throw new AssertionError("expected "+error);}catch(IOException e){require(error.equals(e.getMessage()),"wrong rejection "+e);}}
 static class Zeros extends InputStream {long left=96L*1024*1024,position=0;int maxRequest=0;public int read(){throw new AssertionError("single-byte read");}public int read(byte[] b,int offset,int length){maxRequest=Math.max(maxRequest,length);if(left==0)return -1;int n=(int)Math.min(left,length);Arrays.fill(b,offset,offset+n,(byte)0);byte[] magic={'G','G','U','F'};for(int i=0;i<n&&position+i<4;i++)b[offset+i]=magic[(int)position+i];position+=n;left-=n;return n;}}
 static class Counter extends OutputStream{long count=0;int maxWrite=0;public void write(int b){count++;}public void write(byte[]b,int offset,int n){count+=n;maxWrite=Math.max(maxWrite,n);}}
 public static void main(String[] args)throws Exception {
 AtomicBoolean live=new AtomicBoolean(false);Zeros in=new Zeros();Counter out=new Counter();
 String result=transfer(in,out,96L*1024*1024,"${expected}",live);
 require(result.equals("${expected}"),"independent SHA oracle");require(out.count==96L*1024*1024,"complete byte count");require(in.maxRequest<=65536&&out.maxWrite<=65536,"bounded buffer");
 rejected("PERSISTENT_SIZE_MISMATCH",()->transfer(new ByteArrayInputStream(new byte[]{'G','G','U','F'}),null,5,null,live));
 rejected("PERSISTENT_SIZE_MISMATCH",()->transfer(new ByteArrayInputStream(new byte[]{'G','G','U','F',0}),null,4,null,live));
 rejected("PERSISTENT_NOT_GGUF",()->transfer(new ByteArrayInputStream(new byte[]{'B','A','D','!'}),null,4,null,live));
 rejected("PERSISTENT_HASH_MISMATCH",()->transfer(new ByteArrayInputStream(new byte[]{'G','G','U','F'}),null,4,"0000000000000000000000000000000000000000000000000000000000000000",live));
 rejected("CANCELLED",()->transfer(new InputStream(){public int read(){throw new AssertionError("pre-cancel must not read");}},null,4,null,new AtomicBoolean(true)));
 System.out.println("PASS: 96MiB with32MiB heap; size/hash/GGUF/cancel controls. HOST_STREAM_ONLY_SAF_DEVICE_NOT_TESTED");
 }}
 `;
 const directory=mkdtempSync(join(tmpdir(),'persistent-store-stream-'));
 try{const file=join(directory,'PersistentStoreStreamHarness.java');writeFileSync(file,code);const compiled=spawnSync(compiler[0],[...compiler.slice(1),file],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);const run=spawnSync('java',['-Xmx32m','-cp',directory,'PersistentStoreStreamHarness'],{encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/HOST_STREAM_ONLY_SAF_DEVICE_NOT_TESTED/);t.diagnostic(run.stdout.trim());}finally{rmSync(directory,{recursive:true,force:true});}
});
