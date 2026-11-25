#!/usr/bin/env python3
"""Generates SYNTHETIC Excel fixtures for SMART STOCK tests (no real business data).
Formula cells are recalculated with LibreOffice headless so that cached values exist,
exactly like a workbook saved by Excel."""
import os, sys, shutil, subprocess, tempfile, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out, exist_ok=True)
HDR = ["اسم المجموعة", "اسم الصنف", "الوحدة", "العبوة", "الباركود", "الكمية", "التكلفة", "تاريخ الانتهاء", None, "ملاحظة"]
navy = PatternFill("solid", fgColor="0E1A24")

def recalc(path):
    """Round-trip through LibreOffice so formulas get cached values (like Excel)."""
    d = tempfile.mkdtemp()
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", d, path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    shutil.move(os.path.join(d, os.path.basename(path)), path)

def header(ws, cols):
    ws.append(cols)
    for c in ws[1]:
        c.font = Font(color="FFFFFF", bold=True); c.fill = navy

# 1) multi-sheet, approved sheet name, 10 items, the tricky cases
wb = Workbook(); src = wb.active; src.title = "ورقة1"
src.append(["اسم المجموعة", "اسم الصنف", "التكلفة قبل التحويل", "معامل التحويل"])
src.append(["عطور", "مصدر", 45.5, 0.28])
wb.create_sheet("تعليمات_الدمج").append(["سطر تعليمات"])
ws = wb.create_sheet("تصدير_بلاس"); header(ws, HDR)
rows = [
    ["عدسات", "عدسات فريش ليدي", "قطعة", "حبة", "4600", 0, 25.50, datetime.date(2027, 8, 1), None, "ملاحظة 1"],
    ["عدسات", "عدسات بالصفر البادئ", "قطعة", "حبة", "0012345", 0, 0.28, None, None, None],
    ["مكياج", "أحمر شفاه طويل الاسم جدا جدا للتجربة على الالتفاف داخل جدول الطباعة A4 الأفقي", "قطعة", "12 حبة", "6281000000011", 0, 12.125, None, None, None],
    ["مكياج", "أحمر شفاه — دفعة ثانية", "قطعة", "12 حبة", "6281000000011", 0, 13.0, datetime.date(2028, 1, 1), None, "باركود مكرر"],
    ["عناية", "كريم بدون باركود", "علبة", "1", None, 0, 7.75, None, None, None],
    None,  # empty row inside data
    ["عناية", "صنف تكلفته من معادلة", "علبة", "1", "7000000000001", 0, "=ورقة1!C2*ورقة1!D2", None, None, None],
    ["عطور", "عطر", "زجاجة", "1", "7000000000002", 0, 100, None, None, None],
    ["عطور", "عطر صغير", "زجاجة", "1", "7000000000003", 0, 0.1, None, None, None],
    ["عطور", "عطر كبير", "زجاجة", "1", "7000000000004", 0, 1234.5678, None, None, None],
]
for r in rows:
    ws.append(r if r else [None] * 10)
for i in range(60):  # prepared, formatted but empty rows (must NOT become items)
    r = ws.max_row + 1
    ws.cell(row=r, column=6).number_format = "0"; ws.cell(row=r, column=7).number_format = "#,##0.00"
ws.cell(row=2, column=10).value = "ملاحظة 1"
p = os.path.join(out, "f10_multisheet.xlsx"); wb.save(p); recalc(p)

# 2) single sheet, any name, different order, extra columns, existing total column WITH formulas
wb = Workbook(); ws = wb.active; ws.title = "Sheet1"
cols = ["ملاحظات", "الباركود", "تكلفة الصنف", "اسم الصنف", "العدد", "إجمالي التكلفة", "العبوة / حبة", "اسم المجموعة", "الوحدة", "عمود إضافي"]
header(ws, cols)
for i in range(1, 21):
    r = i + 1
    ws.append([f"م{i}", f"{8000000000000 + i}", round(i * 1.25, 2), f"صنف رقم {i}", 0, f"=E{r}*C{r}", "حبة", "مجموعة " + str(i % 3), "قطعة", f"x{i}"])
p = os.path.join(out, "f_single_reordered.xlsx"); wb.save(p); recalc(p)

# 3) invalid data
wb = Workbook(); ws = wb.active; ws.title = "تصدير بلاس"
header(ws, HDR[:7])
ws.append(["أ", "تكلفة نصية", "ق", "1", "9000000000001", 0, "abc"])
ws.append(["أ", "تكلفة سالبة", "ق", "1", "9000000000002", 0, -5])
ws.append(["أ", "تكلفة فارغة", "ق", "1", "9000000000003", 0, None])
ws.append(["أ", "كمية نصية", "ق", "1", "9000000000004", "xx", 3])
ws.append(["أ", "كمية سابقة", "ق", "1", "9000000000005", 7, 3])
ws.append(["أ", None, "ق", "1", None, 0, 3])          # incomplete row
ws.append(["أ", "صالح", "ق", "1", "9000000000006", 0, 3])
ws.append(["أ", "خطأ معادلة", "ق", "1", "9000000000007", 0, "=1/0"])
p = os.path.join(out, "f_invalid.xlsx"); wb.save(p); recalc(p)

# 4) numeric barcodes with zero-padding number format (leading zeros only in format)
wb = Workbook(); ws = wb.active; ws.title = "تصدير_بلاس"
header(ws, HDR[:7])
ws.append(["أ", "رقمي مبطن", "ق", "1", 12345678, 0, 2.5])
ws.cell(row=2, column=5).number_format = "0000000000000"
ws.append(["أ", "رقمي عادي", "ق", "1", 6281234567890, 0, 2.5])
p = os.path.join(out, "f_numeric_barcode.xlsx"); wb.save(p)

# 5) ambiguous header (two cost-like columns) -> manual mapping required
wb = Workbook(); ws = wb.active; ws.title = "تصدير_بلاس"
header(ws, ["اسم الصنف", "الباركود", "الكمية", "التكلفة", "تكلفة الصنف", "التكلفة قبل التحويل"])
ws.append(["صنف", "1", 0, 1, 2, 3])
p = os.path.join(out, "f_ambiguous.xlsx"); wb.save(p)
print("fixtures written to", out)
