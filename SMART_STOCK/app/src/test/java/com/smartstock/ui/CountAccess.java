package com.smartstock.ui;
import android.view.View;
import android.widget.EditText;
import java.util.ArrayList;
import java.util.List;
public final class CountAccess {
    private CountAccess() {}
    public static EditText code(CountActivity a) { return a.code; }
    public static List<EditText> edits(View root) {
        List<EditText> out = new ArrayList<>();
        for (View v : UiFlowTest.all(root)) if (v instanceof EditText) out.add((EditText) v);
        return out;
    }
}
