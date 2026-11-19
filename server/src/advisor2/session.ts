/**
 * CP06.2 Phase 5A — Conversation Context Manager.
 * Retention policy (documented, enforced here):
 *  - a session belongs to ONE staff account; another account can never read or continue it (a foreign id = new session)
 *  - it expires after SESSION_TTL_MS without activity and is deleted on the next request (no indefinite storage)
 *  - at most MAX_TURNS turns are kept (older ones are deleted); staff text is truncated to MAX_TEXT characters
 *  - no customer identity is stored; "زبونة جديدة" / reset starts from an empty context
 *  - the context is a convenience memory, never evidence
 */
import { AdvisorContext, type TAdvisorContext } from '../contracts.ts';
import type { DB } from '../db.ts';

export const SESSION_TTL_MS = 2 * 3600_000, MAX_TURNS = 30, MAX_TEXT = 600;
const iso = (ms: number) => new Date(ms).toISOString();
const newId = () => { const b = new Uint8Array(18); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };

export interface Session { id: string; user_id: number; ctx: TAdvisorContext; is_new: boolean }

export function purgeExpired(db: DB, nowMs = Date.now()) { return Number(db.prepare('DELETE FROM advisor_sessions WHERE expires_at < ?').run(iso(nowMs)).changes); }

export function openSession(db: DB, userId: number, id: string | undefined, nowMs = Date.now()): Session {
  purgeExpired(db, nowMs);
  if (id) {
    const r = db.prepare('SELECT id, user_id, context FROM advisor_sessions WHERE id = ?').get(id) as { id: string; user_id: number; context: string } | undefined;
    if (r && r.user_id === userId) return { id: r.id, user_id: userId, ctx: AdvisorContext.parse(JSON.parse(r.context)), is_new: false };
    // unknown, expired or ANOTHER staff member's session: never reused, a fresh one is started
  }
  const sid = newId();
  db.prepare('INSERT INTO advisor_sessions(id, user_id, context, created_at, last_active_at, expires_at) VALUES (?,?,?,?,?,?)').run(sid, userId, '{}', iso(nowMs), iso(nowMs), iso(nowMs + SESSION_TTL_MS));
  return { id: sid, user_id: userId, ctx: AdvisorContext.parse({}), is_new: true };
}

export function saveTurn(db: DB, s: Session, staffText: string, advisorSummary: string, ctx: TAdvisorContext, nowMs = Date.now()) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE advisor_sessions SET context = ?, last_active_at = ?, expires_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(AdvisorContext.parse(ctx)), iso(nowMs), iso(nowMs + SESSION_TTL_MS), s.id, s.user_id);
    const ins = db.prepare('INSERT INTO advisor_turns(session_id, role, text, created_at) VALUES (?,?,?,?)');
    ins.run(s.id, 'staff', staffText.slice(0, MAX_TEXT), iso(nowMs)); ins.run(s.id, 'advisor', advisorSummary.slice(0, MAX_TEXT), iso(nowMs));
    db.prepare('DELETE FROM advisor_turns WHERE session_id = ? AND id NOT IN (SELECT id FROM advisor_turns WHERE session_id = ? ORDER BY id DESC LIMIT ?)').run(s.id, s.id, MAX_TURNS);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function resetSession(db: DB, userId: number, id: string) { return Number(db.prepare('DELETE FROM advisor_sessions WHERE id = ? AND user_id = ?').run(id, userId).changes); }
export function turns(db: DB, userId: number, id: string) {
  const s = db.prepare('SELECT id FROM advisor_sessions WHERE id = ? AND user_id = ?').get(id, userId); if (!s) return null;
  return db.prepare('SELECT role, text, created_at FROM advisor_turns WHERE session_id = ? ORDER BY id').all(id);
}
