import { db, upsertRows } from './db.js';
import { ingestDay, listDates } from './scrape.js';

let running = false;
export const isIngesting = () => running;

/** Ingest one issue day (default: newest). Single-flight: a second call while running is rejected. */
export async function runIngest(date?: string, log: (m: string) => void = console.log) {
  if (running) throw new Error('ingest already running');
  running = true;
  const runId = db
    .prepare('INSERT INTO ingest_run (date, started_at, status) VALUES (?, ?, ?)')
    .run(date ?? '', new Date().toISOString(), 'running').lastInsertRowid;
  let pages = 0;
  let rows = 0;
  let expected = 0;
  try {
    const day = date ?? (await listDates())[0];
    if (!day) throw new Error('no issue dates found');
    log(`ingesting ${day}`);
    const res = await ingestDay(day, (batch, page, total) => {
      upsertRows(batch);
      pages = page;
      rows += batch.length;
      expected = total;
      log(`page ${page}: +${batch.length} (${rows}/${total})`);
    });
    db.prepare('UPDATE ingest_run SET date=?, finished_at=?, pages=?, rows=?, expected=?, status=? WHERE id=?').run(
      day, new Date().toISOString(), res.pages, rows, res.total, rows >= res.total ? 'ok' : 'partial', runId,
    );
    return { day, ...res };
  } catch (e) {
    db.prepare('UPDATE ingest_run SET finished_at=?, pages=?, rows=?, expected=?, status=?, error=? WHERE id=?').run(
      new Date().toISOString(), pages, rows, expected, 'error', String(e), runId,
    );
    throw e;
  } finally {
    running = false;
  }
}

if (process.argv[1]?.endsWith('ingest.ts')) {
  const i = process.argv.indexOf('--date');
  runIngest(i > 0 ? process.argv[i + 1] : undefined)
    .then((r) => console.log('done', r))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
