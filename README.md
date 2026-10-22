# DIBBS Solicitation Browser

A fast, focused way for a vendor to scan the open DLA RFQs from [DIBBS](https://www.dibbs.bsm.dla.mil/RFQ/): pull them in, then search, filter and jump back to the original DIBBS page.

Stack: Node + TypeScript (Express, `better-sqlite3`, `cheerio`) and React + Vite. Prototype built in a few hours, so the scope is deliberately narrow (see "What I cut").

## Run it

Needs Node 22+ and `curl` on the PATH (Windows 10+ and macOS ship with it). No compiler or Python is needed: `server/.npmrc` skips npm install scripts so the prebuilt SQLite binary is used.

```bash
# 1. API + data (port 3000)
cd server && npm install
npm start                           # or: npm run start:live  (adds hourly auto-refresh, see below)

# 2a. UI in dev mode (port 5173, proxies /api to 3000)
cd web && npm install && npm run dev

# 2b. ...or build once and let the API serve it on http://localhost:3000
cd web && npm run build
```

**Data.** `server/data/rfq.db` is a committed, read-only snapshot (about 14,700 open RFQs from the last four weeks, plus their approved sources), so the app works on a fresh clone and when DIBBS is slow or unreachable. On first start the server copies it to `server/data/live.db` (git-ignored), and that copy is what the app reads and writes, so the committed snapshot never changes.

**Refreshing.** The **Refresh** button (or `npm run ingest`) does two things: it reads the newest issue day from the site, then loads any older days it doesn't have yet from DIBBS's official bulk files. It is idempotent, so it is safe to run repeatedly. Other CLI forms:

```bash
npm run ingest -- --date 10-21-2026   # scrape just that issue day from the site
npm run ingest -- --bulk --days 30    # only the bulk files (RFQ index + approved sources)
```

**Auto-refresh (opt-in).** `npm run start:live` also refreshes hourly on weekdays between 8:00 and 18:00 US Eastern, when DIBBS posts. The first run of each day also re-reads the previous issue day so statuses stay current. The page checks for new data every minute, reloads the table when a run finishes and shows a toast. It is off by default so the app never contacts DIBBS unless you ask.

## How it gets the data

DIBBS has no public RFQ API that I could find. It does publish **official bulk files** (the "RFQ Download files" page), so there are two sources, used for what each is good at:

| Source | Used for | Limits |
|---|---|---|
| **The site's lists** (scraped) | The newest day: status, tech-docs flag, fast-award flag, issue date. | About 31 throttled requests per day. |
| **Bulk files** (`in<yymmdd>.txt` index, plus `as<yymmdd>.txt` approved sources inside `bq<yymmdd>.zip`) | Backfilling older days: one small file per day, plus the approved-sources list. | The index has no status, tech-docs or fast-award flags and no issue date. Today's file is only posted the next day. |

**The file date is the post date, not the issue date.** Checking the files against the site showed that the file named for 10-21 mostly lists RFQs the site shows as issued 10-22. So bulk-only rows keep the post date, show it with a `*`, and leave status and tech docs as unknown (`?`) until a scrape sees them. Bulk rows only ever add rows and never overwrite scraped data.

The scraping parts, which were the non-obvious bit:

- **Consent wall.** Every URL redirects to `dodwarning.aspx`. The client GETs it, POSTs back the hidden `__VIEWSTATE*` fields plus `butAgree=OK`, and keeps the cookies. If a request lands on the wall again, it clears it and retries.
- **WAF.** DIBBS is behind an F5 firewall that answers Node's `fetch` with "Request Rejected" (the TLS fingerprint, not the headers). The same request through `curl` passes, so the HTTP client shells out to `curl`. It is a pragmatic choice for a prototype; a production version would use a TLS-impersonating client or ask DLA for a feed.
- **Paging.** A day is about 1,500 rows at 50 per page. Pages are ASP.NET postbacks that chain `__VIEWSTATE`, so they must be fetched one after another (about 31 requests per day). The crawl follows the pager's "next page" link rather than the visible page numbers, because the pager shows `...` after page 10. Requests are throttled to about 1 per second with a hard timeout and one retry.
- **Checks.** Each ingest records the row count against DIBBS's own "Records Found" figure in an `ingest_run` row, so a partial crawl shows up as "partial" in the header instead of passing silently.
- **Idempotent.** Rows are upserted on `(solicitation, NSN, PR number)`, so re-running or re-ingesting a growing day just updates status, quantity and due date. A single-flight lock stops two ingests running at once.

Derived fields: FSC (first 4 digits of the NSN), buying-office prefix (first 6 characters of the solicitation number), days left to respond, and a "fast award" flag.

## Filters, and why

A vendor evaluating opportunities asks one question per row: *can I realistically win this?*

| Filter | Why |
|---|---|
| **Product class (FSC)** | Vendors only bid on what they make or resell. This is the main "is this my product line?" filter, and the dropdown lists classes by how many open RFQs each has. |
| **Due date / "Closing ≤ 3 days"** | Hides RFQs that can't be quoted in time. The default view hides past-due and non-open RFQs and sorts soonest-first. The due badge is red / amber / green. |
| **Set-aside** (Small Business, HUBZone, SDVOSB, WOSB, Unrestricted) | Small-business vendors want the set-asides, and some vendors aren't eligible for others. A one-click "Small business" chip covers every small-business type. |
| **Tech docs available** | Drawings or specs are usually required before you can quote. "None" often means you need an existing source or approval. |
| **Quantity** | Is the order worth the effort? |
| **Buying office** | Some vendors specialise in particular DLA sites. |
| **⚡ Fast award** | DIBBS flags micro-purchases that may be awarded before the return date. Worth knowing, because these go to whoever quotes first. |

**Search** is built for how vendors actually look things up: paste an NSN (with or without dashes) or a full solicitation number and you get an exact match; type a partial NSN and you browse by prefix; anything else is a word search over part name, solicitation, NSN and PR number. All filter state lives in the URL, so a view can be bookmarked or shared.

**Opening on DIBBS.** The solicitation number links to the DIBBS Package View, the NSN links to its NSN page, and each row has direct PDF and Quote links, all in new tabs. DIBBS shows its DoD consent notice first on a fresh browser session, and the PDFs live on a second host (`dibbs2`) with its own notice.

**Working through a list.** Vendors triage dozens of rows, so the UI is built for that:
- **Product class picker**: multi-select with type-ahead over the official DLA class titles (the "FSC Download" file on DIBBS, kept in `server/data/fsc.json`), so "hose" finds 4720 and you can pick several classes at once.
- **Filter pills**: every active filter is a removable pill above the table, so the current view is always readable.
- **Detail drawer**: click a row for every field, the full DIBBS links and copy buttons. `j`/`k` or the arrow keys walk the list, `s` stars, `Esc` closes. "Other RFQs for this NSN" searches that NSN across closed RFQs too.
- **Star and hide**: star what you're pursuing and hide what you've ruled out. Both are saved in the browser (localStorage), and there's a **★ Starred** view. Hidden rows can be shown again.
- **CSV export**: downloads *every* row matching the current filters, not just the visible page. It opens cleanly in Excel (UTF-8 BOM, proper quoting, and cells that look like formulas are neutralised). The starred view exports your starred rows.

**Competition and eligibility (approved sources).** For many parts DLA lists the sources it has approved (CAGE code and part number). The daily bulk files carry this, so no PDF parsing is needed:
- **My CAGE** filter and a **✓ Approved for me** chip show only RFQs for NSNs your CAGE code is approved for. The code is remembered in the browser.
- **Src** column: how many approved sources are listed for the row's NSN. Click a row to see them in the drawer, with your own CAGE highlighted. "None listed" means DIBBS's bulk files published none, not that the part is open to everyone.
- Company names are almost always blank in the file, so the CAGE code is the identifier.

**Staying current.** A **🆕 New** chip and `NEW` row badges show RFQs added since your last visit (a per-tab baseline in browser storage, so a reload doesn't wipe it, and **Mark all seen** resets it). Nothing is "new" on your first visit. The header shows the posting range covered and when the site was last read.

## Tradeoffs

- **Star and hide live in the browser, not on the server.** There are no accounts, so they don't follow you across devices, and the server's CSV export includes hidden rows.
- **SQLite + `LIKE`** instead of a search engine or FTS5: at a few thousand rows it is instant, and there is nothing to run.
- **Server-side filtering and paging** with indexes on due date, FSC, NSN and issue date, so the table stays quick however many days are loaded.
- **Open RFQs by default.** Closed, removed and past-due RFQs are hidden unless you tick "Include closed / past due".
- **About four weeks loaded** (every day DIBBS lists as downloadable), from the bulk files, so the default view covers all currently open RFQs rather than one day. Older rows stay in `live.db` and appear with "Include closed / past due".
- **Bulk-only rows are partly unknown** (status, tech docs, issue date, fast award) until the site's list covers them; the UI says so instead of guessing.
- **The committed snapshot is pruned** to open RFQs and their sources (about 11 MB), so it won't contain closed history. Your `live.db` keeps everything.
- **Nomenclature is truncated by DIBBS** in the list view (e.g. "ADMINISTRATION SET, INF"). Full names are on the RFQ PDF.

## What I cut (next steps)

1. **PDF details**: fetch each RFQ's PDF lazily and extract buyer, FOB, delivery days, approved sources (CAGE + part number) and packaging notes. This makes "approved source is my CAGE" filterable. It was cut because it needs a second consent flow on `dibbs2` and PDF layouts vary.
2. **More from the bulk files.** The batch-quote file in the same zip carries the line-item data DLA uses for quoting (delivery days, FOB and more), which could replace much of the PDF parsing above. The `ca` zip holds every RFQ PDF for a day.
3. **Alerts and saved views** for pinned product classes or your CAGE (email or webhook when a match appears), now that new data arrives on a schedule.
4. **Server-side accounts** so star, hide and your CAGE follow you across devices, and facet counts that update with the active filters.
5. **Tests**: a parser test against the saved HTML fixture (`server/fixtures/day.html`), tests for the bulk-file parsers (`parseIndex`, `parseApproved`) and the query builder. I only checked these by hand against real files.
6. **Deployment.** The scraper shells out to `curl`, so it needs a host where you control the runtime (a small VM or container), not a serverless platform.

## Layout

```
server/src/client.ts   curl transport, consent, cookies, throttle, timeout
server/src/scrape.ts   date index, VIEWSTATE paging, row parser (pure)
server/src/bulk.ts     bulk files: list days, parse the fixed-width index, approved sources (pure parsers)
server/src/db.ts       SQLite schema, migrations, upserts; snapshot -> live.db seeding
server/src/ingest.ts   refresh (site + bulk), single-flight lock, CLI
server/src/scheduler.ts  opt-in hourly weekday refresh (US Eastern)
server/src/query.ts    search / filter / sort query builder, filter options, FSC titles
server/src/csv.ts      CSV columns + Excel-safe cell escaping
server/src/index.ts    Express API and static UI
server/data/fsc.json   official DLA FSC titles
server/data/rfq.db     committed read-only snapshot (live data is the git-ignored live.db)
web/src/App.tsx        page: search bar, filters, table, pager
web/src/components/    FscPicker (multi-select), Pills (active filters), Drawer (row detail + approved sources)
web/src/triage.ts      star / hide state in localStorage
web/src/visit.ts       "new since your last visit" baseline
web/src/csv.ts         client-side CSV for the starred view
web/src/lib.ts         shared types, URL state, query building
```

API: `GET /api/rfqs` (filters: `q fsc setAside office techDocs dueWithinDays qtyMin qtyMax fastAward cage newSince includePast sort dir page pageSize`; `fsc`, `setAside` and `office` take comma-separated lists; `cage` is a 5-character CAGE code; `newSince` an ISO time), `GET /api/rfqs/export.csv` (same filters, all rows), `GET /api/nsn/:nsn13/sources` (approved sources for an NSN), `GET /api/meta[?since=ISO]` (filter options, coverage, freshness, auto-refresh status, count of new RFQs), `GET /api/dates`, `POST /api/ingest[?date=MM-DD-YYYY]` (no date: newest day plus any missing bulk days).
