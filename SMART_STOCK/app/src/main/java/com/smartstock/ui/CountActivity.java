package com.smartstock.ui;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.smartstock.R;
import com.smartstock.core.ArabicText;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Settings;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Counting screen (one-hand use). Scan/type barcode -> item shown read-only -> type quantity ->
 * "save & next". Scanning alone never adds anything. A per-entry idempotency token plus button
 * locking make double taps / repeated scanner signals harmless.
 */
public class CountActivity extends BaseActivity {

    public static final String EXTRA_ITEM = "item_id";

    Models.Session session;
    Models.Item current;
    String pendingToken;
    boolean saving;

    EditText code, qty;
    MaterialCardView itemCard, qtyCard;
    LinearLayout itemBox;
    TextView prevV, newV, afterV, costV, totalV, statusBar, stateChip;
    MaterialButton saveBtn;
    long qtyFirstKeyAt;
    ToneGenerator tone;
    ActivityResultLauncher<Intent> scanLauncher;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        scanLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            if (r.getResultCode() == RESULT_OK && r.getData() != null) {
                String c = r.getData().getStringExtra(ScanActivity.EXTRA_CODE);
                if (c != null) { code.setText(c); lookup(c, true); }
            }
        });
        buildUi();
        long sid = activeSessionId();
        long itemId = getIntent().getLongExtra(EXTRA_ITEM, -1);
        long restore = b != null ? b.getLong("current", -1) : -1;
        Bg.db(this, () -> new Object[]{repo.session(sid), itemId > 0 ? repo.item(itemId) : (restore > 0 ? repo.item(restore) : null)}, r -> {
            session = (Models.Session) r[0];
            if (session == null) { Toast.makeText(this, "لا توجد جلسة نشطة", Toast.LENGTH_LONG).show(); finish(); return; }
            toolbar.setTitle("جرد: " + session.name);
            if (session.allowDecimal) { qty.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL); Ui.singleLineRtl(qty); }
            if (session.isFinished()) Ui.info(this, "جلسة منتهية", "هذه الجلسة مُعلّمة كمنتهية. يمكنك متابعة الجرد وسيتم الحفظ بشكل طبيعي.");
            if (r[1] != null) show((Models.Item) r[1]);
            refreshStats();
        }, null);
    }

    @Override protected void onSaveInstanceState(Bundle o) {
        super.onSaveInstanceState(o);
        if (current != null) o.putLong("current", current.id);
    }

    // ------------------------------------------------------------------ UI

    void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        toolbar = toolbar("جرد الأصناف", true);
        root.addView(toolbar);
        ScrollView sv = new ScrollView(this);
        LinearLayout c = Ui.vbox(this, 12);
        sv.addView(c);
        root.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        // --- section 1: search
        MaterialCardView searchCard = Ui.card(this);
        LinearLayout sb = Ui.box(searchCard);
        LinearLayout row = Ui.hbox(this);
        code = new EditText(this);
        code.setHint("امسح أو اكتب الباركود / اسم الصنف");
        
        code.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        code.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        code.setTextDirection(View.TEXT_DIRECTION_RTL);
        Ui.singleLineRtl(code);
        code.setOnEditorActionListener((v, a, e) -> { if (isEnter(a, e)) { lookup(code.getText().toString(), false); return true; } return false; });
        row.addView(code, Ui.weight(1));
        MaterialButton cam = Ui.button(this, "", Ui.Style.GOLD, R.drawable.ic_camera, v -> openCamera());
        cam.setContentDescription("مسح بالكاميرا");
        cam.setIconPadding(0);
        row.addView(cam, new LinearLayout.LayoutParams(Ui.dp(this, 60), Ui.dp(this, 60)));
        MaterialButton find = Ui.button(this, "", Ui.Style.PRIMARY, R.drawable.ic_search, v -> lookup(code.getText().toString(), false));
        find.setContentDescription("بحث");
        find.setIconPadding(0);
        LinearLayout.LayoutParams fp = new LinearLayout.LayoutParams(Ui.dp(this, 60), Ui.dp(this, 60));
        fp.setMarginStart(Ui.dp(this, 6));
        row.addView(find, fp);
        sb.addView(row);
        c.addView(searchCard);

        // --- section 2: item details (read-only)
        itemCard = Ui.card(this);
        itemBox = Ui.box(itemCard);
        itemCard.setVisibility(View.GONE);
        c.addView(itemCard, Ui.matchWrap(this, 10));

        // --- section 3: quantity
        qtyCard = Ui.card(this);
        LinearLayout qb = Ui.box(qtyCard);
        qb.addView(Ui.text(this, "الكمية الجديدة", 14, R.color.text_muted, true));
        LinearLayout qr = Ui.hbox(this);
        MaterialButton minus = Ui.button(this, "", Ui.Style.OUTLINE, R.drawable.ic_remove, v -> step(-1));
        minus.setContentDescription("نقصان"); minus.setIconPadding(0);
        MaterialButton plus = Ui.button(this, "", Ui.Style.OUTLINE, R.drawable.ic_add, v -> step(1));
        plus.setContentDescription("زيادة"); plus.setIconPadding(0);
        qty = new EditText(this);
        qty.setInputType(InputType.TYPE_CLASS_NUMBER);
        qty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        qty.setGravity(Gravity.CENTER);
        qty.setTypeface(Ui.bold(this));
        qty.setHint("0");
        qty.setImeOptions(EditorInfo.IME_ACTION_DONE);
        qty.setSelectAllOnFocus(true);
        Ui.singleLineRtl(qty);
        qty.setOnEditorActionListener((v, a, e) -> { if (isEnter(a, e)) { onQtyEnter(); return true; } return false; });
        qty.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) { if (s.length() == 0) qtyFirstKeyAt = SystemClock.uptimeMillis(); }
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable e) { updatePreview(); }
        });
        qr.addView(plus, new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 64)));
        qr.addView(qty, Ui.weight(1));
        qr.addView(minus, new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 64)));
        qb.addView(qr, Ui.matchWrap(this, 4));
        LinearLayout grid = Ui.vbox(this, 0);
        prevV = addKv(grid, "الكمية السابقة");
        newV = addKv(grid, "الكمية الجديدة");
        afterV = addKv(grid, "الكمية بعد الحفظ");
        costV = addKv(grid, "التكلفة");
        totalV = addKv(grid, "إجمالي تكلفة الصنف");
        totalV.setTextColor(Ui.color(this, R.color.success));
        totalV.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        qb.addView(grid, Ui.matchWrap(this, 6));
        saveBtn = Ui.button(this, "حفظ الكمية وجرد الصنف التالي", Ui.Style.SUCCESS, R.drawable.ic_check, v -> save());
        saveBtn.setMinHeight(Ui.dp(this, 64));
        saveBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        qb.addView(saveBtn, Ui.matchWrap(this, 10));
        LinearLayout sec = Ui.hbox(this);
        MaterialButton zero = Ui.button(this, "غير موجود (صفر)", Ui.Style.OUTLINE, R.drawable.ic_zero, v -> confirmZero());
        MaterialButton corr = Ui.button(this, "تصحيح الكمية التراكمية", Ui.Style.OUTLINE, R.drawable.ic_edit, v -> correction());
        zero.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        corr.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        LinearLayout.LayoutParams zp = Ui.weight(1); zp.setMarginEnd(Ui.dp(this, 6));
        sec.addView(zero, zp);
        sec.addView(corr, Ui.weight(1));
        qb.addView(sec, Ui.matchWrap(this, 4));
        qb.addView(Ui.button(this, "سجل عمليات الصنف", Ui.Style.TEXT, R.drawable.ic_history, v -> itemHistory()), Ui.matchWrap(this, 0));
        qtyCard.setVisibility(View.GONE);
        c.addView(qtyCard, Ui.matchWrap(this, 10));

        // --- bottom session bar
        statusBar = Ui.text(this, "", 13, R.color.card, true);
        statusBar.setBackgroundColor(Ui.color(this, R.color.navy));
        statusBar.setPadding(Ui.dp(this, 14), Ui.dp(this, 8), Ui.dp(this, 14), Ui.dp(this, 8));
        statusBar.setGravity(Gravity.CENTER);
        statusBar.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        root.addView(statusBar);
        setContentView(root);
        applyInsets(root);
        code.requestFocus();
    }

    TextView addKv(LinearLayout parent, String k) {
        LinearLayout r = Ui.hbox(this);
        r.setPadding(0, Ui.dp(this, 2), 0, Ui.dp(this, 2));
        r.addView(Ui.text(this, k, 14, R.color.text_muted, false), Ui.weight(1));
        TextView v = Ui.text(this, "—", 16, R.color.text, true);
        v.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
        r.addView(v, Ui.weight(1));
        parent.addView(r);
        return v;
    }

    static boolean isEnter(int action, KeyEvent e) {
        return action == EditorInfo.IME_ACTION_SEARCH || action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_GO
                || (e != null && e.getKeyCode() == KeyEvent.KEYCODE_ENTER && e.getAction() == KeyEvent.ACTION_DOWN);
    }

    // ------------------------------------------------------------------ lookup

    void openCamera() {
        if (session == null) return;
        scanLauncher.launch(new Intent(this, ScanActivity.class));
    }

    void lookup(String raw, boolean fromCamera) {
        if (session == null) return;
        String t = ArabicText.digitsToLatin(raw == null ? "" : raw.trim());
        if (t.isEmpty()) { code.requestFocus(); return; }
        if (current != null && qty.getText().length() > 0)
            Toast.makeText(this, "تم تجاهل كمية غير محفوظة للصنف السابق", Toast.LENGTH_SHORT).show();
        boolean digits = t.matches("[0-9A-Za-z\\-]+") && t.matches(".*\\d.*");
        long sid = session.id;
        Bg.db(this, () -> {
            List<Models.Item> l = repo.findByBarcode(sid, t);
            if (l.isEmpty() && !digits) l = repo.query(sid, t, null, null, Models.Sort.NAME, 60, 0);
            return l;
        }, list -> {
            if (list.size() == 1) { show(list.get(0)); return; }
            if (list.isEmpty()) { notFound(t, digits); return; }
            choose(list, digits ? "الباركود " + t + " مرتبط بأكثر من صنف — اختر الصنف المقصود" : "نتائج البحث عن «" + t + "»");
        }, null);
    }

    void notFound(String t, boolean digits) {
        feedback(false);
        new MaterialAlertDialogBuilder(this)
                .setTitle(digits ? "الباركود غير موجود" : "لا توجد نتائج")
                .setMessage(digits ? "الباركود " + t + " غير موجود في ملف هذه الجلسة.\nلن يتم إنشاء صنف جديد. يمكنك البحث باسم الصنف." : "لم يتم العثور على صنف باسم «" + t + "».")
                .setPositiveButton("بحث بالاسم", (d, w) -> { code.setText(""); code.setHint("اكتب جزءًا من اسم الصنف"); focus(code); })
                .setNegativeButton("إغلاق", (d, w) -> { code.selectAll(); focus(code); })
                .show();
    }

    void choose(List<Models.Item> list, String title) {
        String[] rows = new String[list.size()];
        for (int i = 0; i < list.size(); i++) {
            Models.Item it = list.get(i);
            rows[i] = it.name + "\n" + (it.group.isEmpty() ? "" : it.group + " • ") + "العبوة: " + (it.pack.isEmpty() ? "—" : it.pack)
                    + " • التكلفة: " + Num.money(it.cost) + " • صف Excel " + it.rowNum + (it.counted ? " • الكمية: " + Num.qty(it.qty) : "");
        }
        new MaterialAlertDialogBuilder(this).setTitle(title)
                .setItems(rows, (d, w) -> show(list.get(w)))
                .setNegativeButton("إلغاء", (d, w) -> focus(code)).show();
    }

    // ------------------------------------------------------------------ item

    void show(Models.Item it) {
        current = it;
        pendingToken = UUID.randomUUID().toString(); // one token per pending entry => no double add
        itemBox.removeAllViews();
        LinearLayout head = Ui.hbox(this);
        TextView name = Ui.text(this, it.name, 19, R.color.navy, true);
        head.addView(name, Ui.weight(1));
        stateChip = chipFor(it);
        head.addView(stateChip);
        itemBox.addView(head);
        itemBox.addView(Ui.divider(this));
        itemBox.addView(Ui.kv(this, "اسم المجموعة", dash(it.group), false));
        itemBox.addView(Ui.kv(this, "الوحدة", dash(it.unit), false));
        itemBox.addView(Ui.kv(this, "العبوة / حبة", dash(it.pack), false));
        itemBox.addView(Ui.kv(this, "الباركود", dash(it.barcode), false));
        itemBox.addView(Ui.kv(this, "التكلفة", it.cost == null ? "غير صالحة" : Num.money(it.cost) + cur(), false));
        itemBox.addView(Ui.kv(this, "الكمية المحفوظة سابقًا", Num.qty(it.qty), true));
        itemBox.addView(Ui.kv(this, "إجمالي تكلفة الصنف الحالي", it.cost == null ? "—" : Num.money(it.total()) + cur(), false));
        if (it.cost == null) itemBox.addView(Ui.text(this, "⚠ " + (it.costIssue == null ? "التكلفة غير صالحة" : it.costIssue) + " — صحّحها في ملف Excel.", 13, R.color.error, false));
        itemCard.setVisibility(View.VISIBLE);
        qtyCard.setVisibility(View.VISIBLE);
        qty.setText("");
        updatePreview();
        feedback(true);
        focus(qty);
    }

    TextView chipFor(Models.Item it) {
        switch (it.state()) {
            case 0: return Ui.chip(this, "لم يُجرد", R.color.divider, R.color.text_muted);
            case 1: return Ui.chip(this, "مجرود بكمية صفر", R.color.gold, R.color.navy);
            default: return Ui.chip(this, "مجرود", R.color.success, R.color.card);
        }
    }

    static String dash(String s) { return s == null || s.isEmpty() ? "—" : s; }

    String cur() { return session == null || session.currency.isEmpty() ? "" : " " + session.currency; }

    BigDecimal typedQty() {
        String t = qty.getText().toString().trim();
        if (t.isEmpty()) return null;
        return Num.parseUser(t);
    }

    void updatePreview() {
        if (current == null) return;
        BigDecimal in = typedQty();
        prevV.setText(Num.qty(current.qty));
        newV.setText(in == null ? "—" : Num.qty(in));
        BigDecimal after = in == null ? current.qty : current.qty.add(in);
        afterV.setText(Num.qty(after));
        costV.setText(current.cost == null ? "غير صالحة" : Num.money(current.cost) + cur());
        totalV.setText(current.cost == null ? "—" : Num.money(Num.total(after, current.cost)) + cur());
        String err = in == null ? null : Num.validateQty(in, session.allowDecimal);
        qty.setError(err);
    }

    void step(int d) {
        if (current == null) return;
        BigDecimal v = typedQty();
        if (v == null) v = BigDecimal.ZERO;
        v = v.add(BigDecimal.valueOf(d));
        if (v.signum() < 0) v = BigDecimal.ZERO;
        qty.setText(Num.plain(v));
        qty.setSelection(qty.getText().length());
    }

    /** Detects an external (keyboard-wedge) scanner burst typed into the quantity field. */
    void onQtyEnter() {
        String t = qty.getText().toString().trim();
        long elapsed = SystemClock.uptimeMillis() - qtyFirstKeyAt;
        if (t.length() >= 6 && t.matches("\\d+") && elapsed < 45L * t.length()) {
            qty.setText("");
            code.setText(t);
            Toast.makeText(this, "تم التعرف على باركود في حقل الكمية — لم تُحفظ أي كمية", Toast.LENGTH_SHORT).show();
            lookup(t, false);
            return;
        }
        save();
    }

    // ------------------------------------------------------------------ save

    void save() {
        if (current == null || saving) return;
        BigDecimal in = typedQty();
        String err = Num.validateQty(in, session.allowDecimal);
        if (in == null) err = "أدخل الكمية الجديدة أولًا";
        if (err != null) { qty.setError(err); feedback(false); return; }
        if (in.compareTo(BigDecimal.valueOf(Settings.largeQty(this))) > 0) {
            Ui.confirm(this, "كمية كبيرة", "الكمية المدخلة " + Num.qty(in) + " أكبر من المعتاد. هل هي صحيحة؟", "نعم، احفظ", () -> doSave(in));
            return;
        }
        doSave(in);
    }

    void doSave(BigDecimal in) {
        saving = true;
        saveBtn.setEnabled(false);
        Models.Item it = current;
        String token = pendingToken;
        Bg.db(this, () -> repo.addCount(it.id, in, token), r -> {
            saving = false;
            saveBtn.setEnabled(true);
            switch (r.kind) {
                case OK:
                    Toast.makeText(this, "تم الحفظ: " + it.name + " ← " + Num.qty(r.item.qty), Toast.LENGTH_SHORT).show();
                    nextItem();
                    break;
                case DUPLICATE: nextItem(); break;
                default: feedback(false); Ui.info(this, "تعذر الحفظ", r.message);
            }
        }, e -> { saving = false; saveBtn.setEnabled(true); Ui.error(this, e); });
    }

    void nextItem() {
        feedback(true);
        current = null;
        pendingToken = null;
        qty.setText("");
        itemCard.setVisibility(View.GONE);
        qtyCard.setVisibility(View.GONE);
        code.setText("");
        code.setHint("امسح أو اكتب الباركود / اسم الصنف");
        focus(code);
        refreshStats();
    }

    void confirmZero() {
        if (current == null) return;
        Models.Item it = current;
        if (it.counted && it.qty.signum() > 0) {
            Ui.info(this, "الصنف له كمية", "للصنف كمية محفوظة (" + Num.qty(it.qty) + "). لتعديلها إلى صفر استخدم «تصحيح الكمية التراكمية».");
            return;
        }
        Ui.confirm(this, "تأكيد عدم وجود الصنف", "سيُسجل «" + it.name + "» كصنف مجرود بكمية صفر.", "تأكيد", () -> {
            String token = pendingToken;
            Bg.db(this, () -> repo.addCount(it.id, BigDecimal.ZERO, token), r -> {
                if (r.kind == Models.SaveResult.Kind.OK || r.kind == Models.SaveResult.Kind.DUPLICATE) {
                    Toast.makeText(this, "تم تسجيل الصنف بكمية صفر", Toast.LENGTH_SHORT).show();
                    nextItem();
                } else Ui.info(this, "تعذر الحفظ", r.message);
            }, null);
        });
    }

    void correction() {
        if (current == null) return;
        Models.Item it = current;
        CorrectionDialog.show(this, repo, session, it, r -> {
            Toast.makeText(this, "تم تصحيح الكمية إلى " + Num.qty(r.item.qty), Toast.LENGTH_SHORT).show();
            show(r.item);
            refreshStats();
        });
    }

    void itemHistory() {
        if (current == null) return;
        Models.Item it = current;
        Bg.db(this, () -> repo.ops(session.id, it.id, 100), ops -> {
            if (ops.isEmpty()) { Ui.info(this, "سجل الصنف", "لا توجد عمليات على هذا الصنف بعد."); return; }
            StringBuilder b = new StringBuilder();
            for (Models.Op o : ops) b.append(ReportsActivity.describe(o)).append("\n\n");
            Ui.info(this, "سجل عمليات: " + it.name, b.toString().trim());
        }, null);
    }

    void undoLast() {
        if (session == null) return;
        ReportsActivity.undoLastFlow(this, repo, session.id, () -> {
            if (current != null) Bg.db(this, () -> repo.item(current.id), this::show, null);
            refreshStats();
        });
    }

    void refreshStats() {
        if (session == null) return;
        long sid = session.id;
        Bg.db(this, () -> repo.stats(sid), st -> statusBar.setText(
                "المجرودة " + st.counted + " / " + st.items + "  •  " + st.percent() + "%  •  القيمة " + Num.money(st.sumValue) + cur()), null);
    }

    // ------------------------------------------------------------------ feedback

    void feedback(boolean ok) {
        if (Settings.sound(this)) {
            try {
                if (tone == null) tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
                tone.startTone(ok ? ToneGenerator.TONE_PROP_BEEP : ToneGenerator.TONE_PROP_NACK, ok ? 120 : 250);
            } catch (Exception ignored) {}
        }
        if (Settings.vibrate(this)) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null) v.vibrate(VibrationEffect.createOneShot(ok ? 40 : 200, VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (Exception ignored) {}
        }
    }

    void focus(EditText e) {
        e.requestFocus();
        e.post(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(e, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    // ------------------------------------------------------------------ menu

    @Override public boolean onCreateOptionsMenu(Menu m) {
        toolbar.getMenu().clear();
        toolbar.getMenu().add(0, 1, 0, "تراجع عن آخر عملية").setIcon(R.drawable.ic_undo).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        toolbar.getMenu().add(0, 2, 0, "كشف الأصناف").setIcon(R.drawable.ic_list).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        for (int i = 0; i < toolbar.getMenu().size(); i++) {
            android.graphics.drawable.Drawable d = toolbar.getMenu().getItem(i).getIcon();
            if (d != null) d.setTint(0xFFFFFFFF);
        }
        toolbar.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) undoLast();
            else if (item.getItemId() == 2) startActivity(new Intent(this, ItemsActivity.class));
            return true;
        });
        return true;
    }

    @Override protected void onPostCreate(Bundle b) {
        super.onPostCreate(b);
        onCreateOptionsMenu(null);
    }

    @Override protected void onResume() {
        super.onResume();
        if (current != null && session != null) {
            long id = current.id;
            String typed = qty.getText().toString();
            String token = pendingToken;
            Bg.db(this, () -> repo.item(id), it -> {
                if (it == null) return;
                // refresh the item (it may have been corrected from the list) without losing typed quantity
                current = it;
                pendingToken = token;
                qty.setText(typed);
                updatePreview();
            }, null);
        }
        refreshStats();
    }

    @Override protected void onDestroy() {
        if (tone != null) tone.release();
        super.onDestroy();
    }
}
