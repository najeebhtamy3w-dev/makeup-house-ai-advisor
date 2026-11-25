package com.smartstock.ui;
import com.smartstock.core.Field;
import com.smartstock.data.Models;
import java.util.List;
public final class NewItemDialogAccess {
    private NewItemDialogAccess() {}
    public static List<Field> ordered(Models.Session s) { return NewItemDialog.ordered(s); }
}
