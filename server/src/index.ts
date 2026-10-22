import cors from 'cors';
import express, { type Request } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSV_BOM, RFQ_COLUMNS, csvLine } from './csv.js';
import { ingestPhase, isIngesting, runIngest, runRefresh } from './ingest.js';
import { autoRefreshInfo, startScheduler } from './scheduler.js';
import { iterateRfqs, meta, queryRfqs, sourcesFor, todayET, type RfqQuery } from './query.js';
import { listDates } from './scrape.js';

const app = express();
app.use(cors());

const num = (v: unknown) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const isoTime = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? v : undefined;

/** Same filter vocabulary for the table and the CSV export. */
function parseQuery(q: Request['query']): RfqQuery {
  return {
    q: str(q.q), fsc: str(q.fsc), setAside: str(q.setAside), office: str(q.office),
    techDocs: q.techDocs === 'yes' || q.techDocs === 'no' ? q.techDocs : undefined,
    dueWithinDays: num(q.dueWithinDays), qtyMin: num(q.qtyMin), qtyMax: num(q.qtyMax),
    includePast: q.includePast === '1',
    fastAward: q.fastAward === '1',
    newSince: isoTime(q.newSince),
    cage: typeof q.cage === 'string' && /^[A-Za-z0-9]{5}$/.test(q.cage) ? q.cage.toUpperCase() : undefined,
    sort: ['due', 'issued', 'qty', 'nsn'].includes(String(q.sort)) ? (q.sort as RfqQuery['sort']) : 'due',
    dir: q.dir === 'desc' ? 'desc' : 'asc',
    page: num(q.page), pageSize: num(q.pageSize),
  };
}

app.get('/api/rfqs', (req, res) => {
  try {
    res.json(queryRfqs(parseQuery(req.query)));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// All rows matching the current filters (not just the visible page), streamed as Excel-friendly CSV.
app.get('/api/rfqs/export.csv', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dibbs-rfqs-${todayET()}.csv"`);
    res.write(CSV_BOM + csvLine(RFQ_COLUMNS.map((c) => c.header)));
    for (const r of iterateRfqs(parseQuery(req.query))) res.write(csvLine(RFQ_COLUMNS.map((c) => c.get(r))));
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
    else res.end();
  }
});

app.get('/api/meta', (_req, res) => res.json({ ...meta(isoTime(_req.query.since)), ingesting: isIngesting(), phase: ingestPhase(), autoRefresh: autoRefreshInfo() }));

// Approved sources DLA lists for one NSN (13 digits), for the detail drawer.
app.get('/api/nsn/:nsn13/sources', (req, res) => {
  const n = req.params.nsn13;
  if (!/^\d{13}$/.test(n)) return res.status(400).json({ error: 'nsn13 must be 13 digits' });
  res.json(sourcesFor(n));
});

app.get('/api/dates', async (_req, res) => {
  try {
    res.json(await listDates());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

/** Kick off a refresh in the background; the UI polls /api/meta for `ingesting`. */
app.post('/api/ingest', (req, res) => {
  if (isIngesting()) return res.status(409).json({ error: 'ingest already running' });
  const date = str(req.query.date);
  // with a date: scrape just that day; without: newest day from the site + missing older days from the bulk files
  (date ? runIngest(date) : runRefresh()).catch((e) => console.error('ingest failed:', e));
  res.status(202).json({ started: true, date: date ?? 'latest' });
});

// Serve the built UI if present (single-process demo); in dev Vite proxies /api here.
const dist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API on http://localhost:${port}`);
  // opt-in so the app never contacts DIBBS on its own unless asked: npm run start:live
  if (process.argv.includes('--auto-refresh') || process.env.AUTO_REFRESH === '1') startScheduler();
});
