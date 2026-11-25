package com.smartstock.ui;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import androidx.core.content.res.ResourcesCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.progressindicator.LinearProgressIndicator;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.smartstock.R;

/** Small programmatic UI kit so every screen shares one consistent look. */
public final class Ui {
    private Ui() {}

    public static int dp(Context c, float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics())); }

    public static int color(Context c, int res) { return ContextCompat.getColor(c, res); }

    public static Typeface bold(Context c) {
        Typeface t = ResourcesCompat.getFont(c, R.font.noto_arabic_bold);
        return t != null ? t : Typeface.DEFAULT_BOLD;
    }

    public static TextView text(Context c, CharSequence s, float sp, int colorRes, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color(c, colorRes));
        if (bold) t.setTypeface(bold(c));
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        t.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
        return t;
    }

    public static LinearLayout vbox(Context c, int padDp) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(c, padDp);
        l.setPadding(p, p, p, p);
        return l;
    }

    public static LinearLayout hbox(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static LinearLayout.LayoutParams lp(int w, int h) { return new LinearLayout.LayoutParams(w, h); }

    public static LinearLayout.LayoutParams weight(float w) { return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, w); }

    public static LinearLayout.LayoutParams matchWrap(Context c, int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(c, topDp);
        return p;
    }

    /** White rounded card with a vertical content box (returned via getTag()). */
    public static MaterialCardView card(Context c) {
        MaterialCardView card = new MaterialCardView(c);
        card.setRadius(dp(c, 16));
        card.setCardElevation(dp(c, 1));
        card.setCardBackgroundColor(color(c, R.color.card));
        card.setStrokeColor(color(c, R.color.divider));
        card.setStrokeWidth(dp(c, 1));
        LinearLayout box = vbox(c, 14);
        card.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        card.setTag(box);
        return card;
    }

    public static LinearLayout box(MaterialCardView card) { return (LinearLayout) card.getTag(); }

    public enum Style { PRIMARY, SUCCESS, OUTLINE, DANGER, GOLD, TEXT }

    public static MaterialButton button(Context c, String label, Style style, int icon, View.OnClickListener l) {
        MaterialButton b;
        if (style == Style.OUTLINE) b = new MaterialButton(c, null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        else if (style == Style.TEXT) b = new MaterialButton(c, null, com.google.android.material.R.attr.borderlessButtonStyle);
        else b = new MaterialButton(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setCornerRadius(dp(c, 12));
        b.setMinHeight(dp(c, 52));
        b.setInsetTop(dp(c, 3)); b.setInsetBottom(dp(c, 3));
        if (icon != 0) { b.setIconResource(icon); b.setIconPadding(dp(c, 8)); }
        switch (style) {
            case SUCCESS: tint(b, color(c, R.color.success), 0xFFFFFFFF); break;
            case DANGER: tint(b, color(c, R.color.error), 0xFFFFFFFF); break;
            case GOLD: tint(b, color(c, R.color.gold), color(c, R.color.navy)); break;
            case OUTLINE:
                b.setTextColor(color(c, R.color.navy));
                b.setIconTint(ColorStateList.valueOf(color(c, R.color.navy)));
                b.setStrokeColor(ColorStateList.valueOf(color(c, R.color.navy)));
                break;
            case TEXT: b.setTextColor(color(c, R.color.navy)); b.setIconTint(ColorStateList.valueOf(color(c, R.color.navy))); break;
            default: tint(b, color(c, R.color.navy), 0xFFFFFFFF);
        }
        if (l != null) b.setOnClickListener(l);
        return b;
    }

    static void tint(MaterialButton b, int bg, int fg) {
        b.setBackgroundTintList(ColorStateList.valueOf(bg));
        b.setTextColor(fg);
        b.setIconTint(ColorStateList.valueOf(fg));
    }

    public static View divider(Context c) {
        View v = new View(c);
        v.setBackgroundColor(color(c, R.color.divider));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(c, 1)));
        p.topMargin = dp(c, 8); p.bottomMargin = dp(c, 8);
        v.setLayoutParams(p);
        return v;
    }

    /** "label ........ value" row. */
    public static LinearLayout kv(Context c, String k, String v, boolean emphasize) {
        LinearLayout r = hbox(c);
        r.setPadding(0, dp(c, 3), 0, dp(c, 3));
        TextView a = text(c, k, 14, R.color.text_muted, false);
        TextView b = text(c, v, emphasize ? 17 : 15, emphasize ? R.color.navy : R.color.text, emphasize);
        b.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
        r.addView(a, weight(1));
        r.addView(b, weight(1.2f));
        return r;
    }

    public static GradientDrawable pill(Context c, int colorRes) {
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(c, 20));
        g.setColor(color(c, colorRes));
        return g;
    }

    public static TextView chip(Context c, String s, int bgRes, int fgRes) {
        TextView t = text(c, s, 12, fgRes, true);
        t.setBackground(pill(c, bgRes));
        t.setPadding(dp(c, 10), dp(c, 3), dp(c, 10), dp(c, 3));
        return t;
    }

    public static TextInputLayout field(Context c, String hint, String value, boolean numeric) {
        TextInputLayout til = new TextInputLayout(c, null, com.google.android.material.R.attr.textInputOutlinedStyle);
        til.setHint(hint);
        til.setBoxCornerRadii(dp(c, 12), dp(c, 12), dp(c, 12), dp(c, 12));
        TextInputEditText e = new TextInputEditText(til.getContext());
        
        e.setTextDirection(View.TEXT_DIRECTION_RTL);
        if (numeric) e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        if (value != null) e.setText(value);
        singleLineRtl(e);
        til.addView(e);
        return til;
    }

    /** Single-line without horizontal scrolling: avoids the RTL "text scrolled out of view" bug. Call after setInputType. */
    public static void singleLineRtl(EditText e) {
        e.setMaxLines(1);
        e.setHorizontallyScrolling(false);
        e.setImeOptions(e.getImeOptions() | android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
    }

    public static EditText edit(TextInputLayout til) { return til.getEditText(); }

    // ------------------------------------------------------------------ dialogs

    public static void info(Context c, String title, CharSequence msg) {
        new MaterialAlertDialogBuilder(c).setTitle(title).setMessage(msg).setPositiveButton("حسنًا", null).show();
    }

    public static void confirm(Context c, String title, CharSequence msg, String ok, Runnable onOk) {
        new MaterialAlertDialogBuilder(c).setTitle(title).setMessage(msg)
                .setPositiveButton(ok, (d, w) -> onOk.run())
                .setNegativeButton("إلغاء", null).show();
    }

    public static void error(Context c, Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        if (!containsArabic(m)) m = "حدث خطأ غير متوقع:\n" + m;
        if (c instanceof Activity && ((Activity) c).isFinishing()) return;
        new MaterialAlertDialogBuilder(c).setTitle("تعذر إكمال العملية").setMessage(m).setPositiveButton("حسنًا", null).show();
    }

    static boolean containsArabic(String s) {
        for (char ch : s.toCharArray()) if (ch >= '؀' && ch <= 'ۿ') return true;
        return false;
    }

    /** Non-cancelable progress dialog with determinate bar. */
    public static final class Progress {
        final AlertDialog dialog; final LinearProgressIndicator bar; final TextView label;
        Progress(AlertDialog d, LinearProgressIndicator b, TextView l) { dialog = d; bar = b; label = l; }
        public void set(String text, int done, int total) {
            label.setText(text);
            if (total > 0) { bar.setIndeterminate(false); bar.setMax(total); bar.setProgressCompat(done, true); }
        }
        public void dismiss() { try { dialog.dismiss(); } catch (Exception ignored) {} }
    }

    public static Progress progress(Context c, String text) {
        LinearLayout box = vbox(c, 20);
        TextView l = text(c, text, 15, R.color.text, false);
        LinearProgressIndicator bar = new LinearProgressIndicator(c);
        bar.setIndeterminate(true);
        bar.setTrackCornerRadius(dp(c, 4));
        box.addView(l);
        box.addView(bar, matchWrap(c, 14));
        AlertDialog d = new MaterialAlertDialogBuilder(c).setView(box).setCancelable(false).create();
        d.show();
        return new Progress(d, bar, l);
    }
}
