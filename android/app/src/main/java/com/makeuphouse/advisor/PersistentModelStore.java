package com.makeuphouse.advisor;

import android.content.Context;
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.system.Os;
import android.system.OsConstants;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** User-owned SAF originals are never deleted or overwritten here. Native mmap uses a verified
 * private runtime copy. Folder sidecars are descriptive data, never model trust anchors. */
public final class PersistentModelStore {
    private static final int BUFFER = 65536, MAX_CHILDREN = 256, MAX_METADATA = 16384;
    private final ContentResolver resolver;
    private final SharedPreferences preferences;
    private final Context context;
    public static final class DownloadTarget implements Closeable {
        public final ParcelFileDescriptor descriptor;
        public final File partialFile;
        public final Uri uri;
        DownloadTarget(ParcelFileDescriptor descriptor, Uri uri) { this.descriptor=descriptor;this.uri=uri;partialFile=new File("/proc/self/fd/"+descriptor.getFd()); }
        @Override public void close() throws IOException { descriptor.close(); }
    }

    public PersistentModelStore(Context context) {
        this.context = context.getApplicationContext();
        resolver = this.context.getContentResolver();
        preferences = this.context.getSharedPreferences("persistent_model_store_v1", Context.MODE_PRIVATE);
    }

    private static void asset(String id) throws IOException {
        if (id == null || !id.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}")) throw new IOException("PERSISTENT_ASSET_ID");
    }
    private static void check(AtomicBoolean cancel) throws IOException {
        if ((cancel != null && cancel.get()) || Thread.currentThread().isInterrupted()) throw new IOException("CANCELLED");
    }
    /** Caller obtains persistable grants through ACTION_OPEN_DOCUMENT_TREE before binding. */
    public synchronized void bind(String id, Uri uri) throws Exception {
        asset(id);
        if (uri == null || !"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri)) throw new IOException("PERSISTENT_TREE_URI");
        if (!permission(uri, true)) throw new IOException("STORAGE_RECONNECT_REQUIRED");
        Uri root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri));
        try (Cursor c = resolver.query(root, new String[]{DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c == null || !c.moveToFirst() || !DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(0))) throw new IOException("PERSISTENT_FOLDER_MISSING");
        }
        if (!preferences.edit().putString(id + ".tree", uri.toString()).remove(id + ".last_uri").remove(id + ".last_verified_at").commit()) throw new IOException("PERSISTENT_BIND_SAVE");
    }
    public Uri tree(String id) throws IOException {
        asset(id); String raw = preferences.getString(id + ".tree", null); return raw == null ? null : Uri.parse(raw);
    }
    private boolean permission(Uri tree, boolean write) {
        for (UriPermission p : resolver.getPersistedUriPermissions()) if (tree.equals(p.getUri()) && p.isReadPermission() && (!write || p.isWritePermission())) return true;
        return false;
    }
    private Uri requireTree(String id, boolean write) throws Exception {
        Uri value = tree(id); if (value == null) throw new IOException("STORAGE_FOLDER_REQUIRED");
        if (!permission(value, write)) throw new IOException("STORAGE_RECONNECT_REQUIRED"); return value;
    }
    /** Lightweight status does not rehash gigabytes on the UI thread or claim current integrity. */
    public JSONObject status(String id) throws Exception {
        Uri value = tree(id); JSONObject out = new JSONObject(); out.put("asset_id", id); out.put("bound", value != null);
        out.put("runtime_storage", "private_verified_cache"); out.put("original_deleted_by_runtime_cleanup", false);
        out.put("access_mode", "verified_internal_runtime_copy");out.put("folder_name",JSONObject.NULL);out.put("permission",value==null?"not_selected":permission(value,true)?"read_write":permission(value,false)?"read_only":"lost");
        out.put("partial_bytes",0);out.put("partial_bytes_source","provider_reported_not_hash_verified");
        out.put("integrity", "NOT_CHECKED_BY_STATUS");
        if (value == null) { out.put("state", "folder_not_bound"); return out; }
        out.put("tree_uri", value.toString()); out.put("read_permission", permission(value, false)); out.put("write_permission", permission(value, true));
        if (!permission(value, false)) { out.put("state", "permission_lost"); return out; }
        try {
            Uri root=DocumentsContract.buildDocumentUriUsingTree(value,DocumentsContract.getTreeDocumentId(value));
            try(Cursor c=resolver.query(root,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())out.put("folder_name",c.getString(0));}
            List<Entry> entries = children(value); String recorded = preferences.getString(id + ".last_uri", null); boolean exists = false;
            if (recorded != null) for (Entry e : entries) if (recorded.equals(e.uri.toString())) exists = true;
            long partialBytes=0;String recordedPartial=preferences.getString(id+".download_uri",null);
            for(Entry e:entries)if(e.name!=null&&e.name.startsWith(id+"-")&&e.name.endsWith(".download.part")&&e.size>=0&&e.uri.toString().equals(recordedPartial))partialBytes=Math.max(partialBytes,e.size);
            // On reconnect after reinstall, recover a display byte count from identity sidecars.
            // It is intentionally not an integrity verdict or permission to load the prefix.
            for(Entry meta:entries)if(meta.name!=null&&meta.name.endsWith(".download.json")&&meta.size<=MAX_METADATA){
                JSONObject data;try{data=readMetadata(meta.uri);}catch(IOException|org.json.JSONException invalid){metadataPermission(invalid);continue;}
                if(data.optInt("schema")!=1||!"resumable_download".equals(data.optString("kind"))||!id.equals(data.optString("asset_id"))||data.optBoolean("complete",true))continue;
                for(Entry e:entries)if(e.documentId.equals(data.optString("document_id"))&&e.name!=null&&e.name.startsWith(id+"-")&&e.name.endsWith(".download.part")&&e.size>=0)partialBytes=Math.max(partialBytes,e.size);
            }
            out.put("partial_bytes",partialBytes);
            out.put("folder_accessible", true); out.put("recorded_original_exists", exists); out.put("candidate_file_count", entries.size());
            out.put("state", recorded == null ? "folder_connected_discovery_required" : exists ? "original_present_verification_required" : "recorded_original_missing_discovery_required");
            out.put("last_verified_at", preferences.contains(id + ".last_verified_at") ? preferences.getLong(id + ".last_verified_at", 0) : JSONObject.NULL);
        } catch (SecurityException e) { out.put("state", "permission_lost");out.put("permission","lost"); }
        catch (FileNotFoundException e) { out.put("state", "folder_missing"); }
        catch (IOException e) { out.put("state", "STORAGE_RECONNECT_REQUIRED".equals(e.getMessage())?"permission_lost":"folder_unavailable");if("STORAGE_RECONNECT_REQUIRED".equals(e.getMessage()))out.put("permission","lost");out.put("error", e.getMessage()); }
        return out;
    }

    private static final class Spec {
        final long size; final String hash;
        Spec(String id, JSONObject manifest) throws Exception {
            asset(id); if (!id.equals(manifest.getString("id"))) throw new IOException("PERSISTENT_MANIFEST_ID");
            size = manifest.getLong("size"); hash = manifest.getString("sha256").toLowerCase(Locale.ROOT);
            if (size < 4 || !hash.matches("[a-f0-9]{64}")) throw new IOException("PERSISTENT_MANIFEST_INVALID");
        }
    }
    private static final class Entry {
        final Uri uri; final String documentId, name; final long size; final String mime;
        Entry(Uri uri, String documentId, String name, long size, String mime) { this.uri=uri;this.documentId=documentId;this.name=name;this.size=size;this.mime=mime; }
    }
    private List<Entry> children(Uri tree) throws Exception {
        try{return accessibleChildren(tree);}catch(SecurityException denied){throw new IOException("STORAGE_RECONNECT_REQUIRED",denied);}
    }
    private List<Entry> accessibleChildren(Uri tree) throws Exception {
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = resolver.query(root, new String[]{DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (c == null || !c.moveToFirst() || !DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(0))) throw new FileNotFoundException("PERSISTENT_FOLDER_MISSING");
        }
        Uri list = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        List<Entry> out = new ArrayList<>();
        String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_MIME_TYPE};
        try (Cursor c = resolver.query(list, columns, null, null, null)) {
            if (c == null) throw new IOException("PERSISTENT_LIST_UNAVAILABLE");
            while (c.moveToNext()) {
                if (out.size() >= MAX_CHILDREN) throw new IOException("PERSISTENT_FOLDER_SCAN_LIMIT");
                String documentId = c.getString(0); out.add(new Entry(DocumentsContract.buildDocumentUriUsingTree(tree, documentId), documentId, c.getString(1), c.isNull(2) ? -1 : c.getLong(2), c.getString(3)));
            }
        }
        return out;
    }
    private InputStream open(Uri uri) throws IOException {try{InputStream in=resolver.openInputStream(uri);if(in==null)throw new FileNotFoundException("PERSISTENT_OPEN_FAILED");return in;}catch(SecurityException denied){throw new IOException("STORAGE_RECONNECT_REQUIRED",denied);} }
    private OutputStream output(Uri uri) throws IOException {try{OutputStream out=resolver.openOutputStream(uri,"w");if(out==null)throw new IOException("PERSISTENT_WRITE_FAILED");return out;}catch(SecurityException denied){throw new IOException("STORAGE_RECONNECT_REQUIRED",denied);} }
    private Uri create(Uri tree, String mime, String name) throws Exception {
        Uri root=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        try{Uri result=DocumentsContract.createDocument(resolver,root,mime,name);if(result==null)throw new IOException("PERSISTENT_CREATE_FAILED");return result;}catch(SecurityException denied){throw new IOException("STORAGE_RECONNECT_REQUIRED",denied);}
    }
    private static String hex(byte[] bytes) { StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b));return out.toString(); }
    /** Exact size, SHA and GGUF magic are verified while streaming; a provider's size metadata is not trusted. */
    private static String transfer(InputStream in, OutputStream out, long expected, String expectedHash, AtomicBoolean cancel) throws Exception {
        check(cancel);
        MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[BUFFER],magic=new byte[4];long total=0;int n;
        while((n=in.read(buffer))!=-1){check(cancel);if(n==0)continue;if(total>expected-n)throw new IOException("PERSISTENT_SIZE_MISMATCH");
            for(int i=0;i<n&&total+i<4;i++)magic[(int)total+i]=buffer[i];digest.update(buffer,0,n);if(out!=null)out.write(buffer,0,n);total+=n;}
        check(cancel);if(total!=expected)throw new IOException("PERSISTENT_SIZE_MISMATCH");
        if(magic[0]!='G'||magic[1]!='G'||magic[2]!='U'||magic[3]!='F')throw new IOException("PERSISTENT_NOT_GGUF");
        String hash=hex(digest.digest());if(expectedHash!=null&&!hash.equals(expectedHash))throw new IOException("PERSISTENT_HASH_MISMATCH");if(out!=null)out.flush();return hash;
    }
    private void verified(String id, Uri uri) throws IOException {
        if(!preferences.edit().putString(id+".last_uri",uri.toString()).putLong(id+".last_verified_at",System.currentTimeMillis()).commit())throw new IOException("PERSISTENT_RECORD_SAVE");
    }
    private Uri discover(Uri tree, Spec spec, AtomicBoolean cancel) throws Exception {
        int checked=0;
        for(Entry entry:children(tree)){check(cancel);if(DocumentsContract.Document.MIME_TYPE_DIR.equals(entry.mime)||(entry.size>=0&&entry.size!=spec.size))continue;
            if(++checked>16)throw new IOException("PERSISTENT_HASH_SCAN_LIMIT");
            try(InputStream in=open(entry.uri)){transfer(in,null,spec.size,spec.hash,cancel);return entry.uri;}
            catch(IOException e){check(cancel);if(!"PERSISTENT_HASH_MISMATCH".equals(e.getMessage())&&!"PERSISTENT_NOT_GGUF".equals(e.getMessage())&&!"PERSISTENT_SIZE_MISMATCH".equals(e.getMessage()))throw e;}
        }return null;
    }
    private JSONObject result(String id, Uri uri, long size, String hash, boolean complete) throws Exception {
        return new JSONObject().put("asset_id",id).put("document_uri",uri.toString()).put("size",size).put("sha256",hash).put("verified_complete",complete).put("runtime_storage","private_verified_cache");
    }
    private void sourceIdentity(Properties properties, JSONObject manifest, Spec spec) throws Exception {
        String url=manifest.getString("url");
        if(!url.startsWith("https://")||!url.equals(properties.getProperty("url"))||!Long.toString(spec.size).equals(properties.getProperty("size"))||!spec.hash.equals(properties.getProperty("sha256")))throw new IOException("PERSISTENT_DOWNLOAD_METADATA_MISMATCH");
    }
    private Properties readProperties(File file) throws Exception {
        if(!file.isFile()||file.length()>MAX_METADATA)throw new IOException("PERSISTENT_DOWNLOAD_METADATA_SIZE");
        Properties source=new Properties();try(InputStream in=new FileInputStream(file)){source.load(in);}return source;
    }
    private JSONObject readMetadata(Uri uri) throws Exception {
        try(InputStream in=open(uri)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[1024];int n;
            while((n=in.read(chunk))!=-1){if(bytes.size()+n>MAX_METADATA)throw new IOException("PERSISTENT_METADATA_SIZE");bytes.write(chunk,0,n);}return new JSONObject(bytes.toString("UTF-8"));}
    }
    private static void metadataPermission(Exception error) throws IOException {if(error instanceof IOException&&"STORAGE_RECONNECT_REQUIRED".equals(error.getMessage()))throw (IOException)error;}
    private JSONObject downloadState(String id, JSONObject manifest, Spec spec, List<Entry> entries) throws Exception {
        for(Entry entry:entries){if(entry.name==null||!entry.name.endsWith(".download.json")||entry.size>MAX_METADATA)continue;
            JSONObject state;try{state=readMetadata(entry.uri);}catch(org.json.JSONException|IOException e){metadataPermission(e);continue;}
            if(state.optInt("schema")!=1||!"resumable_download".equals(state.optString("kind"))||state.optBoolean("complete",true)||!id.equals(state.optString("asset_id"))||state.optLong("expected_size")!=spec.size||!spec.hash.equals(state.optString("expected_sha256"))||!manifest.getString("url").equals(state.optString("url")))continue;
            // Only this API's explicitly mutable download partials can be opened for append;
            // a sidecar must never redirect writes into an imported original .gguf.
            for(Entry candidate:entries)if(candidate.documentId.equals(state.optString("document_id"))&&candidate.name!=null&&candidate.name.startsWith(id+"-")&&candidate.name.endsWith(".download.part")&&candidate.size<=spec.size&&!DocumentsContract.Document.MIME_TYPE_DIR.equals(candidate.mime)){
                state.put("_metadata_uri",entry.uri.toString()).put("_document_uri",candidate.uri.toString());
                for(Entry source:entries)if(source.documentId.equals(state.optString("source_document_id")))state.put("_source_uri",source.uri.toString());return state;
            }
        }return null;
    }
    /** Direct download target. Keep this descriptor open until downloader/metadata checkpointing finishes.
     * Seekable SAF descriptor path support requires Android/provider acceptance; no direct SAF mmap is claimed. */
    public synchronized DownloadTarget openDownload(String id, JSONObject manifest) throws Exception { return openDownload(id,manifest,new AtomicBoolean(false)); }
    public synchronized DownloadTarget openDownload(String id, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        check(cancel);
        Spec spec=new Spec(id,manifest);Uri selected=requireTree(id,true);List<Entry> entries=children(selected);JSONObject state=downloadState(id,manifest,spec,entries);
        Uri document, metadata;
        if(state==null){
            document=create(selected,"application/octet-stream",id+"-"+UUID.randomUUID()+".download.part");
            PartialCandidate saved=discoverPartial(selected,id,spec,cancel);
            if(saved!=null)try(InputStream in=open(saved.entry.uri);OutputStream out=output(document)){transfer(in,out,saved.length,saved.prefix,cancel);}
            metadata=create(selected,"application/json",id+"-"+UUID.randomUUID()+".download.json");
            Uri source=create(selected,"application/json",id+"-"+UUID.randomUUID()+".source.json");
            try(OutputStream out=output(source)){out.write("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));out.flush();}
            state=new JSONObject().put("schema",1).put("kind","resumable_download").put("asset_id",id).put("document_id",DocumentsContract.getDocumentId(document)).put("source_document_id",DocumentsContract.getDocumentId(source)).put("expected_size",spec.size).put("expected_sha256",spec.hash).put("url",manifest.getString("url")).put("complete",false).put("integrity","UNAUTHENTICATED_PREFIX_FINAL_PINNED_HASH_REQUIRED");
            try(OutputStream out=output(metadata)){out.write(state.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.flush();}
        }else{document=Uri.parse(state.getString("_document_uri"));metadata=Uri.parse(state.getString("_metadata_uri"));}
        ParcelFileDescriptor descriptor;try{descriptor=resolver.openFileDescriptor(document,"rw");}catch(SecurityException denied){throw new IOException("STORAGE_RECONNECT_REQUIRED",denied);}if(descriptor==null)throw new IOException("PERSISTENT_DOWNLOAD_OPEN");
        try{Os.lseek(descriptor.getFileDescriptor(),0,OsConstants.SEEK_CUR);DownloadTarget target=new DownloadTarget(descriptor,document);
            if(!target.partialFile.isFile())throw new IOException("PROVIDER_NOT_SEEKABLE");
            if(!preferences.edit().putString(id+".download_uri",document.toString()).putString(id+".download_metadata_uri",metadata.toString()).commit())throw new IOException("PERSISTENT_DOWNLOAD_BIND_SAVE");return target;
        }catch(Exception e){descriptor.close();if(e instanceof android.system.ErrnoException)throw new IOException("PROVIDER_NOT_SEEKABLE",e);throw e;}
    }
    private JSONObject currentDownload(String id, JSONObject manifest, Spec spec) throws Exception {
        Uri selected=requireTree(id,false);JSONObject state=downloadState(id,manifest,spec,children(selected));
        if(state==null)throw new FileNotFoundException("PERSISTENT_DOWNLOAD_NOT_FOUND");return state;
    }
    /** Only tiny source metadata is rewritten at downloader checkpoints; model bytes stay in SAF. */
    public synchronized JSONObject syncDownloadMetadata(String id, File privateProperties, JSONObject manifest) throws Exception {
        Spec spec=new Spec(id,manifest);requireTree(id,true);Properties source=readProperties(privateProperties);sourceIdentity(source,manifest,spec);
        JSONObject state=currentDownload(id,manifest,spec);JSONObject data=new JSONObject(state.toString());data.remove("_metadata_uri");data.remove("_document_uri");data.remove("_source_uri");
        String etag=source.getProperty("etag");if(etag!=null&&etag.length()>2048)throw new IOException("PERSISTENT_ETAG_SIZE");data.put("etag",etag==null?JSONObject.NULL:etag);data.put("checkpoint_at",System.currentTimeMillis());
        // Immutable download identity anchor survives a torn ETag checkpoint write.
        if(state.has("_source_uri"))try(OutputStream out=output(Uri.parse(state.getString("_source_uri")))){out.write(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.flush();}
        return new JSONObject().put("asset_id",id).put("saved",true).put("integrity","SOURCE_METADATA_ONLY_NOT_COMPLETE_MODEL_VERIFICATION");
    }
    public synchronized JSONObject restoreDownloadMetadata(String id, File privateProperties, JSONObject manifest) throws Exception {
        Spec spec=new Spec(id,manifest);JSONObject state=currentDownload(id,manifest,spec);Properties source=new Properties();
        source.setProperty("url",manifest.getString("url"));source.setProperty("size",Long.toString(spec.size));source.setProperty("sha256",spec.hash);
        JSONObject checkpoint=null;if(state.has("_source_uri"))try{checkpoint=readMetadata(Uri.parse(state.getString("_source_uri")));}catch(IOException|org.json.JSONException invalid){metadataPermission(invalid);}
        String etag=checkpoint!=null&&spec.hash.equals(checkpoint.optString("expected_sha256"))&&manifest.getString("url").equals(checkpoint.optString("url"))?checkpoint.optString("etag",null):null;
        if(etag!=null&&!"null".equals(etag)){if(etag.length()>2048)throw new IOException("PERSISTENT_ETAG_SIZE");source.setProperty("etag",etag);}
        sourceIdentity(source,manifest,spec);File temp=runtimeTemp(privateProperties);
        try{try(FileOutputStream out=new FileOutputStream(temp)){source.store(out,"Restored SAF source metadata; full pinned SHA mandatory");out.getFD().sync();}Os.rename(temp.getAbsolutePath(),privateProperties.getCanonicalPath());}
        finally{if(temp.exists())temp.delete();}
        return new JSONObject().put("asset_id",id).put("restored",true).put("integrity","UNAUTHENTICATED_PREFIX_FINAL_PINNED_HASH_REQUIRED");
    }
    public synchronized JSONObject completeDownload(String id, JSONObject manifest) throws Exception {return completeDownload(id,manifest,new AtomicBoolean(false));}
    public synchronized JSONObject completeDownload(String id, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        Spec spec=new Spec(id,manifest);requireTree(id,true);JSONObject state=currentDownload(id,manifest,spec);Uri candidate=Uri.parse(state.getString("_document_uri"));
        try(InputStream in=open(candidate)){transfer(in,null,spec.size,spec.hash,cancel);}check(cancel);
        try{Uri renamed=DocumentsContract.renameDocument(resolver,candidate,id+"-"+UUID.randomUUID()+".gguf");if(renamed!=null)candidate=renamed;}catch(IOException|UnsupportedOperationException ignored){}
        state.remove("_document_uri");state.remove("_source_uri");Uri metadata=Uri.parse(state.getString("_metadata_uri"));state.remove("_metadata_uri");state.put("complete",true).put("document_id",DocumentsContract.getDocumentId(candidate)).put("integrity","PINNED_SIZE_SHA256_GGUF_VERIFIED");
        try(OutputStream out=output(metadata)){out.write(state.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.flush();}
        verified(id,candidate);return result(id,candidate,spec.size,spec.hash,true);
    }
    private void sidecar(Uri tree, Uri document, String id, Spec spec, long bytes, String prefixHash, boolean complete) throws Exception {
        JSONObject data=new JSONObject().put("schema",1).put("asset_id",id).put("document_id",DocumentsContract.getDocumentId(document)).put("expected_size",spec.size).put("expected_sha256",spec.hash).put("bytes",bytes).put("prefix_sha256",prefixHash).put("complete",complete).put("authority","descriptive_only_in_app_manifest_is_authoritative");
        Uri meta=create(tree,"application/json",id+"-"+UUID.randomUUID()+(complete?".model.json":".partial.json"));
        try(OutputStream out=output(meta)){out.write(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.flush();}
    }
    public synchronized JSONObject copyToPermanent(String id, File source, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        Spec spec=new Spec(id,manifest);Uri tree=requireTree(id,true);check(cancel);
        if(!source.isFile()||source.length()!=spec.size)throw new IOException("PERSISTENT_SOURCE_SIZE");
        try(InputStream in=new FileInputStream(source)){transfer(in,null,spec.size,spec.hash,cancel);}
        Uri existing=discover(tree,spec,cancel);if(existing!=null){verified(id,existing);return result(id,existing,spec.size,spec.hash,true).put("reused",true);}
        Uri candidate=create(tree,"application/octet-stream",id+"-"+UUID.randomUUID()+".copying");
        try(InputStream in=new FileInputStream(source);OutputStream out=output(candidate)){transfer(in,out,spec.size,spec.hash,cancel);}
        try(InputStream in=open(candidate)){transfer(in,null,spec.size,spec.hash,cancel);}check(cancel);
        // Provider rename support is optional; a valid content-addressed candidate remains recoverable by hash.
        try{Uri renamed=DocumentsContract.renameDocument(resolver,candidate,id+"-"+UUID.randomUUID()+".gguf");if(renamed!=null)candidate=renamed;}catch(IOException|UnsupportedOperationException ignored){}
        verified(id,candidate);sidecar(tree,candidate,id,spec,spec.size,spec.hash,true);return result(id,candidate,spec.size,spec.hash,true).put("reused",false);
    }
    private File runtimeTemp(File destination) throws Exception {
        File parent=destination.getCanonicalFile().getParentFile();String allowed=context.getNoBackupFilesDir().getCanonicalPath()+File.separator;
        if(parent==null||!destination.getCanonicalPath().startsWith(allowed))throw new IOException("PERSISTENT_RUNTIME_PATH");
        if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("PERSISTENT_RUNTIME_STORAGE");
        return File.createTempFile("persistent-import-",".part",parent);
    }
    public synchronized JSONObject restoreToRuntime(String id, File destination, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        Spec spec=new Spec(id,manifest);Uri tree=requireTree(id,false);Uri original=discover(tree,spec,cancel);
        if(original==null)throw new FileNotFoundException("ASSET_NOT_FOUND");File temp=runtimeTemp(destination);
        try{try(InputStream in=open(original);FileOutputStream out=new FileOutputStream(temp)){transfer(in,out,spec.size,spec.hash,cancel);out.getFD().sync();}
            check(cancel);Os.rename(temp.getAbsolutePath(),destination.getCanonicalPath());verified(id,original);return result(id,original,spec.size,spec.hash,true).put("runtime_path",destination.getCanonicalPath());
        }finally{if(temp.exists())temp.delete();}
    }
    /** A saved prefix is resumable data only: full pinned SHA remains mandatory after download completes. */
    private static final class PartialCandidate {
        final Entry entry;final long length;final String prefix;
        PartialCandidate(Entry entry,long length,String prefix){this.entry=entry;this.length=length;this.prefix=prefix;}
    }
    private PartialCandidate discoverPartial(Uri tree,String id,Spec spec,AtomicBoolean cancel) throws Exception {
        List<Entry> entries=children(tree);PartialCandidate best=null;
        for(Entry meta:entries){check(cancel);if(meta.name==null||!meta.name.endsWith(".partial.json")||meta.size>MAX_METADATA)continue;
            JSONObject data;try{data=readMetadata(meta.uri);}catch(IOException|org.json.JSONException e){check(cancel);metadataPermission(e);continue;}
            if(data.optInt("schema")!=1||data.optBoolean("complete",true)||!id.equals(data.optString("asset_id"))||data.optLong("expected_size")!=spec.size||!spec.hash.equals(data.optString("expected_sha256")))continue;
            long length=data.optLong("bytes",-1);String prefix=data.optString("prefix_sha256");if(length<4||length>=spec.size||!prefix.matches("[a-f0-9]{64}")||(best!=null&&best.length>=length))continue;
            for(Entry candidate:entries)if(candidate.documentId.equals(data.optString("document_id"))&&(candidate.size==length||candidate.size<0)){
                try(InputStream in=open(candidate.uri)){transfer(in,null,length,prefix,cancel);best=new PartialCandidate(candidate,length,prefix);}
                catch(IOException e){check(cancel);if(!"PERSISTENT_HASH_MISMATCH".equals(e.getMessage())&&!"PERSISTENT_NOT_GGUF".equals(e.getMessage())&&!"PERSISTENT_SIZE_MISMATCH".equals(e.getMessage()))throw e;}
            }
        }return best;
    }
    public synchronized JSONObject copyPartialToPermanent(String id, File source, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        Spec spec=new Spec(id,manifest);Uri tree=requireTree(id,true);long length=source.length();
        if(!source.isFile()||length<4||length>=spec.size)throw new IOException("PERSISTENT_PARTIAL_SIZE");
        String sourceHash;try(InputStream in=new FileInputStream(source)){sourceHash=transfer(in,null,length,null,cancel);}
        PartialCandidate existing=discoverPartial(tree,id,spec,cancel);if(existing!=null&&existing.length==length&&existing.prefix.equals(sourceHash))return result(id,existing.entry.uri,length,sourceHash,false).put("reused",true).put("integrity","PREFIX_ONLY_FINAL_PINNED_HASH_REQUIRED");
        Uri candidate=create(tree,"application/octet-stream",id+"-"+UUID.randomUUID()+".partial");String prefix;
        try(InputStream in=new FileInputStream(source);OutputStream out=output(candidate)){prefix=transfer(in,out,length,null,cancel);}
        try(InputStream in=open(candidate)){transfer(in,null,length,prefix,cancel);}check(cancel);sidecar(tree,candidate,id,spec,length,prefix,false);
        return result(id,candidate,length,prefix,false).put("reused",false).put("integrity","PREFIX_ONLY_FINAL_PINNED_HASH_REQUIRED");
    }
    public synchronized JSONObject restorePartialToRuntime(String id, File destination, JSONObject manifest, AtomicBoolean cancel) throws Exception {
        Spec spec=new Spec(id,manifest);Uri tree=requireTree(id,false);List<Entry> entries=children(tree);
        for(Entry meta:entries){check(cancel);if(meta.name==null||!meta.name.endsWith(".partial.json")||meta.size>MAX_METADATA)continue;
            JSONObject data;
            try(InputStream in=open(meta.uri)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[1024];int n;while((n=in.read(chunk))!=-1){if(bytes.size()+n>MAX_METADATA)throw new IOException("PERSISTENT_METADATA_SIZE");bytes.write(chunk,0,n);}data=new JSONObject(bytes.toString("UTF-8"));}
            catch(org.json.JSONException|IOException e){check(cancel);metadataPermission(e);continue;}
            if(data.optInt("schema")!=1||data.optBoolean("complete",true)||!id.equals(data.optString("asset_id"))||data.optLong("expected_size")!=spec.size||!spec.hash.equals(data.optString("expected_sha256")))continue;
            long length=data.optLong("bytes",-1);String prefix=data.optString("prefix_sha256");if(length<4||length>=spec.size||!prefix.matches("[a-f0-9]{64}"))continue;
            for(Entry entry:entries){if(!entry.documentId.equals(data.optString("document_id"))||entry.size!=length)continue;File temp=runtimeTemp(destination);
                try{try(InputStream in=open(entry.uri);FileOutputStream out=new FileOutputStream(temp)){transfer(in,out,length,prefix,cancel);out.getFD().sync();}check(cancel);Os.rename(temp.getAbsolutePath(),destination.getCanonicalPath());return result(id,entry.uri,length,prefix,false).put("integrity","UNAUTHENTICATED_PREFIX_FINAL_PINNED_HASH_REQUIRED");}
                catch(IOException e){check(cancel);if(!"PERSISTENT_HASH_MISMATCH".equals(e.getMessage())&&!"PERSISTENT_NOT_GGUF".equals(e.getMessage())&&!"PERSISTENT_SIZE_MISMATCH".equals(e.getMessage()))throw e;}
                finally{if(temp.exists())temp.delete();}
            }
        }throw new FileNotFoundException("PERSISTENT_PARTIAL_NOT_FOUND");
    }
}
