import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIngesting, runIngest } from './ingest.js';
import { meta, queryRfqs, type RfqQuery } from './query.js';
import { listDates } from './scrape.js';

const app = express();
app.use(cors());

const num = (v: unknown) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

app.get('/api/rfqs', (req, res) => {
  const q = req.query;
  const p: RfqQuery = {
    q: str(q.q), fsc: str(q.fsc), setAside: str(q.setAside), office: str(q.office),
    techDocs: q.techDocs === 'yes' || q.techDocs === 'no' ? q.techDocs : undefined,
    dueWithinDays: num(q.dueWithinDays), qtyMin: num(q.qtyMin), qtyMax: num(q.qtyMax),
    includePast: q.includePast === '1',
    fastAward: q.fastAward === '1',
    sort: ['due', 'issued', 'qty', 'nsn'].includes(String(q.sort)) ? (q.sort as RfqQuery['sort']) : 'due',
    dir: q.dir === 'desc' ? 'desc' : 'asc',
    page: num(q.page), pageSize: num(q.pageSize),
  };
  try {
    res.json(queryRfqs(p));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/meta', (_req, res) => res.json({ ...meta(), ingesting: isIngesting() }));

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
  runIngest(date).catch((e) => console.error('ingest failed:', e));
  res.status(202).json({ started: true, date: date ?? 'latest' });
});

// Serve the built UI if present (single-process demo); in dev Vite proxies /api here.
const dist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
