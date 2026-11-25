package com.smartstock.ui;

import android.content.Intent;
import android.os.Bundle;
import android.widget.LinearLayout;

import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Settings;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Multiple independent sessions: open/resume, re-export, re-print, finish, edit, delete (double-confirmed). */
public class SessionsActivity extends BaseActivity {
    LinearLayout content;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        content = scaffold("جلسات الجرد", true);
    }

    @Override protected void onResume() {
        super.onResume();
        load();
    }

    void load() {
        Bg.db(this, () -> {
            List<Object[]> out = new ArrayList<>();
            for (Models.Session s : repo.sessions()) out.add(new Object[]{s, repo.stats(s.id)});
            return out;
        }, this::render, null);
    }

    void render(List<Object[]> list) {
        content.removeAllViews();
        long active = activeSessionId();
        if (list.isEmpty()) content.addView(Ui.text(this, "لا توجد جلسات بعد. استورد ملف Excel من الشاشة الرئيسية.", 15, R.color.text_muted, false));
        for (Object[] r : list) {
            Models.Session s = (Models.Session) r[0];
            Models.Stats st = (Models.Stats) r[1];
            MaterialCardView c = Ui.card(this);
            if (s.id == active) { c.setStrokeColor(Ui.color(this, R.color.gold_dark)); c.setStrokeWidth(Ui.dp(this, 2)); }
            LinearLayout box = Ui.box(c);
            LinearLayout head = Ui.hbox(this);
            head.addView(Ui.text(this, s.name, 17, R.color.navy, true), Ui.weight(1));
            if (s.id == active) head.addView(Ui.chip(this, "الحالية", R.color.gold, R.color.navy));
            head.addView(Ui.chip(this, s.isFinished() ? "منتهية" : "قيد الجرد", s.isFinished() ? R.color.divider : R.color.success, s.isFinished() ? R.color.text_muted : R.color.card));
            box.addView(head);
            box.addView(Ui.text(this, (s.shop.isEmpty() ? "" : s.shop + " • ") + "تاريخ الجرد " + s.countDate + " • " + s.fileName, 13, R.color.text_muted, false));
            String cur = s.currency.isEmpty() ? "" : " " + s.currency;
            box.addView(Ui.kv(this, "المجرودة", st.counted + " / " + st.items + " (" + st.percent() + "%)", false));
            box.addView(Ui.kv(this, "القيمة", Num.money(st.sumValue) + cur, true));
            LinearLayout a1 = Ui.hbox(this);
            LinearLayout.LayoutParams p = Ui.weight(1); p.setMarginEnd(Ui.dp(this, 6));
            a1.addView(Ui.button(this, s.id == active ? "متابعة الجرد" : "فتح واستئناف", Ui.Style.PRIMARY, R.drawable.ic_barcode, v -> open(s)), p);
            a1.addView(Ui.button(this, s.isFinished() ? "إعادة فتح" : "إنهاء الجرد", Ui.Style.OUTLINE, R.drawable.ic_check, v -> toggleFinish(s, st)), Ui.weight(1));
            box.addView(a1, Ui.matchWrap(this, 8));
            LinearLayout a2 = Ui.hbox(this), a3 = Ui.hbox(this);
            LinearLayout.LayoutParams q1 = Ui.weight(1); q1.setMarginEnd(Ui.dp(this, 6));
            LinearLayout.LayoutParams q2 = Ui.weight(1); q2.setMarginEnd(Ui.dp(this, 6));
            a2.addView(Ui.button(this, "تصدير", Ui.Style.OUTLINE, R.drawable.ic_export, v -> startActivity(new Intent(this, ExportActivity.class).putExtra(ExportActivity.EXTRA_SESSION, s.id))), q1);
            a2.addView(Ui.button(this, "طباعة", Ui.Style.OUTLINE, R.drawable.ic_print, v -> startActivity(new Intent(this, PrintActivity.class).putExtra(PrintActivity.EXTRA_SESSION, s.id))), Ui.weight(1));
            a3.addView(Ui.button(this, "تعديل", Ui.Style.TEXT, R.drawable.ic_edit, v -> edit(s)), q2);
            a3.addView(Ui.button(this, "حذف", Ui.Style.TEXT, R.drawable.ic_close, v -> delete(s, st)), Ui.weight(1));
            box.addView(a2, Ui.matchWrap(this, 4));
            box.addView(a3);
            content.addView(c, Ui.matchWrap(this, 10));
        }
    }

    void open(Models.Session s) {
        Settings.setActiveSession(this, s.id);
        startActivity(new Intent(this, CountActivity.class));
    }

    void toggleFinish(Models.Session s, Models.Stats st) {
        if (s.isFinished()) {
            Ui.confirm(this, "إعادة فتح الجلسة", "ستعود الجلسة إلى حالة «قيد الجرد».", "إعادة فتح",
                    () -> Bg.db(this, () -> { repo.setStatus(s.id, "ACTIVE"); return true; }, x -> load(), null));
            return;
        }
        String msg = st.uncounted > 0
                ? "تنبيه: يوجد " + st.uncounted + " صنف لم يتم جرده. لن تتغير كمياتها (ستبقى غير مجرودة وتظهر بكمية صفر في التقرير والتصدير).\n\nهل تريد إنهاء الجرد؟"
                : "تم جرد جميع الأصناف. هل تريد إنهاء الجرد؟";
        Ui.confirm(this, "إنهاء الجرد", msg, "إنهاء", () -> Bg.db(this, () -> { repo.setStatus(s.id, "FINISHED"); return true; }, x -> load(), null));
    }

    void edit(Models.Session s) {
        LinearLayout box = Ui.vbox(this, 20);
        TextInputLayout n = Ui.field(this, "اسم الجلسة", s.name, false);
        TextInputLayout shop = Ui.field(this, "اسم المحل", s.shop, false);
        TextInputLayout cur = Ui.field(this, "اسم العملة في التقرير", s.currency, false);
        box.addView(n); box.addView(shop, Ui.matchWrap(this, 8)); box.addView(cur, Ui.matchWrap(this, 8));
        new MaterialAlertDialogBuilder(this).setTitle("تعديل بيانات الجلسة").setView(box)
                .setPositiveButton("حفظ", (d, w) -> {
                    String name = Ui.edit(n).getText().toString().trim();
                    if (name.isEmpty()) return;
                    Bg.db(this, () -> { repo.updateSessionInfo(s.id, name, Ui.edit(shop).getText().toString().trim(), Ui.edit(cur).getText().toString().trim()); return true; }, x -> load(), null);
                }).setNegativeButton("إلغاء", null).show();
    }

    void delete(Models.Session s, Models.Stats st) {
        new MaterialAlertDialogBuilder(this).setTitle("حذف جلسة الجرد")
                .setMessage("سيتم حذف الجلسة «" + s.name + "» نهائيًا مع " + st.counted + " صنف مجرود وسجل العمليات.\nلا يمكن التراجع. يُنصح بتصدير الجلسة أو أخذ نسخة احتياطية أولًا.")
                .setPositiveButton("متابعة الحذف", (d, w) -> new MaterialAlertDialogBuilder(this).setTitle("تأكيد نهائي")
                        .setMessage("هل أنت متأكد من حذف «" + s.name + "»؟")
                        .setPositiveButton("نعم، احذف نهائيًا", (d2, w2) -> Bg.db(this, () -> {
                            repo.deleteSession(s.id);
                            //noinspection ResultOfMethodCallIgnored
                            new File(getFilesDir(), s.sourceFile).delete();
                            if (Settings.activeSession(this) == s.id) Settings.setActiveSession(this, -1);
                            return true;
                        }, x -> load(), null))
                        .setNegativeButton("إلغاء", null).show())
                .setNegativeButton("إلغاء", null).show();
    }
}
