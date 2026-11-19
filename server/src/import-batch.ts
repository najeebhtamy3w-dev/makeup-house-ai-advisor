/**
 * CP06.2 Phase 5 — resumable import batches.
 * - Each file gets a batch (fingerprint = file content). New rows are inserted in chunks of CHUNK rows, each chunk in its own
 *   small transaction, and the batch records its progress. If the process dies half-way, uploading the same file again
 *   resumes the SAME batch: rows already saved are recognised as duplicates (barcode / name+brand+size+variant) and skipped.
 * - Rows with only a valid barcode are saved as `import_draft` (waiting for identification; never recommended).
 * - Existing records are never overwritten; only EMPTY brand/size of non-verified records are completed (CP05 rule, unchanged).
 * - Rolling a batch back removes only its DRAFTS that nobody has edited since (version = 1). Nothing else is ever deleted.
 */
import type { DB } from './db.ts';
import { now, audit } from './db.ts';
import type { ImportRow } from './importer.ts';
import { enqueue, queryKeyFor, cancel, fp } from './queue.ts';

export const CHUNK = 500;
export interface Completion { id: number; line: number; brand?: string; size?: string; product_type?: string }
export interface CommitInput {
  filename: string; fileBytes: Uint8Array; fresh: ImportRow[]; completions: Completion[]; invalid: { line: number; reason: string }[]; total: number;
  userId: number; enrichProviders: string[]; ignoredColumns: string[];
  /** test hook: throw after N chunks to simulate a crash (never set by the HTTP route) */
  failAfterChunks?: number;
}

export const fileFingerprint = (b: Uint8Array) => { let s = ''; const step = Math.max(1, Math.floor(b.length / 200_000)); for (let i = 0; i < b.length; i += step) s += String.fromCharCode(b[i]!); return fp(b.length, s); };

export function commitBatch(db: DB, x: CommitInput) {
  const t = now(); const fingerprint = fileFingerprint(x.fileBytes);
  const report = JSON.stringify({ invalid: x.invalid, ignored_columns: x.ignoredColumns });
  // resume an unfinished batch of the SAME file, otherwise start a new one
  const prev = db.prepare("SELECT id, state FROM import_batches WHERE fingerprint = ? AND state IN ('running','failed','paused') ORDER BY id DESC LIMIT 1").get(fingerprint) as { id: number; state: string } | undefined;
  const batchId = prev ? prev.id : Number(db.prepare('INSERT INTO import_batches(filename, fingerprint, total_rows, processed_rows, state, report, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(x.filename, fingerprint, x.total, 0, 'running', report, x.userId, t).lastInsertRowid);
  if (prev) db.prepare("UPDATE import_batches SET state='running', report=? WHERE id=?").run(report, batchId);

  const ins = db.prepare(`INSERT INTO products(barcode,name,brand,category,size,availability,availability_updated_at,availability_updated_by,verification,created_by,created_at,updated_at,product_type,classification_status,classification_raw,name_ar,name_en,manufacturer,variant,record_status,import_batch_id)
    VALUES (?,?,?,?,?,?,?,?, 'review',?,?,?,?,?,?,?,?,?,?,?,?)`);
  const created: { id: number; row: ImportRow }[] = []; let chunks = 0;
  try {
    for (let i = 0; i < x.fresh.length; i += CHUNK) {
      if (x.failAfterChunks != null && chunks >= x.failAfterChunks) throw new Error('simulated crash');
      const part = x.fresh.slice(i, i + CHUNK);
      db.exec('BEGIN');
      try {
        for (const r of part) {
          const res = ins.run(r.barcode || null, r.name, r.brand, r.category, r.size, r.availability ?? 'unknown', r.availability ? t : null, r.availability ? x.userId : null, x.userId, t, t,
            r.product_type, r.classification_status, r.classification_raw, r.name_ar ?? '', r.name_en ?? '', r.manufacturer ?? '', r.variant ?? '', r.draft ? 'import_draft' : 'active', batchId);
          created.push({ id: Number(res.lastInsertRowid), row: r });
        }
        db.prepare('UPDATE import_batches SET processed_rows = processed_rows + ? WHERE id = ?').run(part.length, batchId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      chunks++;
    }
    db.exec('BEGIN');
    try {
      // completing EMPTY fields only (guarded again in SQL), and the record goes (back) to review — CP05 rule, unchanged
      const upd = db.prepare("UPDATE products SET brand = CASE WHEN brand = '' THEN ? ELSE brand END, size = CASE WHEN size = '' THEN ? ELSE size END, verification = CASE WHEN ? THEN 'review' ELSE verification END, updated_at = ?, version = version + 1 WHERE id = ? AND verification <> 'verified'");
      const updType = db.prepare("UPDATE products SET product_type = ?, classification_status = 'confirmed' WHERE id = ? AND product_type = ''");
      for (const c of x.completions) { upd.run(c.brand ?? '', c.size ?? '', c.brand || c.size ? 1 : 0, t, c.id); if (c.product_type) updType.run(c.product_type, c.id); }
      // enrichment jobs for the new records (barcode or English/brand name); the queue runs later, the import never waits for the internet
      for (const { id, row } of created) for (const p of x.enrichProviders) if (row.barcode || row.name_en || row.brand) enqueue(db, id, p, queryKeyFor({ barcode: row.barcode || null, name: row.name, name_en: row.name_en, brand: row.brand }), { batchId });
      db.prepare("UPDATE import_batches SET state='done', finished_at=? WHERE id=?").run(now(), batchId);
      db.prepare('INSERT INTO import_jobs(filename,status,total,added,duplicates,invalid,ignored_columns,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(x.filename, 'committed', x.total, created.length, x.total - created.length - x.invalid.length, x.invalid.length, x.ignoredColumns.join(' | '), x.userId, t);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } catch (e) {
    db.prepare("UPDATE import_batches SET state='failed' WHERE id=?").run(batchId);
    throw Object.assign(e as Error, { batchId, savedSoFar: created.length });
  }
  audit(db, x.userId, 'import', 'import_batch', batchId, `added=${created.length} drafts=${created.filter((c) => c.row.draft).length} resumed=${!!prev}`);
  return { batch_id: batchId, resumed: !!prev, added: created.length, drafts: created.filter((c) => c.row.draft).length, enrich_queued: created.length && x.enrichProviders.length ? created.filter((c) => c.row.barcode || c.row.name_en || c.row.brand).length : 0 };
}

/** Undo a batch's DRAFTS that nobody touched since import (version 1). Named/active records and edited drafts stay. */
export function rollbackDrafts(db: DB, batchId: number, userId: number) {
  const b = db.prepare('SELECT id, state FROM import_batches WHERE id = ?').get(batchId) as { id: number; state: string } | undefined;
  if (!b) return null;
  db.exec('BEGIN');
  try {
    const removed = Number(db.prepare("DELETE FROM products WHERE import_batch_id = ? AND record_status = 'import_draft' AND version = 1").run(batchId).changes);
    const kept = (db.prepare("SELECT COUNT(*) n FROM products WHERE import_batch_id = ? AND record_status = 'import_draft'").get(batchId) as { n: number }).n;
    cancel(db, { batchId });
    db.prepare("UPDATE import_batches SET state='rolled_back', finished_at=? WHERE id=?").run(now(), batchId);
    db.exec('COMMIT');
    audit(db, userId, 'import_rollback', 'import_batch', batchId, `drafts_removed=${removed} edited_drafts_kept=${kept}`);
    return { removed, kept_edited_drafts: kept };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** downloadable error report (line + reason only; never the cell values) */
export function batchReportCsv(db: DB, batchId: number): string | null {
  const b = db.prepare('SELECT report, filename, total_rows, processed_rows, state FROM import_batches WHERE id = ?').get(batchId) as { report: string; filename: string; total_rows: number; processed_rows: number; state: string } | undefined;
  if (!b) return null;
  const r = JSON.parse(b.report || '{}') as { invalid?: { line: number; reason: string }[] };
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ['﻿line,reason', ...(r.invalid ?? []).map((x) => `${x.line},${esc(x.reason)}`)].join('\n');
}
