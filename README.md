# DIBBS Solicitation Browser

A fast, focused way for a vendor to scan the day's DLA RFQs from [DIBBS](https://www.dibbs.bsm.dla.mil/RFQ/): pull them in, then search, filter and jump back to the original DIBBS page.

Stack: Node + TypeScript (Express, `better-sqlite3`, `cheerio`) and React + Vite. Prototype built in about an hour, so the scope is deliberately narrow (see "What I cut").

## Run it

Needs Node 22+ and `curl` on the PATH (Windows 10+ and macOS ship with it). No compiler or Python is needed: `server/.npmrc` skips npm install scripts so the prebuilt SQLite binary is used.

```bash
# 1. API + data (port 3000)
cd server && npm install
npm run ingest                      # newest issue day, ~1,500 RFQs, about a minute
#   npm run ingest -- --date 10-21-2026   # any day from DIBBS's date list
npm start

# 2a. UI in dev mode (port 5173, proxies /api to 3000)
cd web && npm install && npm run dev

# 2b. ...or build once and let the API serve it on http://localhost:3000
cd web && npm run build
```

`server/data/rfq.db` is committed with one day of data, so the app works on a fresh clone and when DIBBS is slow or unreachable. The **Refresh** button (or `npm run ingest`) pulls the latest day and upserts it, so it is safe to run repeatedly.

## How it gets the data

DIBBS has no public RFQ API, so this scrapes the same pages a browser sees. The non-obvious parts:

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

## Tradeoffs

- **SQLite + `LIKE`** instead of a search engine or FTS5: at a few thousand rows it is instant, and there is nothing to run.
- **Server-side filtering and paging** with indexes on due date, FSC, NSN and issue date, so the table stays quick however many days are loaded.
- **Open RFQs by default.** Closed, removed and past-due RFQs are hidden unless you tick "Include closed / past due".
- **One issue day loaded.** The scraper takes any day via `--date`; multi-day backfill is a loop over `GET /api/dates`, not built.
- **Nomenclature is truncated by DIBBS** in the list view (e.g. "ADMINISTRATION SET, INF"). Full names are on the RFQ PDF.

## What I cut (next steps)

1. **PDF details**: fetch each RFQ's PDF lazily and extract buyer, FOB, delivery days, approved sources (CAGE + part number) and packaging notes. This makes "approved source is my CAGE" filterable. It was cut because it needs a second consent flow on `dibbs2` and PDF layouts vary.
2. **Scheduled refresh** (weekday cron) plus a backfill of the last N days.
3. **Saved views and alerts** for pinned FSCs, and CSV export of the current result.
4. **A detail drawer** and facet counts that update with the active filters.
5. **Tests**: a parser test against the saved HTML fixture (`server/fixtures/day.html`) and a query-builder test.

## Layout

```
server/src/client.ts   curl transport, consent, cookies, throttle, timeout
server/src/scrape.ts   date index, VIEWSTATE paging, row parser (pure)
server/src/db.ts       SQLite schema + upsert
server/src/ingest.ts   ingest run + single-flight lock + CLI
server/src/query.ts    search / filter / sort query builder, filter options
server/src/index.ts    Express API and static UI
web/src/App.tsx        the whole UI
```

API: `GET /api/rfqs` (filters: `q fsc setAside office techDocs dueWithinDays qtyMin qtyMax fastAward includePast sort dir page pageSize`), `GET /api/meta`, `GET /api/dates`, `POST /api/ingest[?date=MM-DD-YYYY]`.
