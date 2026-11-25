package com.smartstock.ui;

import android.app.Activity;
import android.os.Bundle;
import android.widget.LinearLayout;

import com.google.android.material.card.MaterialCardView;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;
import com.smartstock.data.Repository;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Session report: totals, per-group breakdown, operation log, undo and an integrity self-check. */
public class ReportsActivity extends BaseActivity {

    LinearLayout content;
    Models.Session session;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        content = scaffold("التقارير", true);
        load();
    }

    void load() {
        long sid = activeSessionId();
        Bg.db(this, () -> {
            Models.Session s = repo.session(sid);
            if (s == null) return null;
            return new Object[]{s, repo.stats(sid), repo.groupStats(sid), repo.ops(sid, null, 300), repo.opCount(sid)};
        }, r -> {
            if (r == null) { finish(); return; }
            session = (Models.Session) r[0];
            Models.Stats st = (Models.Stats) r[1];
            @SuppressWarnings("unchecked") List<Models.GroupStat> gs = (List<Models.GroupStat>) r[2];
            @SuppressWarnings("unchecked") List<Models.Op> ops = (List<Models.Op>) r[3];
            render(st, gs, ops, (Integer) r[4]);
        }, null);
    }

    void render(Models.Stats st, List<Models.GroupStat> gs, List<Models.Op> ops, int opCount) {
        content.removeAllViews();
        String cur = session.currency.isEmpty() ? "" : " " + session.currency;
        MaterialCardView c1 = Ui.card(this);
        LinearLayout b1 = Ui.box(c1);
        b1.addView(Ui.text(this, session.name, 18, R.color.navy, true));
        b1.addView(Ui.text(this, (session.shop.isEmpty() ? "" : session.shop + " • ") + "تاريخ الجرد " + session.countDate + " • " + (session.isFinished() ? "منتهية" : "نشطة"), 13, R.color.text_muted, false));
        b1.addView(Ui.divider(this));
        b1.addView(Ui.kv(this, "عدد الأصناف", String.valueOf(st.items), false));
        b1.addView(Ui.kv(this, "المجرودة", String.valueOf(st.counted), false));
        b1.addView(Ui.kv(this, "غير المجرودة", String.valueOf(st.uncounted), false));
        b1.addView(Ui.kv(this, "مجرودة بكمية صفر", String.valueOf(st.countedZero), false));
        b1.addView(Ui.kv(this, "ذات كمية موجبة", String.valueOf(st.positive), false));
        if (st.added > 0) b1.addView(Ui.kv(this, "أصناف مُضافة أثناء الجرد", String.valueOf(st.added), false));
        b1.addView(Ui.kv(this, "إجمالي الكميات", Num.qty(st.sumQty), false));
        b1.addView(Ui.kv(this, "نسبة الإنجاز", st.percent() + "%", false));
        b1.addView(Ui.kv(this, "إجمالي القيمة المالية", Num.money(st.sumValue) + cur, true));
        if (st.invalidCost > 0) b1.addView(Ui.text(this, "⚠ " + st.invalidCost + " صنف بتكلفة غير صالحة؛ " + st.valuedMissing + " منها لها كمية ولم تدخل قيمتها في الإجمالي.", 13, R.color.error, false));
        b1.addView(Ui.kv(this, "عدد العمليات المسجلة", String.valueOf(opCount), false));
        content.addView(c1);

        LinearLayout actions = Ui.hbox(this);
        LinearLayout.LayoutParams p = Ui.weight(1); p.setMarginEnd(Ui.dp(this, 8));
        actions.addView(Ui.button(this, "تراجع عن آخر عملية", Ui.Style.OUTLINE, R.drawable.ic_undo, v -> undoLastFlow(this, repo, session.id, this::load)), p);
        actions.addView(Ui.button(this, "فحص سلامة البيانات", Ui.Style.OUTLINE, R.drawable.ic_check, v -> integrity()), Ui.weight(1));
        content.addView(actions, Ui.matchWrap(this, 10));

        MaterialCardView c2 = Ui.card(this);
        LinearLayout b2 = Ui.box(c2);
        b2.addView(Ui.text(this, "حسب المجموعة", 16, R.color.navy, true));
        for (Models.GroupStat g : gs) {
            b2.addView(Ui.divider(this));
            b2.addView(Ui.text(this, g.group.isEmpty() ? "(بدون مجموعة)" : g.group, 14, R.color.text, true));
            b2.addView(Ui.kv(this, "مجرود / الكل", g.counted + " / " + g.items, false));
            b2.addView(Ui.kv(this, "الكمية • القيمة", Num.qty(g.qty) + " • " + Num.money(g.value) + cur, false));
        }
        content.addView(c2, Ui.matchWrap(this, 12));

        MaterialCardView c3 = Ui.card(this);
        LinearLayout b3 = Ui.box(c3);
        b3.addView(Ui.text(this, "سجل العمليات (آخر " + ops.size() + ")", 16, R.color.navy, true));
        if (ops.isEmpty()) b3.addView(Ui.text(this, "لا توجد عمليات بعد.", 14, R.color.text_muted, false));
        for (Models.Op o : ops) {
            b3.addView(Ui.divider(this));
            b3.addView(Ui.text(this, describe(o), 13, o.undone ? R.color.text_muted : R.color.text, false));
        }
        content.addView(c3, Ui.matchWrap(this, 12));
    }

    static String typeLabel(String t) {
        switch (t) {
            case "ADD": return "إضافة كمية";
            case "CORRECT": return "تصحيح";
            case "UNDO": return "تراجع";
            default: return t;
        }
    }

    static String describe(Models.Op o) {
        String when = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(o.ts));
        StringBuilder b = new StringBuilder();
        b.append("#").append(o.id).append(" • ").append(typeLabel(o.type)).append(" • ").append(when);
        if (o.undone) b.append(" • (تم التراجع عنها)");
        b.append("\n").append(o.itemName == null ? "" : o.itemName).append(o.barcode.isEmpty() ? "" : " [" + o.barcode + "]");
        b.append("\nالسابقة ").append(Num.qty(o.prevQty));
        if ("ADD".equals(o.type)) b.append(" + المدخلة ").append(Num.qty(o.inputQty));
        b.append(" ← النهائية ").append(Num.qty(o.newQty));
        if (o.reason != null && !o.reason.isEmpty()) b.append("\nالسبب: ").append(o.reason);
        return b.toString();
    }

    /** Confirm + perform a safe undo of the last operation (writes an UNDO record; deletes nothing). */
    static void undoLastFlow(Activity a, Repository repo, long sid, Runnable after) {
        Bg.db(a, () -> repo.lastUndoable(sid), op -> {
            if (op == null) { Ui.info(a, "التراجع", "لا توجد عملية يمكن التراجع عنها."); return; }
            Ui.confirm(a, "التراجع عن آخر عملية", describe(op) + "\n\nستعود الكمية إلى " + Num.qty(op.prevQty)
                    + (op.prevCounted ? "" : " (لم يُجرد)") + ". يبقى السجل محفوظًا.", "تراجع", () ->
                    Bg.db(a, () -> repo.undo(op.id, UUID.randomUUID().toString()), r -> {
                        if (r.kind == Models.SaveResult.Kind.OK) android.widget.Toast.makeText(a, "تم التراجع", android.widget.Toast.LENGTH_SHORT).show();
                        else Ui.info(a, "التراجع", r.message);
                        after.run();
                    }, null));
        }, null);
    }

    void integrity() {
        long sid = session.id;
        Bg.db(this, () -> new int[]{repo.verifyLog(sid)}, r -> Ui.info(this, "فحص سلامة البيانات",
                r[0] == 0 ? "✓ جميع الكميات مطابقة لسجل العمليات." : "⚠ يوجد " + r[0] + " صنف لا تطابق كميته آخر عملية في السجل."), null);
    }
}
