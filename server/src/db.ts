import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Rfq } from './scrape.js';

const DB_PATH = resolve(import.meta.dirname, '../data/rfq.db');
mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE');

db.exec(`
CREATE TABLE IF NOT EXISTS rfq (
  sol_no TEXT NOT NULL, sol_display TEXT, nsn TEXT NOT NULL, nsn13 TEXT, fsc TEXT,
  nomenclature TEXT, tech_docs TEXT, set_aside TEXT, status TEXT, pr_no TEXT NOT NULL DEFAULT '',
  qty INTEGER, issue_date TEXT, return_by TEXT, office_prefix TEXT,
  pdf_url TEXT, package_url TEXT, nsn_url TEXT, quote_url TEXT,
  first_seen_at TEXT, last_seen_at TEXT,
  PRIMARY KEY (sol_no, nsn, pr_no)
);
CREATE INDEX IF NOT EXISTS ix_rfq_return_by ON rfq(return_by);
`);
// additive migrations (a column that already exists just throws, which is fine)
for (const ddl of [
  'ALTER TABLE rfq ADD COLUMN fast_award INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE rfq ADD COLUMN source TEXT NOT NULL DEFAULT 'site'", // 'site' = scraped list, 'bulk' = official bulk file
  'ALTER TABLE rfq ADD COLUMN post_date TEXT', // from the bulk file name; the site's "Issued" date can differ by a day
  "ALTER TABLE ingest_run ADD COLUMN mode TEXT NOT NULL DEFAULT 'site'",
]) {
  try { db.exec(ddl); } catch { /* column exists */ }
}
db.exec(`
CREATE INDEX IF NOT EXISTS ix_rfq_fsc ON rfq(fsc);
CREATE INDEX IF NOT EXISTS ix_rfq_nsn13 ON rfq(nsn13);
CREATE INDEX IF NOT EXISTS ix_rfq_issue ON rfq(issue_date);
CREATE TABLE IF NOT EXISTS ingest_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, started_at TEXT, finished_at TEXT,
  pages INTEGER, rows INTEGER, expected INTEGER, status TEXT, error TEXT
);
`);

const upsertStmt = db.prepare(`
INSERT INTO rfq (sol_no, sol_display, nsn, nsn13, fsc, nomenclature, tech_docs, set_aside, status, pr_no, qty,
  issue_date, return_by, office_prefix, pdf_url, package_url, nsn_url, quote_url, fast_award, first_seen_at, last_seen_at)
VALUES (@sol_no, @sol_display, @nsn, @nsn13, @fsc, @nomenclature, @tech_docs, @set_aside, @status, @pr_no, @qty,
  @issue_date, @return_by, @office_prefix, @pdf_url, @package_url, @nsn_url, @quote_url, @fast_award, @now, @now)
ON CONFLICT(sol_no, nsn, pr_no) DO UPDATE SET
  fast_award=excluded.fast_award, status=excluded.status, return_by=excluded.return_by, qty=excluded.qty, tech_docs=excluded.tech_docs,
  set_aside=excluded.set_aside, nomenclature=excluded.nomenclature, issue_date=excluded.issue_date,
  source='site', last_seen_at=excluded.last_seen_at`);

/** Scraped rows are authoritative: they overwrite whatever a bulk file said. */
export const upsertRows = db.transaction((rows: Rfq[]) => {
  const now = new Date().toISOString();
  for (const r of rows) upsertStmt.run({ ...r, now });
});

// Bulk rows only ever ADD rows (and note a post date); they never overwrite scraped data.
const bulkStmt = db.prepare(`
INSERT INTO rfq (sol_no, sol_display, nsn, nsn13, fsc, nomenclature, tech_docs, set_aside, status, pr_no, qty,
  issue_date, return_by, office_prefix, pdf_url, package_url, nsn_url, quote_url, fast_award, source, post_date,
  first_seen_at, last_seen_at)
VALUES (@sol_no, @sol_display, @nsn, @nsn13, @fsc, @nomenclature, @tech_docs, @set_aside, @status, @pr_no, @qty,
  @issue_date, @return_by, @office_prefix, @pdf_url, @package_url, @nsn_url, @quote_url, @fast_award, 'bulk', @post_date,
  @now, @now)
ON CONFLICT(sol_no, nsn, pr_no) DO UPDATE SET post_date = COALESCE(post_date, excluded.post_date)`);

const countStmt = db.prepare('SELECT COUNT(*) c FROM rfq');

/** Returns how many rows were new (the rest were already known and left untouched). */
export const insertBulkRows = db.transaction((rows: (Rfq & { post_date: string })[]) => {
  const now = new Date().toISOString();
  const before = (countStmt.get() as { c: number }).c;
  for (const r of rows) bulkStmt.run({ ...r, now });
  return (countStmt.get() as { c: number }).c - before;
});

// ---- approved sources (from the bulk files) ----
db.exec(`
CREATE TABLE IF NOT EXISTS approved_source (
  nsn13 TEXT NOT NULL, cage TEXT NOT NULL, part_no TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
  post_date TEXT, PRIMARY KEY (nsn13, cage, part_no)
);
CREATE INDEX IF NOT EXISTS ix_as_cage ON approved_source(cage);
`);

const sourceStmt = db.prepare(`
INSERT INTO approved_source (nsn13, cage, part_no, company, post_date) VALUES (@nsn13, @cage, @part_no, @company, @post_date)
ON CONFLICT(nsn13, cage, part_no) DO UPDATE SET company = CASE WHEN excluded.company <> '' THEN excluded.company ELSE company END`);
const sourceCount = db.prepare('SELECT COUNT(*) c FROM approved_source');

/** Returns how many (NSN, CAGE, part) combinations were new. */
export const insertApprovedSources = db.transaction(
  (rows: { nsn13: string; cage: string; part_no: string; company: string }[], post_date: string) => {
    const before = (sourceCount.get() as { c: number }).c;
    for (const r of rows) sourceStmt.run({ ...r, post_date });
    return (sourceCount.get() as { c: number }).c - before;
  },
);
