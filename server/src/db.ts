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
try { db.exec('ALTER TABLE rfq ADD COLUMN fast_award INTEGER NOT NULL DEFAULT 0'); } catch { /* column exists */ }
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
  set_aside=excluded.set_aside, last_seen_at=excluded.last_seen_at`);

export const upsertRows = db.transaction((rows: Rfq[]) => {
  const now = new Date().toISOString();
  for (const r of rows) upsertStmt.run({ ...r, now });
});
