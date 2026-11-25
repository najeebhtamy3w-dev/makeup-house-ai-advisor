package com.smartstock.ui;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;
import androidx.test.core.app.ApplicationProvider;

import com.smartstock.core.TestUtil;
import com.smartstock.core.XlsxImporter;
import com.smartstock.core.XlsxPackage;
import com.smartstock.data.Db;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;
import com.smartstock.data.Settings;
import com.smartstock.data.Workflows;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;

import java.io.File;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

/** Drives the real screens end-to-end on the JVM (Robolectric) and saves screenshots for review. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "ar-w412dp-h915dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
public class UiFlowTest {
    Context ctx;
    Repository repo;
    long sid;

    @Before public void setUp() throws Exception {
        ctx = ApplicationProvider.getApplicationContext();
        Db.reset();
        ctx.deleteDatabase(Db.NAME);
        ctx.getSharedPreferences(Settings.FILE, 0).edit().clear().commit();
        Settings.setSound(ctx, false);
        repo = new Repository(Db.get(ctx));
        File staged = TestUtil.fixture("f10_multisheet.xlsx");
        XlsxImporter.Result r;
        try (XlsxPackage pkg = new XlsxPackage(staged, Workflows.PARSER)) {
            XlsxImporter.HeaderScan h = XlsxImporter.scanHeader(pkg, pkg.defaultSheet());
            r = XlsxImporter.read(pkg, pkg.defaultSheet(), h.headerRow, h.match.map, h.headers, null);
        }
        Repository.SessionDraft d = new Repository.SessionDraft();
        d.name = "جرد نهاية الشهر"; d.shop = "محل النموذج"; d.countDate = "2026-11-25"; d.fileName = "f10_multisheet.xlsx"; d.currency = "ر.ي";
        sid = Workflows.createSession(ctx, staged, r, d, null);
        Settings.setActiveSession(ctx, sid);
    }

    @After public void tearDown() { Db.reset(); }

    /** Waits for background executors and runs posted UI callbacks until quiet. */
    static void flush() throws Exception {
        for (int i = 0; i < 6; i++) {
            Bg.DB.submit(() -> {}).get(30, TimeUnit.SECONDS);
            Bg.WORK.submit(() -> {}).get(60, TimeUnit.SECONDS);
            shadowOf(Looper.getMainLooper()).idle();
        }
    }

    static void shot(Activity a, String name) {
        String dir = System.getProperty("smartstock.out", "");
        if (dir.isEmpty()) return;
        File d = new File(dir, "ui_screens");
        d.mkdirs();
        View v = a.getWindow().getDecorView();
        int w = 1080, h = 2400;
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        v.layout(0, 0, w, h);
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        b.eraseColor(Color.WHITE);
        v.draw(new Canvas(b));
        try (FileOutputStream o = new FileOutputStream(new File(d, name + ".png"))) { b.compress(Bitmap.CompressFormat.PNG, 100, o); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    static List<View> all(View root) {
        List<View> out = new ArrayList<>();
        out.add(root);
        if (root instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) root).getChildCount(); i++) out.addAll(all(((ViewGroup) root).getChildAt(i)));
        return out;
    }

    static Button button(Activity a, String text) {
        for (View v : all(a.getWindow().getDecorView()))
            if (v instanceof Button && text.equals(((Button) v).getText().toString()) && v.isShown()) return (Button) v;
        throw new AssertionError("button not found: " + text);
    }

    static boolean hasText(Activity a, String fragment) {
        for (View v : all(a.getWindow().getDecorView()))
            if (v instanceof TextView && v.isShown() && ((TextView) v).getText().toString().contains(fragment)) return true;
        return false;
    }

    @Test public void homeShowsSessionStatsAndAllActions() throws Exception {
        ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).setup();
        flush();
        MainActivity a = c.get();
        assertTrue(hasText(a, "جرد نهاية الشهر"));
        for (String s : new String[]{"استيراد Excel", "جرد الأصناف", "كشف الأصناف", "التقارير", "تصدير Excel", "الطباعة", "جلسات الجرد", "الإعدادات والنسخ الاحتياطي"})
            assertTrue(s, hasText(a, s));
        assertTrue(hasText(a, "نسبة الإنجاز"));
        shot(a, "01_home");
    }

    @Test public void countingScreenCumulativeSaveAndDoubleTapProtection() throws Exception {
        ActivityController<CountActivity> c = Robolectric.buildActivity(CountActivity.class).setup();
        flush();
        CountActivity a = c.get();
        shot(a, "02_count_empty");
        // scan / type barcode then ENTER (external scanner behaves the same way)
        a.code.setText("4600");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        assertNotNull(a.current);
        assertEquals("عدسات فريش ليدي", a.current.name);
        assertFalse("scanning alone adds nothing", repo.item(a.current.id).counted);
        a.qty.setText("12");
        assertEquals("12", a.newV.getText().toString());
        assertEquals("12", a.afterV.getText().toString());
        assertTrue(a.totalV.getText().toString().startsWith("306.00"));
        shot(a, "03_count_item");
        Button save = button(a, "حفظ الكمية وجرد الصنف التالي");
        save.performClick();
        save.performClick();             // double tap
        flush();
        long id = repo.findByBarcode(sid, "4600").get(0).id;
        assertEquals(0, repo.item(id).qty.compareTo(new BigDecimal(12)));
        assertEquals(1, repo.opCount(sid));
        assertNull("ready for next item", a.current);
        // second count of the same item adds up
        a.code.setText("4600");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        assertEquals("12", a.prevV.getText().toString());
        a.qty.setText("8");
        assertEquals("20", a.afterV.getText().toString());
        assertTrue(a.totalV.getText().toString().startsWith("510.00"));
        shot(a, "04_count_second");
        a.qty.onEditorAction(EditorInfo.IME_ACTION_DONE);
        flush();
        assertEquals(0, repo.item(id).qty.compareTo(new BigDecimal(20)));
        assertTrue(a.statusBar.getText().toString().contains("510.00"));
    }

    @Test public void unknownBarcodeDoesNotCreateItemAndDuplicateAsksToChoose() throws Exception {
        ActivityController<CountActivity> c = Robolectric.buildActivity(CountActivity.class).setup();
        flush();
        CountActivity a = c.get();
        a.code.setText("5555555555555");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        assertNull(a.current);
        assertEquals(9, repo.stats(sid).items);
        androidx.appcompat.app.AlertDialog d = (androidx.appcompat.app.AlertDialog) org.robolectric.shadows.ShadowDialog.getLatestDialog();
        assertNotNull(d);
        assertTrue(d.isShowing());
        d.dismiss();
        a.code.setText("6281000000011");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        assertNull("duplicate barcode must not auto-select", a.current);
        androidx.appcompat.app.AlertDialog chooser = (androidx.appcompat.app.AlertDialog) org.robolectric.shadows.ShadowDialog.getLatestDialog();
        assertEquals(2, chooser.getListView().getAdapter().getCount());
        shot(a, "05_duplicate_chooser");
    }

    @Test public void searchByNameFromCountScreen() throws Exception {
        ActivityController<CountActivity> c = Robolectric.buildActivity(CountActivity.class).setup();
        flush();
        CountActivity a = c.get();
        a.code.setText("بدون باركود");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        assertNotNull(a.current);
        assertEquals("كريم بدون باركود", a.current.name);
    }

    @Test public void scannerBurstInQuantityFieldIsTreatedAsBarcode() throws Exception {
        ActivityController<CountActivity> c = Robolectric.buildActivity(CountActivity.class).setup();
        flush();
        CountActivity a = c.get();
        a.code.setText("4600");
        a.code.onEditorAction(EditorInfo.IME_ACTION_SEARCH);
        flush();
        a.qty.setText("");
        a.qty.setText("7000000000004"); // arrives "instantly" like a keyboard-wedge scanner
        a.qtyFirstKeyAt = android.os.SystemClock.uptimeMillis();
        a.qty.onEditorAction(EditorInfo.IME_ACTION_DONE);
        flush();
        assertEquals("عطر كبير", a.current.name);
        assertEquals(0, repo.opCount(sid)); // nothing saved for the previous item
    }

    @Test public void itemsListReportsSessionsSettingsRender() throws Exception {
        repo.addCount(repo.findByBarcode(sid, "4600").get(0).id, new BigDecimal(20), "t1");
        repo.addCount(repo.findByBarcode(sid, "7000000000002").get(0).id, BigDecimal.ZERO, "t2");
        ItemsActivity items = Robolectric.buildActivity(ItemsActivity.class).setup().get();
        flush();
        RecyclerView rv = null;
        for (View v : all(items.getWindow().getDecorView())) if (v instanceof RecyclerView) rv = (RecyclerView) v;
        assertNotNull(rv);
        assertEquals(9, rv.getAdapter().getItemCount());
        shot(items, "06_items");
        items.filter = Models.Filter.UNCOUNTED; items.reload(); flush();
        assertEquals(7, rv.getAdapter().getItemCount());

        ReportsActivity rep = Robolectric.buildActivity(ReportsActivity.class).setup().get();
        flush();
        assertTrue(hasText(rep, "510.00"));
        shot(rep, "07_reports");

        SessionsActivity ses = Robolectric.buildActivity(SessionsActivity.class).setup().get();
        flush();
        assertTrue(hasText(ses, "جرد نهاية الشهر"));
        shot(ses, "08_sessions");

        SettingsActivity set = Robolectric.buildActivity(SettingsActivity.class).setup().get();
        flush();
        assertTrue(hasText(set, "النسخ الاحتياطي"));
        shot(set, "09_settings");

        ExportActivity ex = Robolectric.buildActivity(ExportActivity.class).setup().get();
        flush();
        ex.prepare(() -> {});
        flush();
        assertNotNull(ex.last);
        assertEquals(9, ex.last.rows);
        assertTrue(ex.status.getText().toString().contains("مطابقة"));
        shot(ex, "10_export");

        PrintActivity pr = Robolectric.buildActivity(PrintActivity.class).setup().get();
        flush();
        assertTrue(hasText(pr, "جميع الأصناف (الافتراضي)"));
        shot(pr, "11_print_options");
    }

    @Test public void importWizardFromSharedFile() throws Exception {
        File f = TestUtil.fixture("f_single_reordered.xlsx");
        Intent i = new Intent(ctx, ImportActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.fromFile(f));
        ActivityController<ImportActivity> c = Robolectric.buildActivity(ImportActivity.class, i).setup();
        flush();
        ImportActivity a = c.get();
        assertNotNull("summary reached", a.result);
        assertEquals(20, a.result.rows.size());
        assertTrue(hasText(a, "ملخص الاستيراد"));
        shot(a, "12_import_summary");
        button(a, "بدء الجرد").performClick();
        flush();
        assertEquals(2, repo.sessions().size());
        long newSid = Settings.activeSession(ctx);
        assertNotEquals(sid, newSid);
        assertEquals(20, repo.stats(newSid).items);
        assertEquals(0, repo.stats(sid).counted); // previous session untouched
    }

    @Test public void importNeedsMappingForAmbiguousHeaders() throws Exception {
        File f = TestUtil.fixture("f_ambiguous.xlsx");
        Intent i = new Intent(ctx, ImportActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.fromFile(f));
        ActivityController<ImportActivity> c = Robolectric.buildActivity(ImportActivity.class, i).setup();
        flush();
        ImportActivity a = c.get();
        assertNull(a.result);
        androidx.appcompat.app.AlertDialog d = (androidx.appcompat.app.AlertDialog) org.robolectric.shadows.ShadowDialog.getLatestDialog();
        assertTrue(d.isShowing());
        d.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).performClick(); // accept suggested mapping
        flush();
        assertNotNull(a.result);
    }
}
