package com.smartstock.ui;

import android.app.Activity;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Field;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Form for an item that is not in the Excel file. Fields appear in the SAME order as the columns of
 * the session's Excel sheet and use the file's own column titles. Also used to edit an added item.
 */
public final class NewItemDialog {
    private NewItemDialog() {}

    public interface Done { void ok(Models.SaveResult r); }

    static final Field[] FIELDS = {Field.GROUP, Field.NAME, Field.UNIT, Field.PACK, Field.BARCODE, Field.QTY, Field.COST, Field.EXPIRY};

    /** Fields present in the file, sorted by their column position. */
    static List<Field> ordered(Models.Session s) {
        List<Field> l = new ArrayList<>();
        for (Field f : FIELDS) if (s.colMap.has(f)) l.add(f);
        l.sort((a, b) -> Integer.compare(s.colMap.get(a), s.colMap.get(b)));
        return l;
    }

    static String label(Models.Session s, Field f) {
        Integer col = s.colMap.get(f);
        String h = col != null && col < s.headers.size() ? s.headers.get(col) : null;
        return h == null || h.trim().isEmpty() ? f.label : h.trim();
    }

    /** existing == null: add a new item (qty is its first count); otherwise edit an added item (no qty). */
    public static void show(Activity a, Repository repo, Models.Session s, String barcode, Models.Item existing, Done done) {
        boolean edit = existing != null;
        String cur = s.currency.isEmpty() ? "" : " " + s.currency;
        LinearLayout box = Ui.vbox(a, 20);
        box.addView(Ui.text(a, edit ? "تعديل بيانات صنف مُضاف" : "صنف غير موجود في ملف Excel. سيُضاف للجلسة ويُكتب في ملف Excel المصدَّر كصف جديد بنفس ترتيب الأعمدة.", 13, R.color.text_muted, false));
        Map<Field, TextInputLayout> fields = new EnumMap<>(Field.class);
        for (Field f : ordered(s)) {
            if (edit && f == Field.QTY) continue;          // quantity of an added item changes through counting / correction
            boolean req = f == Field.NAME || f == Field.QTY || f == Field.COST;
            String value = null;
            if (edit) {
                switch (f) {
                    case GROUP: value = existing.group; break;
                    case NAME: value = existing.name; break;
                    case UNIT: value = existing.unit; break;
                    case PACK: value = existing.pack; break;
                    case BARCODE: value = existing.barcode; break;
                    case COST: value = existing.cost == null ? "" : Num.plain(existing.cost); break;
                    case EXPIRY: value = existing.expiry; break;
                    default: break;
                }
            } else if (f == Field.BARCODE) value = barcode;
            TextInputLayout t = Ui.field(a, label(s, f) + (req ? " *" : ""), value, f == Field.QTY || f == Field.COST);
            if (f == Field.QTY && !s.allowDecimal) { Ui.edit(t).setInputType(InputType.TYPE_CLASS_NUMBER); Ui.singleLineRtl(Ui.edit(t)); }
            if (f == Field.BARCODE) { Ui.edit(t).setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); Ui.singleLineRtl(Ui.edit(t)); }
            if (f == Field.EXPIRY) datePicker(a, Ui.edit(t));
            box.addView(t, Ui.matchWrap(a, 8));
            fields.put(f, t);
        }
        TextView total = Ui.text(a, "", 15, R.color.success, true);
        box.addView(total, Ui.matchWrap(a, 10));
        Runnable upd = () -> {
            BigDecimal q = edit ? existing.qty : val(fields.get(Field.QTY));
            BigDecimal c = val(fields.get(Field.COST));
            total.setText(q == null || c == null ? "إجمالي تكلفة الصنف: —" : "إجمالي تكلفة الصنف: " + Num.money(Num.total(q, c)) + cur);
        };
        for (TextInputLayout t : fields.values()) Ui.edit(t).addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence x, int i, int j, int k) {}
            public void onTextChanged(CharSequence x, int i, int j, int k) {}
            public void afterTextChanged(Editable e) { upd.run(); }
        });
        upd.run();
        ScrollView sv = new ScrollView(a);
        sv.addView(box);
        String token = UUID.randomUUID().toString();
        AlertDialog d = new MaterialAlertDialogBuilder(a).setTitle(edit ? "تعديل الصنف المضاف" : "إضافة صنف جديد").setView(sv)
                .setPositiveButton(edit ? "حفظ التعديل" : "إضافة وحفظ الكمية", null).setNegativeButton("إلغاء", null).create();
        d.setOnShowListener(x -> d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            Models.NewItem n = new Models.NewItem();
            n.group = txt(fields.get(Field.GROUP)); n.name = txt(fields.get(Field.NAME)); n.unit = txt(fields.get(Field.UNIT));
            n.pack = txt(fields.get(Field.PACK)); n.barcode = txt(fields.get(Field.BARCODE));
            n.cost = val(fields.get(Field.COST));
            n.expiry = txt(fields.get(Field.EXPIRY));
            n.qty = edit ? existing.qty : val(fields.get(Field.QTY));
            if (n.name.isEmpty()) { Ui.edit(fields.get(Field.NAME)).setError("اسم الصنف مطلوب"); return; }
            if (!edit) {
                String err = Num.validateQty(n.qty, s.allowDecimal);
                if (err != null) { Ui.edit(fields.get(Field.QTY)).setError(err); return; }
            }
            if (n.cost == null || n.cost.signum() < 0) { Ui.edit(fields.get(Field.COST)).setError("أدخل تكلفة صحيحة"); return; }
            d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            Bg.db(a, () -> {
                // a typed barcode that already exists in the file must not create a duplicate silently
                if (!n.barcode.isEmpty()) for (Models.Item it : repo.findByBarcode(s.id, n.barcode))
                    if (!edit || it.id != existing.id) return new Object[]{"DUP", it};
                return new Object[]{"OK", edit ? repo.updateAddedItem(existing.id, n) : repo.addNewItem(s.id, n, token)};
            }, r -> {
                if ("DUP".equals(r[0])) {
                    d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                    Ui.edit(fields.get(Field.BARCODE)).setError("هذا الباركود موجود لصنف: " + ((Models.Item) r[1]).name);
                    return;
                }
                Models.SaveResult res = (Models.SaveResult) r[1];
                if (res.kind == Models.SaveResult.Kind.OK) { d.dismiss(); done.ok(res); }
                else if (res.kind == Models.SaveResult.Kind.DUPLICATE) d.dismiss();
                else { d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); Ui.info(a, "تعذر الحفظ", res.message); }
            }, e -> { d.dismiss(); Ui.error(a, e); });
        }));
        d.show();
    }

    /** Tap = calendar (yyyy-MM-dd); long press = clear. */
    static void datePicker(Activity a, EditText e) {
        e.setFocusable(false);
        e.setHint("اضغط لاختيار التاريخ");
        e.setOnClickListener(v -> {
            java.util.Calendar c = java.util.Calendar.getInstance();
            try { c.setTime(new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(e.getText().toString())); } catch (Exception ignored) {}
            new android.app.DatePickerDialog(a, (dp, y, m, d) -> e.setText(String.format(java.util.Locale.US, "%04d-%02d-%02d", y, m + 1, d)),
                    c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH), c.get(java.util.Calendar.DAY_OF_MONTH)).show();
        });
        e.setOnLongClickListener(v -> { e.setText(""); return true; });
    }

    static String txt(TextInputLayout t) { return t == null ? "" : Ui.edit(t).getText().toString().trim(); }

    static BigDecimal val(TextInputLayout t) { return t == null ? null : Num.parseUser(Ui.edit(t).getText().toString()); }

    static EditText edit(TextInputLayout t) { return Ui.edit(t); }
}
