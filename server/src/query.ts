import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db.js';

/** Official DLA FSC titles (from DIBBS Acquisition Downloads), keyed by 4-digit class. */
const FSC_NAMES: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../data/fsc.json'), 'utf8'),
);

export interface RfqQuery {
  q?: string;
  fsc?: string; // comma list
  setAside?: string; // comma list (raw DIBBS labels)
  office?: string; // comma list of solicitation prefixes
  techDocs?: 'yes' | 'no';
  dueWithinDays?: number;
  qtyMin?: number;
  qtyMax?: number;
  includePast?: boolean;
  fastAward?: boolean;
  sort?: 'due' | 'issued' | 'qty' | 'nsn';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** Smart search: pasted NSN / solicitation # match precisely, anything else is AND-ed word search. */
function searchClause(q: string, where: string[], args: unknown[]) {
  const t = q.trim();
  if (!t) return;
  const digits = t.replace(/[\s-]/g, '');
  if (/^\d{4,13}$/.test(digits) && /^[\d\s-]+$/.test(t)) {
    where.push('nsn13 LIKE ?');
    args.push(digits + '%'); // full NSN = exact, shorter = FSC / prefix browse
    return;
  }
  if (/^[A-Za-z0-9]{6}-?\d{2}-?[A-Za-z]-?\d{4}$/.test(t)) {
    where.push('sol_no = ?');
    args.push(t.replace(/-/g, '').toUpperCase());
    return;
  }
  for (const term of t.split(/\s+/)) {
    where.push(`(nomenclature LIKE ? ESCAPE '\\' OR sol_no LIKE ? ESCAPE '\\' OR nsn LIKE ? ESCAPE '\\' OR pr_no LIKE ? ESCAPE '\\')`);
    const p = like(term.replace(/-/g, ''));
    args.push(like(term), p, like(term), p);
  }
}

function build(p: RfqQuery) {
  const where: string[] = [];
  const args: unknown[] = [];
  const today = todayET();
  searchClause(p.q ?? '', where, args);
  const fsc = list(p.fsc);
  if (fsc.length) { where.push(`fsc IN (${fsc.map(() => '?').join(',')})`); args.push(...fsc); }
  const sa = list(p.setAside);
  if (sa.length) { where.push(`set_aside IN (${sa.map(() => '?').join(',')})`); args.push(...sa); }
  const off = list(p.office);
  if (off.length) { where.push(`office_prefix IN (${off.map(() => '?').join(',')})`); args.push(...off); }
  if (p.fastAward) where.push('fast_award = 1');
  if (p.techDocs === 'yes') where.push(`tech_docs <> 'None' AND tech_docs <> ''`);
  if (p.techDocs === 'no') where.push(`tech_docs = 'None'`); // bulk rows have no tech-docs info (''), so they match neither yes nor no
  if (p.qtyMin != null) { where.push('qty >= ?'); args.push(p.qtyMin); }
  if (p.qtyMax != null) { where.push('qty <= ?'); args.push(p.qtyMax); }
  if (!p.includePast) { where.push('return_by >= ?'); args.push(today); where.push(`status IN ('Open', '')`); }
  if (p.dueWithinDays != null) { where.push('return_by <= ?'); args.push(addDays(today, p.dueWithinDays)); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args, today };
}

const SORTS: Record<string, string> = {
  due: 'return_by', issued: "COALESCE(NULLIF(issue_date, ''), post_date)", qty: 'qty', nsn: 'nsn13',
};

export function queryRfqs(p: RfqQuery) {
  const { sql, args, today } = build(p);
  const pageSize = Math.min(Math.max(p.pageSize ?? 50, 1), 200);
  const page = Math.max(p.page ?? 1, 1);
  const col = SORTS[p.sort ?? 'due'] ?? 'return_by';
  const dir = p.dir === 'desc' ? 'DESC' : 'ASC';
  const total = (db.prepare(`SELECT COUNT(*) c FROM rfq ${sql}`).get(...args) as { c: number }).c;
  const items = db
    .prepare(`SELECT * FROM rfq ${sql} ORDER BY ${col} ${dir}, sol_no ASC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  for (const r of items) decorate(r, today);
  return { items, total, page, pageSize };
}

/** Derived, display-only fields: official FSC title and days left to respond. */
function decorate(r: Record<string, unknown>, today: string) {
  r.fsc_name = FSC_NAMES[r.fsc as string] ?? '';
  r.days_left = r.return_by
    ? Math.round((Date.parse((r.return_by as string) + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
    : null;
}

/** Every row matching the filters (no paging), streamed one at a time for CSV export. */
export function* iterateRfqs(p: RfqQuery) {
  const { sql, args, today } = build(p);
  const col = SORTS[p.sort ?? 'due'] ?? 'return_by';
  const dir = p.dir === 'desc' ? 'DESC' : 'ASC';
  const stmt = db.prepare(`SELECT * FROM rfq ${sql} ORDER BY ${col} ${dir}, sol_no ASC`);
  for (const r of stmt.iterate(...args) as IterableIterator<Record<string, unknown>>) {
    decorate(r, today);
    yield r;
  }
}

/** Option lists + data-freshness for the filter bar and header chip. */
export function meta() {
  const today = todayET();
  const open = `return_by >= '${today}' AND status IN ('Open', '')`;
  const fscs = db
    .prepare(`SELECT fsc value, COUNT(*) n FROM rfq WHERE fsc <> '' AND ${open} GROUP BY fsc ORDER BY n DESC`)
    .all()
    .map((o) => ({ ...(o as { value: string; n: number }), name: FSC_NAMES[(o as { value: string }).value] ?? '' }));
  const setAsides = db.prepare(`SELECT set_aside value, COUNT(*) n FROM rfq WHERE set_aside <> '' AND ${open} GROUP BY set_aside ORDER BY n DESC`).all();
  const offices = db.prepare(`SELECT office_prefix value, COUNT(*) n FROM rfq WHERE ${open} GROUP BY office_prefix ORDER BY n DESC`).all();
  const totals = db.prepare(`SELECT COUNT(*) total, SUM(${open}) open, MAX(issue_date) latestIssue FROM rfq`).get();
  // the freshness chip is about the last scrape of the site; bulk loads are reported separately
  const lastRun = db
    .prepare(`SELECT * FROM ingest_run WHERE mode = 'site' AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .get();
  const dateOf = `COALESCE(NULLIF(issue_date, ''), post_date)`;
  const coverage = db
    .prepare(`SELECT MIN(${dateOf}) "from", MAX(${dateOf}) "to", SUM(source = 'bulk') bulkRows FROM rfq WHERE ${open}`)
    .get();
  return { today, fscs, setAsides, offices, totals, lastRun, coverage };
}
