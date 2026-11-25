package com.smartstock.ui;

import android.app.Activity;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;

import java.math.BigDecimal;
import java.util.UUID;

/** "تصحيح الكمية التراكمية": shows current, corrected, difference and totals before confirming. */
public final class CorrectionDialog {
    private CorrectionDialog() {}

    public interface Done { void ok(Models.SaveResult r); }

    public static void show(Activity a, Repository repo, Models.Session s, Models.Item it, Done done) {
        String cur = s.currency.isEmpty() ? "" : " " + s.currency;
        LinearLayout box = Ui.vbox(a, 20);
        box.addView(Ui.text(a, it.name, 16, R.color.navy, true));
        TextInputLayout q = Ui.field(a, "الكمية الصحيحة النهائية", Num.plain(it.qty), true);
        TextInputLayout reason = Ui.field(a, "سبب التصحيح", "", false);
        box.addView(q, Ui.matchWrap(a, 10));
        box.addView(reason, Ui.matchWrap(a, 8));
        TextView info = Ui.text(a, "", 14, R.color.text, false);
        box.addView(info, Ui.matchWrap(a, 10));
        String token = UUID.randomUUID().toString();
        Runnable upd = () -> {
            BigDecimal v = Num.parseUser(Ui.edit(q).getText().toString());
            String err = Num.validateQty(v, s.allowDecimal);
            if (err != null) { info.setText(err); info.setTextColor(Ui.color(a, R.color.error)); return; }
            BigDecimal diff = v.subtract(it.qty);
            info.setTextColor(Ui.color(a, R.color.text));
            info.setText("الكمية الحالية: " + Num.qty(it.qty)
                    + "\nالكمية المصححة: " + Num.qty(v)
                    + "\nفرق الكمية: " + (diff.signum() > 0 ? "+" : "") + Num.qty(diff)
                    + "\nالإجمالي قبل التصحيح: " + (it.cost == null ? "—" : Num.money(it.total()) + cur)
                    + "\nالإجمالي بعد التصحيح: " + (it.cost == null ? "—" : Num.money(Num.total(v, it.cost)) + cur));
        };
        EditText e = Ui.edit(q);
        e.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence x, int a1, int b, int c) {}
            public void onTextChanged(CharSequence x, int a1, int b, int c) {}
            public void afterTextChanged(Editable x) { upd.run(); }
        });
        upd.run();
        AlertDialog d = new MaterialAlertDialogBuilder(a).setTitle("تصحيح الكمية التراكمية").setView(box)
                .setPositiveButton("تأكيد التصحيح", null).setNegativeButton("إلغاء", null).create();
        d.setOnShowListener(x -> d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            BigDecimal val = Num.parseUser(Ui.edit(q).getText().toString());
            String err = Num.validateQty(val, s.allowDecimal);
            if (err != null) { Ui.edit(q).setError(err); return; }
            String r = Ui.edit(reason).getText().toString().trim();
            if (r.isEmpty()) { Ui.edit(reason).setError("اكتب سبب التصحيح"); return; }
            d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            Bg.db(a, () -> repo.correct(it.id, val, r, token), res -> {
                d.dismiss();
                if (res.kind == Models.SaveResult.Kind.OK) done.ok(res);
                else if (res.kind != Models.SaveResult.Kind.DUPLICATE) Ui.info(a, "التصحيح", res.message);
            }, ex -> { d.dismiss(); Ui.error(a, ex); });
        }));
        d.show();
    }
}
