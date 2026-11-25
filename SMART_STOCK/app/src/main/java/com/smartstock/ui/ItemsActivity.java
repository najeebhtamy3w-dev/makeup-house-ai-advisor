package com.smartstock.ui;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import com.smartstock.R;
import com.smartstock.core.Num;
import com.smartstock.data.Models;

import java.util.ArrayList;
import java.util.List;

/** Item list with search, filters, group and sort. Paged (RecyclerView + LIMIT/OFFSET) for 50k items. */
public class ItemsActivity extends BaseActivity {
    static final int PAGE = 150;

    Models.Session session;
    final List<Models.Item> items = new ArrayList<>();
    Adapter adapter;
    TextView countLabel;
    EditText search;
    Models.Filter filter = Models.Filter.ALL;
    Models.Sort sort = Models.Sort.SEQ;
    String group;
    List<String> groups = new ArrayList<>();
    int total, generation;
    boolean loading, end;
    Spinner groupSpinner;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        toolbar = toolbar("كشف الأصناف", true);
        root.addView(toolbar);
        LinearLayout top = Ui.vbox(this, 10);
        search = new EditText(this);
        search.setHint("بحث بالاسم أو الباركود");
        
        Ui.singleLineRtl(search);
        search.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_search, 0, 0, 0);
        search.setCompoundDrawablePadding(Ui.dp(this, 8));
        top.addView(search);
        ChipGroup chips = new ChipGroup(this);
        chips.setSingleSelection(true);
        chips.setSelectionRequired(true);
        String[] labels = {"الكل", "المجرودة", "غير المجرودة", "كمية صفر", "كمية موجبة", "المضافة"};
        Models.Filter[] fs = Models.Filter.values();
        for (int i = 0; i < labels.length; i++) {
            Chip ch = new Chip(this);
            ch.setText(labels[i]);
            ch.setId(View.generateViewId());
            ch.setCheckable(true);
            final Models.Filter f = fs[i];
            ch.setOnCheckedChangeListener((v, on) -> { if (on) { filter = f; reload(); } });
            chips.addView(ch);
            if (i == 0) ch.setChecked(true);
        }
        android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(this);
        hs.addView(chips);
        top.addView(hs);
        LinearLayout sel = Ui.hbox(this);
        groupSpinner = new Spinner(this);
        Spinner sortSpinner = new Spinner(this);
        sortSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"ترتيب الملف", "حسب الاسم", "حسب الكمية", "حسب التكلفة", "حسب الإجمالي"}));
        sortSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { Models.Sort s = Models.Sort.values()[pos]; if (s != sort) { sort = s; reload(); } }
            public void onNothingSelected(AdapterView<?> p) {}
        });
        sel.addView(groupSpinner, Ui.weight(1));
        sel.addView(sortSpinner, Ui.weight(1));
        top.addView(sel);
        countLabel = Ui.text(this, "", 13, R.color.text_muted, false);
        top.addView(countLabel);
        root.addView(top);

        RecyclerView rv = new RecyclerView(this);
        LinearLayoutManager lm = new LinearLayoutManager(this);
        rv.setLayoutManager(lm);
        adapter = new Adapter();
        rv.setAdapter(adapter);
        rv.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override public void onScrolled(@NonNull RecyclerView r, int dx, int dy) {
                if (!loading && !end && lm.findLastVisibleItemPosition() > items.size() - 30) loadMore();
            }
        });
        root.addView(rv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        applyInsets(root);

        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int d) {}
            public void onTextChanged(CharSequence s, int a, int c, int d) {}
            public void afterTextChanged(Editable e) { search.removeCallbacks(debounce); search.postDelayed(debounce, 250); }
        });

        long sid = activeSessionId();
        Bg.db(this, () -> new Object[]{repo.session(sid), repo.groups(sid)}, r -> {
            session = (Models.Session) r[0];
            if (session == null) { finish(); return; }
            @SuppressWarnings("unchecked") List<String> g = (List<String>) r[1];
            groups = g;
            List<String> gl = new ArrayList<>();
            gl.add("كل المجموعات");
            for (String x : g) gl.add(x.isEmpty() ? "(بدون مجموعة)" : x);
            groupSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, gl));
            groupSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                    String ng = pos == 0 ? null : groups.get(pos - 1);
                    if (ng == null ? group != null : !ng.equals(group)) { group = ng; reload(); }
                }
                public void onNothingSelected(AdapterView<?> p) {}
            });
            reload();
        }, null);
    }

    final Runnable debounce = this::reload;

    @Override protected void onRestart() {
        super.onRestart();
        reload(); // quantities may have changed
    }

    void reload() {
        if (session == null) return;
        generation++;
        items.clear();
        adapter.notifyDataSetChanged();
        end = false;
        loading = false;
        long sid = session.id;
        String q = search.getText().toString();
        Models.Filter f = filter; String g = group;
        int gen = generation;
        Bg.db(this, () -> repo.count(sid, q, f, g), n -> { if (gen == generation) { total = n; countLabel.setText("عدد النتائج: " + n); } }, null);
        loadMore();
    }

    void loadMore() {
        if (session == null || loading || end) return;
        loading = true;
        long sid = session.id;
        String q = search.getText().toString();
        Models.Filter f = filter; String g = group; Models.Sort s = sort;
        int off = items.size(), gen = generation;
        Bg.db(this, () -> repo.query(sid, q, f, g, s, PAGE, off), page -> {
            if (gen != generation) return;
            loading = false;
            if (page.size() < PAGE) end = true;
            int start = items.size();
            items.addAll(page);
            adapter.notifyItemRangeInserted(start, page.size());
        }, e -> { loading = false; Ui.error(this, e); });
    }

    final class Adapter extends RecyclerView.Adapter<Holder> {
        @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup p, int t) { return new Holder(); }
        @Override public void onBindViewHolder(@NonNull Holder h, int pos) { h.bind(items.get(pos)); }
        @Override public int getItemCount() { return items.size(); }
    }

    final class Holder extends RecyclerView.ViewHolder {
        final View stripe; final TextView name, sub, qty, total;
        Models.Item it;
        Holder() {
            super(new LinearLayout(ItemsActivity.this));
            LinearLayout row = (LinearLayout) itemView;
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            row.setBackgroundColor(Ui.color(ItemsActivity.this, R.color.card));
            row.setPadding(0, 0, Ui.dp(ItemsActivity.this, 12), 0);
            stripe = new View(ItemsActivity.this);
            row.addView(stripe, new LinearLayout.LayoutParams(Ui.dp(ItemsActivity.this, 5), ViewGroup.LayoutParams.MATCH_PARENT));
            LinearLayout mid = Ui.vbox(ItemsActivity.this, 10);
            name = Ui.text(ItemsActivity.this, "", 15, R.color.text, true);
            sub = Ui.text(ItemsActivity.this, "", 12, R.color.text_muted, false);
            mid.addView(name); mid.addView(sub);
            row.addView(mid, Ui.weight(1));
            LinearLayout right = Ui.vbox(ItemsActivity.this, 10);
            qty = Ui.text(ItemsActivity.this, "", 17, R.color.navy, true);
            total = Ui.text(ItemsActivity.this, "", 12, R.color.success, false);
            qty.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
            total.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
            right.addView(qty); right.addView(total);
            row.addView(right, new LinearLayout.LayoutParams(Ui.dp(ItemsActivity.this, 120), ViewGroup.LayoutParams.WRAP_CONTENT));
            View line = new View(ItemsActivity.this);
            line.setBackgroundColor(Ui.color(ItemsActivity.this, R.color.divider));
            row.setOnClickListener(v -> { if (it != null) startActivity(new Intent(ItemsActivity.this, CountActivity.class).putExtra(CountActivity.EXTRA_ITEM, it.id)); });
        }
        void bind(Models.Item i) {
            it = i;
            name.setText(i.added ? "＋ " + i.name + " (مُضاف)" : i.name);
            sub.setText((i.barcode.isEmpty() ? "بدون باركود" : i.barcode) + "  •  " + (i.pack.isEmpty() ? "—" : i.pack) + (i.group.isEmpty() ? "" : "  •  " + i.group));
            int st = i.state();
            stripe.setBackgroundColor(Ui.color(ItemsActivity.this, st == 0 ? R.color.divider : st == 1 ? R.color.gold : R.color.success));
            qty.setText(st == 0 ? "لم يُجرد" : Num.qty(i.qty));
            qty.setTextColor(Ui.color(ItemsActivity.this, st == 0 ? R.color.text_muted : R.color.navy));
            total.setText(i.cost == null ? "تكلفة غير صالحة" : Num.money(i.total()));
            total.setTextColor(Ui.color(ItemsActivity.this, i.cost == null ? R.color.error : R.color.success));
            ((ViewGroup.MarginLayoutParams) itemView.getLayoutParams()).bottomMargin = Ui.dp(ItemsActivity.this, 1);
        }
    }
}
