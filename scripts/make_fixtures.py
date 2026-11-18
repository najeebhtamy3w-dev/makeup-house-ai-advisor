"""Generates tests/fixtures/*. Barcodes are TEXT cells; price/qty columns are deliberately present (must be ignored)."""
import openpyxl, sys, os
out = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures'); os.makedirs(out, exist_ok=True)
def ck(body):
    s = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return body + str((10 - s % 10) % 10)
rows = [
  ['barcode','name','brand','category','size','price','quantity','availability'],
  [ck('629104150021'),'مرطب خالٍ من العطر','CeraTest','العناية بالبشرة','50 مل','1999','12','متوفر'],
  [ck('0123456'),'بلسم تجريبي','HairTest','العناية بالشعر','200 مل','777','3',''],   # EAN-8 with leading zero
  [ck('629104150021'),'نسخة مكررة داخل الملف','X','أخرى','','1','1',''],
  ['12345','باركود غير صالح','X','أخرى','','1','1',''],
  [ck('629104150038'),'واقي شمس تجريبي','SunTest','واقيات الشمس','50 مل','500','9','غير مؤكد'],
]
wb = openpyxl.Workbook(); ws = wb.active
for r in rows:
    ws.append(r)
for row in ws.iter_rows(min_row=2, max_col=1):
    for c in row: c.number_format = '@'; c.data_type = 's'
wb.save(os.path.join(out, 'import.xlsx'))
import csv
with open(os.path.join(out, 'import.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    csv.writer(f).writerows(rows)
print('ok', ck('629104150021'), ck('0123456'), ck('629104150038'))
