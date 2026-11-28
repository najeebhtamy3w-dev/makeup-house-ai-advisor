package com.makeuphouse.advisor;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import android.system.ErrnoException;
import android.system.OsConstants;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowLinux;

/** Executes the COMPLETE production store with an Android DocumentsProvider under Robolectric.
 * Synthetic files/grants/races are not a USB, Samsung, physical-provider or model-quality pass. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest=Config.NONE,sdk=35,shadows={PersistentModelStoreProviderTest.ProviderResolverShadow.class,PersistentModelStoreProviderTest.AtomicLinuxShadow.class})
public class PersistentModelStoreProviderTest {
    private static final String AUTHORITY="com.makeuphouse.test.documents", ID="fixture-pinned-model";
    private Context context;private ContentResolver resolver;private FixtureProvider provider;
    private PersistentModelStore store;private Uri tree;private byte[] good;private JSONObject manifest;private File destination;

    @Before public void setup() throws Exception {
        context=RuntimeEnvironment.getApplication();resolver=context.getContentResolver();
        context.getSharedPreferences("persistent_model_store_v1",0).edit().clear().commit();
        ProviderInfo info=new ProviderInfo();info.authority=AUTHORITY;info.exported=true;info.grantUriPermissions=true;info.readPermission="android.permission.MANAGE_DOCUMENTS";info.writePermission="android.permission.MANAGE_DOCUMENTS";
        provider=Robolectric.buildContentProvider(FixtureProvider.class).create(info).get();
        tree=DocumentsContract.buildTreeDocumentUri(AUTHORITY,"root");store=new PersistentModelStore(context);
        good=new byte[131072];new Random(139).nextBytes(good);System.arraycopy(new byte[]{'G','G','U','F'},0,good,0,4);
        manifest=new JSONObject().put("id",ID).put("size",good.length).put("sha256",sha(good)).put("url","https://example.test/pinned.gguf");
        File folder=new File(context.getNoBackupFilesDir(),"local-ai");assertTrue(folder.isDirectory()||folder.mkdirs());destination=new File(folder,"approved.gguf");Files.write(destination.toPath(),new byte[]{9,8,7});
    }
    @After public void originalsAreNeverOpenedForWriteOrDeleted(){if(provider==null)return;assertEquals(0,provider.writeOpens);assertEquals(0,provider.deletes);assertEquals(0,provider.creates);assertEquals(0,provider.renames);}
    private void grant(boolean write){resolver.takePersistableUriPermission(tree,Intent.FLAG_GRANT_READ_URI_PERMISSION|(write?Intent.FLAG_GRANT_WRITE_URI_PERMISSION:0));}
    private JSONObject restore() throws Exception{return store.restoreToRuntime(ID,destination,manifest,new AtomicBoolean(false));}
    private interface Work{void run()throws Exception;}
    private void fails(String message,Work work)throws Exception{try{work.run();fail("Expected "+message);}catch(IOException e){assertEquals(message,e.getMessage());}}
    private void unchangedRuntime()throws Exception{assertArrayEquals(new byte[]{9,8,7},Files.readAllBytes(destination.toPath()));File[] files=destination.getParentFile().listFiles((dir,name)->name.startsWith("persistent-import-"));assertNotNull(files);assertEquals(0,files.length);}
    private static String sha(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(Locale.ROOT,"%02x",b));return out.toString();}

    @Test public void independentOfflineOriginalWithDifferentNameNeedsNoDownloadHistory()throws Exception{
        byte[] decoy=good.clone();decoy[48]^=1;File misleading=provider.add("approved.gguf",decoy);
        File original=provider.add("renamed_USB_export.bin",good);grant(true);store.bind(ID,tree);
        assertEquals("folder_connected_discovery_required",store.status(ID).getString("state"));
        JSONObject result=restore();assertTrue(result.getBoolean("verified_complete"));assertArrayEquals(good,Files.readAllBytes(destination.toPath()));assertArrayEquals(good,Files.readAllBytes(original.toPath()));assertArrayEquals(decoy,Files.readAllBytes(misleading.toPath()));assertEquals(2,provider.files.size());
        assertEquals("original_present_verification_required",store.status(ID).getString("state"));
    }
    @Test public void readOnlyExistingOriginalRestoresAndWriteOperationsRemainBlocked()throws Exception{
        File original=provider.add("original-read-only.gguf",good);grant(false);store.bind(ID,tree);
        assertEquals("read_only",store.status(ID).getString("permission"));restore();assertArrayEquals(good,Files.readAllBytes(original.toPath()));
        fails("STORAGE_WRITE_PERMISSION_REQUIRED",()->store.copyToPermanent(ID,destination,manifest,new AtomicBoolean(false)));
    }
    @Test public void wrongSameSizeFileCannotReplaceRuntimeOrBecomeVerified()throws Exception{
        byte[] wrong=good.clone();wrong[20]^=1;File original=provider.add("correct-looking-model.gguf",wrong);grant(true);store.bind(ID,tree);
        fails("ASSET_NOT_FOUND",()->restore());unchangedRuntime();assertArrayEquals(wrong,Files.readAllBytes(original.toPath()));assertFalse(store.status(ID).has("last_verified_at")&&!store.status(ID).isNull("last_verified_at"));
    }
    @Test public void modificationBetweenDiscoveryAndCopyRejectsTemporaryFileAndPreservesRuntime()throws Exception{
        File original=provider.add("source.gguf",good);provider.mutateOnSecondRead=true;grant(true);store.bind(ID,tree);
        fails("PERSISTENT_HASH_MISMATCH",()->restore());unchangedRuntime();assertTrue(original.isFile());assertEquals(good.length,original.length());
    }
    @Test public void cancelledRestoreLeavesRuntimeAndOriginalBytesUnchanged()throws Exception{
        File original=provider.add("source.gguf",good);grant(true);store.bind(ID,tree);
        fails("CANCELLED",()->store.restoreToRuntime(ID,destination,manifest,new AtomicBoolean(true)));unchangedRuntime();assertArrayEquals(good,Files.readAllBytes(original.toPath()));
    }
    @Test public void revokedGrantIsNotReportedAsMissingAsset()throws Exception{
        File original=provider.add("source.gguf",good);grant(true);store.bind(ID,tree);
        resolver.releasePersistableUriPermission(tree,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertEquals("permission_lost",store.status(ID).getString("state"));fails("STORAGE_RECONNECT_REQUIRED",()->restore());unchangedRuntime();assertArrayEquals(good,Files.readAllBytes(original.toPath()));
    }
    @Test public void arbitraryExternalSidecarCannotOverridePinnedManifest()throws Exception{
        byte[] wrong=good.clone();wrong[35]^=4;provider.add("model.gguf",wrong);
        provider.add("claimed.model.json",new JSONObject().put("asset_id",ID).put("expected_sha256",sha(wrong)).put("expected_size",wrong.length).put("complete",true).toString().getBytes("UTF-8"));
        grant(true);store.bind(ID,tree);fails("ASSET_NOT_FOUND",()->restore());unchangedRuntime();
    }
    @Test public void incompleteSameNameIsNeverPromoted()throws Exception{
        byte[] incomplete=Arrays.copyOf(good,good.length/2);File original=provider.add("approved.gguf",incomplete);grant(true);store.bind(ID,tree);
        fails("ASSET_NOT_FOUND",()->restore());unchangedRuntime();assertArrayEquals(incomplete,Files.readAllBytes(original.toPath()));
    }

    public static final class FixtureProvider extends DocumentsProvider {
        final LinkedHashMap<String,File> files=new LinkedHashMap<>();int writeOpens,deletes,creates,renames,reads;boolean mutateOnSecondRead;
        File add(String name,byte[] data)throws Exception{File root=new File(getContext().getCacheDir(),"fixture-originals");assertTrue(root.isDirectory()||root.mkdirs());File file=new File(root,UUID.randomUUID().toString());Files.write(file.toPath(),data);files.put(name,file);return file;}
        @Override public boolean onCreate(){return true;}
        @Override public Cursor queryRoots(String[] projection){return new MatrixCursor(projection==null?new String[]{DocumentsContract.Root.COLUMN_ROOT_ID}:projection);}
        private MatrixCursor rows(String[] projection){return new MatrixCursor(projection==null?new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_MIME_TYPE}:projection);}
        private void row(MatrixCursor cursor,String id)throws FileNotFoundException{boolean root="root".equals(id);File file=files.get(id);if(!root&&file==null)throw new FileNotFoundException(id);Object[] values=new Object[cursor.getColumnCount()];String[] columns=cursor.getColumnNames();for(int i=0;i<columns.length;i++){switch(columns[i]){case DocumentsContract.Document.COLUMN_DOCUMENT_ID:values[i]=id;break;case DocumentsContract.Document.COLUMN_DISPLAY_NAME:values[i]=root?"USB fixture":id;break;case DocumentsContract.Document.COLUMN_SIZE:values[i]=root?0L:file.length();break;case DocumentsContract.Document.COLUMN_MIME_TYPE:values[i]=root?DocumentsContract.Document.MIME_TYPE_DIR:"application/octet-stream";break;case DocumentsContract.Document.COLUMN_FLAGS:values[i]=0;break;default:values[i]=null;}}cursor.addRow(values);}
        @Override public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{MatrixCursor c=rows(projection);row(c,id);return c;}
        @Override public Cursor queryChildDocuments(String id,String[] projection,String sortOrder)throws FileNotFoundException{if(!"root".equals(id))throw new FileNotFoundException(id);MatrixCursor c=rows(projection);for(String key:files.keySet())row(c,key);return c;}
        @Override public boolean isChildDocument(String parent,String child){return "root".equals(parent)&&files.containsKey(child);}
        @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{
            if(!"r".equals(mode)){writeOpens++;throw new AssertionError("Original opened for write");}File file=files.get(id);if(file==null)throw new FileNotFoundException(id);reads++;
            if(mutateOnSecondRead&&reads==2)try{byte[] bytes=Files.readAllBytes(file.toPath());bytes[13]^=1;Files.write(file.toPath(),bytes);}catch(IOException e){throw new FileNotFoundException(e.getMessage());}
            return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
        }
        @Override public String createDocument(String parent,String mime,String name){creates++;throw new AssertionError("Restore must not create external copies");}
        @Override public void deleteDocument(String id){deletes++;throw new AssertionError("Original deleted");}
        @Override public String renameDocument(String id,String name){renames++;throw new AssertionError("Original renamed");}
    }
    /** Robolectric's legacy resolver shadow calls the provider's pre-O query directly.
     * Real Android translates that public resolver overload to the modern Bundle IPC query.
     * Adapt that routing only; production store, document dispatch, I/O and grants remain real. */
    @Implements(ContentResolver.class)
    public static class ProviderResolverShadow extends ShadowContentResolver {
        @Implementation protected Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){
            android.content.ContentProvider provider=ShadowContentResolver.getProvider(uri);
            if(provider instanceof DocumentsProvider)return provider.query(uri,projection,new Bundle(),null);
            return super.query(uri,projection,selection,args,order);
        }
    }
    /** Robolectric has no Linux.rename implementation. Preserve its OS contract with a real
     * same-filesystem atomic Host rename instead of the otherwise silent native no-op. */
    @Implements(className="libcore.io.Linux",isInAndroidSdk=false)
    public static class AtomicLinuxShadow extends ShadowLinux {
        @Implementation protected void rename(String source,String destination)throws ErrnoException{
            try{Files.move(new File(source).toPath(),new File(destination).toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
            catch(IOException failure){throw new ErrnoException("rename",OsConstants.EIO,failure);}
        }
    }
}
