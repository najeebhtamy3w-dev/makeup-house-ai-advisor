"""Plain-Java asset boundaries with Android/JSON stubs; NOT an Android runtime test."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class VisionAssetIntegrity(unittest.TestCase):
    def test_java_integrity_resume_pins_and_weight_preservation(self):
        with tempfile.TemporaryDirectory(prefix='vision-assets-test-') as directory:
            root = pathlib.Path(directory)
            sources = {
                'android/content/Context.java': '''package android.content; public class Context {private final java.io.File root;public Context(java.io.File root){this.root=root;}public java.io.File getNoBackupFilesDir(){return root;}}''',
                'android/system/Os.java': '''package android.system; public class Os {public static void rename(String from,String to)throws Exception{java.nio.file.Files.move(java.nio.file.Path.of(from),java.nio.file.Path.of(to),java.nio.file.StandardCopyOption.ATOMIC_MOVE,java.nio.file.StandardCopyOption.REPLACE_EXISTING);}}''',
                'org/json/JSONObject.java': '''package org.json;public class JSONObject {public static final Object NULL=new Object();private final java.util.Map<String,Object> data=new java.util.HashMap<>();public JSONObject put(String key,Object value){data.put(key,value);return this;}public String getString(String key){return (String)data.get(key);}public long getLong(String key){return ((Number)data.get(key)).longValue();}}''',
                'com/makeuphouse/advisor/VisionAssetHarness.java': r'''
package com.makeuphouse.advisor;
import java.io.*;import java.nio.file.*;import java.security.*;import java.util.*;import java.util.concurrent.atomic.AtomicBoolean;import org.json.JSONObject;import android.content.Context;
public class VisionAssetHarness {
 static int checks=0;
 interface Work {void run()throws Exception;}
 static void expect(String message,Work work)throws Exception{try{work.run();throw new AssertionError("expected "+message);}catch(IOException e){if(!e.getMessage().equals(message))throw e;}checks++;}
 static void ok(boolean value){if(!value)throw new AssertionError();checks++;}
 static String hash(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b));return s.toString();}
 static JSONObject manifest(){return new JSONObject().put("id","qwen35-2b-vision-projector-f16").put("model_id","qwen35-2b-q4km").put("version","f6d5376be1edb4d416d56da11e5397a961aca8ae").put("size",668227264L).put("sha256","7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7").put("url","https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/mmproj-F16.gguf");}
 public static void main(String[] args)throws Exception{
  Path root=Path.of(args[0]);byte[] bytes="GGUF-synthetic-integrity-fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);Path source=root.resolve("fixture.gguf");Files.write(source,bytes);AtomicBoolean cancel=new AtomicBoolean(false);
  VisionAsset.verifyFile(source.toFile(),bytes.length,hash(bytes),cancel);checks++;
  expect("VISION_SIZE_MISMATCH",()->VisionAsset.verifyFile(source.toFile(),bytes.length+1,hash(bytes),cancel));
  expect("VISION_HASH_MISMATCH",()->VisionAsset.verifyFile(source.toFile(),bytes.length,"0".repeat(64),cancel));
  byte[] bad="BADF-synthetic-integrity-fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(source,bad);expect("VISION_FORMAT_INVALID",()->VisionAsset.verifyFile(source.toFile(),bad.length,hash(bad),cancel));
  cancel.set(true);expect("CANCELLED",()->VisionAsset.verifyFile(source.toFile(),bad.length,hash(bad),cancel));cancel.set(false);
  ok(VisionAsset.validRange("bytes 10-19/20",10,20));ok(!VisionAsset.validRange("bytes 0-19/20",10,20));ok(!VisionAsset.validRange("bytes 10-20/20",10,20));ok(!VisionAsset.validRange("bytes 10-9/20",10,20));ok(!VisionAsset.validRange("bytes 10-19/21",10,20));ok(!VisionAsset.validRange("bytes 999999999999999999999-19/20",10,20));ok(!VisionivesNull());
  Context context=new Context(root.resolve("private").toFile());VisionAsset asset=new VisionAsset(context,manifest());Path models=root.resolve("private/local-ai");Path weights=models.resolve("approved.gguf"),projector=models.resolve("vision-projector.gguf");byte[] keep="existing-text-model-not-a-test-replacement".getBytes();Files.write(weights,keep);Files.write(projector,bytes);
  expect("VISION_SIZE_MISMATCH",()->asset.install(cancel,(phase,count,total)->{}));ok(Arrays.equals(Files.readAllBytes(weights),keep));ok(Arrays.equals(Files.readAllBytes(projector),bytes));
  Files.write(models.resolve("vision-projector.part"),bytes);asset.remove();ok(Files.exists(weights));ok(!Files.exists(projector));ok(!Files.exists(models.resolve("vision-projector.part")));ok(Arrays.equals(Files.readAllBytes(weights),keep));
  expect("VISION_MANIFEST_MISMATCH",()->new VisionAsset(context,manifest().put("url","https://example.invalid/other.gguf")));
  Files.createSymbolicLink(projector,source);expect("VISION_ASSET_PATH",()->asset.status());Files.delete(projector);
  if(args.length>1){VisionAsset.verifyFile(new File(args[1]),668227264L,"7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7",cancel);checks++;System.out.println("REAL_PINNED_PROJECTOR_HASH_SIZE_GGUF_PASS");}
  System.out.println("VISION_ASSET_BOUNDARY_CHECKS_PASS="+checks);
 }
 static boolean VisionivesNull(){return VisionAsset.validRange(null,0,20);}
}
''',
            }
            sources['org/json/JSONObject.java'] = '''package org.json; public class JSONObject {public static final Object NULL=new Object();private final java.util.Map<String,Object> values=new java.util.HashMap<>();public JSONObject put(String key,Object value){values.put(key,value);return this;}public String getString(String key){return (String)values.get(key);}public long getLong(String key){return ((Number)values.get(key)).longValue();}}'''
            java_sources = []
            for relative, content in sources.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                java_sources.append(str(path))
            java_sources.append(str(ROOT / 'android/app/src/main/java/com/makeuphouse/advisor/VisionAsset.java'))
            subprocess.run(['java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(root / 'classes'), *java_sources], check=True)
            projector = ROOT.parent / 'toolchain/native-recovery/mmproj-F16.gguf'
            command = ['java', '-cp', str(root / 'classes'), 'com.makeuphouse.advisor.VisionAssetHarness', str(root)]
            if projector.is_file():
                command.append(str(projector))
            result = subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertIn('VISION_ASSET_BOUNDARY_CHECKS_PASS=', result.stdout)
            if projector.is_file():
                self.assertIn('REAL_PINNED_PROJECTOR_HASH_SIZE_GGUF_PASS', result.stdout)
            print(result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
