package com.smartstock.core;

/** Logical item fields recognised in the inventory sheet. */
public enum Field {
    GROUP("اسم المجموعة", false),
    NAME("اسم الصنف", true),
    UNIT("الوحدة", false),
    PACK("العبوة / حبة", false),
    BARCODE("الباركود", true),
    QTY("الكمية", true),
    COST("التكلفة", true),
    TOTAL("إجمالي تكلفة الصف", false);

    public final String label;
    public final boolean required;

    Field(String label, boolean required) { this.label = label; this.required = required; }
}
