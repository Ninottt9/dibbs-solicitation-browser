import { fetchApprovedSources, fetchIndex, listBulkDays } from './bulk.js';
import { db, insertApprovedSources, insertBulkRows, upsertRows } from './db.js';
import { ingestDay, listDates } from './scrape.js';

type Log = (m: string) => void;

let running = false;
let phase = '';
export const isIngesting = () => running;
export const ingestPhase = () => phase;

/** Single-flight: the button, the CLI and the scheduler can't run two crawls at once. */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (running) throw new Error('ingest already running');
  running = true;
  try {
    return await fn();
  } finally {
    running = false;
    phase = '';
  }
}

function startRun(mode: 'site' | 'bulk' | 'approved', date: string) {
  return db
    .prepare('INSERT INTO ingest_run (date, started_at, status, mode) VALUES (?, ?, ?, ?)')
    .run(date, new Date().toISOString(), 'running', mode).lastInsertRowid;
}
function finishRun(id: number | bigint, v: { date?: string; pages: number; rows: number; expected: number; status: string; error?: string }) {
  db.prepare('UPDATE ingest_run SET date=COALESCE(?, date), finished_at=?, pages=?, rows=?, expected=?, status=?, error=? WHERE id=?').run(
    v.date ?? null, new Date().toISOString(), v.pages, v.rows, v.expected, v.status, v.error ?? null, id,
  );
}

/** Scrape one issue day from the site (default: the newest). */
async function scrapeDay(date: string | undefined, log: Log) {
  const runId = startRun('site', date ?? '');
  let pages = 0, rows = 0, expected = 0;
  try {
    phase = 'Reading the latest day from DIBBS';
    const day = date ?? (await listDates())[0];
    if (!day) throw new Error('no issue dates found');
    log(`ingesting ${day}`);
    const res = await ingestDay(day, (batch, page, total) => {
      upsertRows(batch);
      pages = page; rows += batch.length; expected = total;
      phase = `Reading ${day} from DIBBS (page ${page})`;
      log(`page ${page}: +${batch.length} (${rows}/${total})`);
    });
    finishRun(runId, { date: day, pages: res.pages, rows, expected: res.total, status: rows >= res.total ? 'ok' : 'partial' });
    return { day, ...res };
  } catch (e) {
    finishRun(runId, { pages, rows, expected, status: 'error', error: String(e) });
    throw e;
  }
}

/**
 * Load older days from the official bulk files, one small file per post date. Days already loaded
 * are skipped (a published file never changes), so repeated refreshes only fetch what is new.
 */
async function backfillBulk(log: Log, maxDays = 60) {
  const doneDates = (mode: string) =>
    new Set((db.prepare("SELECT date FROM ingest_run WHERE mode=? AND status='ok'").all(mode) as { date: string }[]).map((r) => r.date));
  const doneIndex = doneDates('bulk');
  const doneSources = doneDates('approved');
  const days = (await listBulkDays()).slice(0, maxDays).filter((d) => !doneIndex.has(d.date) || !doneSources.has(d.date));
  let added = 0, sources = 0, failed = 0;
  for (const [i, day] of days.entries()) {
    const label = `${i + 1}/${days.length} (${day.date})`;
    if (!doneIndex.has(day.date)) {
      const runId = startRun('bulk', day.date);
      try {
        phase = `Loading RFQ file ${label}`;
        const rows = await fetchIndex(day);
        const n = insertBulkRows(rows);
        added += n;
        finishRun(runId, { pages: 1, rows: rows.length, expected: rows.length, status: 'ok' });
        log(`bulk ${day.date}: ${rows.length} rows, ${n} new`);
      } catch (e) {
        failed++;
        finishRun(runId, { pages: 0, rows: 0, expected: 0, status: 'error', error: String(e) });
        log(`bulk ${day.date} failed: ${e}`);
      }
    }
    if (!doneSources.has(day.date)) {
      const runId = startRun('approved', day.date);
      try {
        phase = `Loading approved sources ${label}`;
        const rows = await fetchApprovedSources(day);
        const n = insertApprovedSources(rows, day.date);
        sources += n;
        finishRun(runId, { pages: 1, rows: rows.length, expected: rows.length, status: 'ok' });
        log(`approved sources ${day.date}: ${rows.length} lines, ${n} new`);
      } catch (e) {
        failed++;
        finishRun(runId, { pages: 0, rows: 0, expected: 0, status: 'error', error: String(e) });
        log(`approved sources ${day.date} failed: ${e}`);
      }
    }
  }
  return { days: days.length, added, sources, failed };
}

/** Scrape one day only (CLI `--date`, and the API's `?date=`). */
export const runIngest = (date?: string, log: Log = console.log) => withLock(() => scrapeDay(date, log));

/** Bulk backfill only. */
export const runBackfill = (maxDays?: number, log: Log = console.log) => withLock(() => backfillBulk(log, maxDays));

/**
 * What the Refresh button and the scheduler run: the newest day from the site (fresh status, tech docs,
 * fast-award), then any older days we don't have yet from the bulk files. A failed scrape doesn't stop
 * the bulk step, and is reported afterwards.
 */
export const runRefresh = (log: Log = console.log, opts: { previousDay?: boolean } = {}) =>
  withLock(async () => {
    let scrapeError: unknown;
    let site: Awaited<ReturnType<typeof scrapeDay>> | undefined;
    try {
      site = await scrapeDay(undefined, log);
      // also re-read the previous issue day so statuses of RFQs from yesterday don't go stale
      if (opts.previousDay) {
        const prev = (await listDates())[1];
        if (prev) await scrapeDay(prev, log);
      }
    } catch (e) {
      scrapeError = e;
      log(`site scrape failed: ${e}`);
    }
    const bulk = await backfillBulk(log).catch((e) => {
      log(`bulk backfill failed: ${e}`);
      return undefined;
    });
    if (scrapeError && !bulk) throw scrapeError;
    return { site, bulk, scrapeError: scrapeError ? String(scrapeError) : undefined };
  });

if (process.argv[1]?.endsWith('ingest.ts')) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const job = process.argv.includes('--bulk')
    ? runBackfill(arg('--days') ? Number(arg('--days')) : undefined)
    : arg('--date')
      ? runIngest(arg('--date'))
      : runRefresh();
  job
    .then((r) => console.log('done', JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
