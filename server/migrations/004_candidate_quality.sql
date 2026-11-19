-- CP05: data-quality caveat from the source connector (e.g. "translated list, not standard INCI"). ADDITIVE, non-destructive.
-- Kept separate from conflict_note, which markConflicts() recomputes on every lookup.
ALTER TABLE enrichment_candidates ADD COLUMN quality_note TEXT NOT NULL DEFAULT '';
