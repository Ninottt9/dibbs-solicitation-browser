# DIBBS Solicitation Browser — Plan

## Problem
DIBBS (https://www.dibbs.bsm.dla.mil/RFQ/) posts ~1,500 RFQs per weekday. Browsing is slow (ASP.NET pages, 50 rows per page, consent wall). Goal: ingest daily RFQs and give vendors a fast browse / search / filter UI that deep-links back to DIBBS.

## What the site actually looks like (verified by probing)
- **Consent wall**: every host redirects to `dodwarning.aspx`. Fix: GET it, then POST the hidden `__VIEWSTATE*` fields plus `butAgree=OK`. That sets cookies (`SessionId`, `dw`, `TS*`). `dibbs2.bsm.dla.mil` (the document/download host) has its **own** consent gate.
- **Date index**: `/Rfq/RfqDates.aspx?category=issue` lists about 28 issue dates (`Value=MM-DD-YYYY`, links in single quotes).
- **Daily list**: `/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=MM-DD-YYYY` shows "Records Found: 1513", 50 rows per page. Paging goes through `__doPostBack('ctl00$cph1$grdRfqSearch','Page$N')` with chained VIEWSTATE, so pages have to be fetched **one after another**, about 30 POSTs per day.
- **Row fields** (span ids `lblXxx`):
  - NSN, plus a link to `RFQNsn.aspx?value=<nsn13>`
  - Nomenclature
  - Technical docs (`None` / `Tech Docs` / `Mil-Spec` …)
  - Solicitation # (`SPE1C1-27-Q-0091`), PDF link (`dibbs2…/Downloads/RFQ/<n>/<sol>.PDF`), Package View link (`rfqrec.aspx?sn=<sol-no-dashes>`)
  - Set-aside icon alt text (e.g. "Unrestricted/Not Set Aside")
  - Status (Open …)
  - PR number and `QTY: N`
  - Issued date
  - Return By date
- **Bulk files** (`RFQDates.aspx?category=recent`): daily `in<yymmdd>.txt` index, `bq<yymmdd>.zip` batch-quote file, and `ca<yymmdd>.zip`, all hosted on dibbs2. Today's file is only posted the next day. I haven't validated these yet because the dibbs2 consent probe hung, so they're an optional fast path.

## Derived fields (cheap, high value)
- **FSC** = first 4 digits of the NSN. Map it to an FSC group / name from a small static table, e.g. 8475 → Specialized Flight Clothing. This becomes the main "is this my product line?" filter.
- **Buying office** = solicitation prefix (`SPE1C1` = DLA Troop Support C&E, `SPE4A*` = Land & Maritime Aviation, `SPE7*` = Land & Maritime …). Store the raw prefix and attach a label where it's known.
- **Days to respond** = returnBy − today. Used for urgency badges and a "closing soon" filter.
- **Has tech docs** (boolean) and **set-aside type** (enum taken from the icon alt text).
- **Qty bucket**.

## Confirmed choices
- **Stack**: Node.js (TypeScript) backend, React frontend, SQLite.
- **Backfill**: the last 3 days at first; older days on demand.
- **Refresh**: both a manual path (CLI + "Refresh" button in the UI) and a scheduled background refresh.
- **Extras**: saved views (localStorage), CSV export, and solicitation PDF details (slow, lazy, cached).

## Proposed stack
- **Monorepo**: npm workspaces with `server/`, `web/`, and `shared/`. `shared/` holds the TS types (`Rfq`, `RfqQuery`, `Facets`).
- **Server**: Node 22 + TypeScript (`tsx` in dev).
  - API: **Fastify**.
  - Database: **better-sqlite3**. It's synchronous, very fast, and has FTS5 built in.
  - HTTP: `undici` fetch with a cookie jar (`tough-cookie` + `fetch-cookie`).
  - Parsing: **cheerio**, plus `p-limit`/`p-retry`.
  - Background refresh: `node-cron`.
  - PDFs: **pdfjs-dist** or `pdf-parse`.
  - Tests: **vitest**.
- **Scraper CLI**: `npm run ingest -- --days 3` or `--date 10-21-2026`. The same code powers `POST /api/ingest` and the cron job (weekdays, hourly 8:00–18:00 ET).
- **Web**: Vite + React + TS + TanStack Table + TanStack Query + Tailwind. Filter state lives in the URL, so views are shareable and can be saved.
- **Repo layout**:
  ```
  package.json                 npm workspaces, root scripts (dev, ingest, test)
  shared/src/types.ts
  server/
    src/index.ts               Fastify bootstrap, cron, static web build in prod
    src/routes/rfqs.ts         GET /api/rfqs, /api/rfqs/export.csv, /api/rfqs/:sol/details
    src/routes/meta.ts         GET /api/meta, POST /api/ingest
    src/db/schema.sql          tables, FTS5, indexes
    src/db/repo.ts             upsert, query builder, facets
    src/scraper/client.ts      consent (www + dibbs2), cookie jar, throttle, retry, timeouts
    src/scraper/listPages.ts   date index + sequential VIEWSTATE paging
    src/scraper/parseGrid.ts   cheerio row -> Rfq (pure, unit-tested)
    src/scraper/pdfDetails.ts  download + extract RFQ PDF fields
    src/scraper/enrich.ts      FSC / office / derived fields
    src/cli/ingest.ts
    data/fsc.json              static FSC code -> name/group
    test/fixtures/*.html, *.pdf
  web/
    src/pages/Browse.tsx
    src/components/{SearchBar,FilterPanel,ResultsTable,DetailDrawer,SavedViews,ExportButton,DataStatus}.tsx
    src/lib/{api.ts,urlState.ts,savedViews.ts}
  README.md                    approach, filter rationale, tradeoffs, how to run
  ```

## Solicitation PDF details (slow path)
- Fetch the PDF from `dibbs2…/Downloads/RFQ/<n>/<SOL>.PDF` after consenting on dibbs2. Extract the text with pdfjs and regex out best-effort fields:
  - buyer name / email / phone
  - FOB (origin/destination)
  - required delivery days
  - inspection/acceptance point
  - AMSC/AMC code
  - approved sources (CAGE + P/N)
  - unit of issue
  - packaging/MIL-STD notes
  - set-aside wording
  - a "first N chars" text excerpt
- **Lazy**: fetched when a row's drawer opens (`GET /api/rfqs/:sol/details`) and cached in a `rfq_details` table along with the parse status.
- **Optional background enrichment**: a low-concurrency queue (1 at a time, throttled) fills in details for open RFQs, soonest due date first. This makes **"Approved source has CAGE X"**, **FOB**, and **AMSC** filterable once the data exists.
- Failures are stored with `status=error` and `retry_after`. The UI shows "Details unavailable — open PDF on DIBBS".

## Data model (`rfq` table)
`sol_no` (PK, normalized without dashes), `sol_display`, `nsn`, `nsn13`, `fsc`, `fsc_name`, `niin`, `nomenclature`, `tech_docs`, `set_aside`, `status`, `pr_no`, `qty`, `issue_date`, `return_by`, `office_prefix`, `pdf_url`, `package_url`, `nsn_url`, `first_seen_at`, `last_seen_at`.
- One solicitation can list **several NSNs/lines**, so the PK is `(sol_no, nsn, pr_no)`. The UI groups rows by solicitation.
- Separate `ingest_run` table records date, pages, rows, status, and errors, which feeds a "Data as of …" indicator.
- FTS5 virtual table over `sol_display`, `nsn`, `nsn13`, `nomenclature`, `pr_no`, `fsc_name`.

## API
- `GET /api/rfqs?q=&fsc=&office=&setAside=&techDocs=&status=&issuedFrom=&issuedTo=&dueWithinDays=&qtyMin=&qtyMax=&sort=&page=&pageSize=` returns `{items, total, facets}`.
  - Facets are counts per FSC, set-aside, office, and tech docs under the current filters, so the filter panel shows numbers.
- `GET /api/rfqs/export.csv?<same filters>` streams **all** matching rows, not only the current page.
- `GET /api/rfqs/:sol/details` returns cached PDF details, or fetches them on demand.
- `GET /api/meta` returns last ingest time, available dates, total count, and whether an ingest is running.
- `POST /api/ingest?date=` (admin) triggers a refresh in the background. It's guarded by a single-flight lock so concurrent refreshes can't overlap.

## UX
- Single dense table: Solicitation | NSN | Nomenclature | FSC | Qty | Set-aside | Tech docs | Issued | Due (with countdown badge) | DIBBS links.
- Debounced search box with smart parsing:
  - a pasted NSN (with or without dashes) matches exactly
  - a pasted solicitation # matches exactly
  - anything else runs FTS
- Left filter panel with facet counts. Sort by due date by default (soonest first). Server-side pagination or virtual scroll.
- Row click opens a drawer showing all fields plus buttons: **Open on DIBBS** (Package View), **RFQ PDF**, **NSN history on DIBBS**, **Quote on DIBBS**.
- Included extras:
  - **Saved views** (localStorage, e.g. "My FSCs, open, small-business set-aside")
  - **CSV export** of the current filtered result
  - **PDF details** shown in the drawer (buyer, FOB, delivery days, approved sources)
- Header shows a data-status chip ("Data as of 10:12 ET · 4,512 RFQs") and a **Refresh** button that shows progress.

## Filters and why
1. **FSC / product category**: vendors only bid on what they make or distribute. This is the most important filter.
2. **Due date / days left**: hides RFQs that can't realistically be quoted. Default is "still open".
3. **Set-aside type**: small-business vendors want the set-aside opportunities, and some are ineligible for others.
4. **Tech docs available**: drawings or specs are required before you can quote. "None" often means the vendor needs an existing source/approval.
5. **Quantity range**: shows whether the order size is worth the effort.
6. **Issue date range**: lets the vendor scan only new postings.
7. **Buying office**: some vendors specialize in specific DLA sites.

## Edge cases and risks
- **Consent and session**
  - Cookies expire mid-crawl → detect the redirect to `dodwarning.aspx`, re-consent, and resume from the current page.
  - dibbs2 needs a separate consent.
  - The F5/TS cookies may block "bot" user agents → send a browser UA.
- **Pagination via VIEWSTATE**
  - Must be sequential.
  - Last page has fewer rows.
  - The pager shows a `...` ellipsis after page 10, so loop until no `Page$N+1` remains rather than trusting the visible links.
  - Use "Records Found" to sanity-check the total.
- **Rate limiting / politeness**: throttle to about 1 req/s, use retries with exponential backoff, and set timeouts. The probe showed requests sometimes hang for minutes, so a hard timeout is needed.
- **Volume**: the initial backfill is the last 3 issue days, about 90 requests (roughly 2 minutes). Older days load on demand from a date picker. Each day is checkpointed so a failure is resumable.
- **Overlapping refreshes**: cron, the button, and the CLI could run at the same time → single-flight lock plus an `ingest_run` row with status.
- **PDFs**
  - dibbs2 consent is separate, and requests there hung during probing → 20s hard timeout and abort.
  - Some PDFs are scanned images with no text → status `no_text`.
  - Layouts vary → every field is optional and the raw excerpt is kept.
  - Files can be large → size cap.
  - Concurrency = 1 so DIBBS isn't hammered.
- **CSV**: escape quotes, commas and newlines. Add a BOM so Excel opens it cleanly. Export respects the current filters and sort.
- **Saved views**: stored as the URL query string in localStorage. Handle renames, deletes, and old saved views that contain filter keys that no longer exist.
- **Today's list grows during the day**: re-ingesting is idempotent (upsert) and updates `last_seen_at` / status.
- **Parsing**
  - Multi-NSN solicitations.
  - Part numbers instead of NSNs (the "NSN/Part Number" column can hold non-NSN values).
  - Missing or `&nbsp;` cells.
  - `QTY:` missing or containing commas.
  - Unknown set-aside icon text → store it raw.
  - Unknown status values (Open / Closed / Cancelled / Awarded) → store raw.
  - Encoding is ISO-8859-1.
- **Dates**: MM-DD-YYYY strings get normalized to ISO. Return-by can equal the issue date (same-day close was seen). Timezone is US/Eastern.
- **Links**: Package View uses the solicitation number without dashes; the PDF lives on dibbs2 behind consent, so a user's browser will see the consent page first. Document that and link to Package View as the primary link.
- **DIBBS down or blocked**: the app still serves from SQLite. Show "data as of" and a stale banner. Ship a small seeded DB or fixtures for the demo in case the network fails.
- **Search**
  - Normalize NSNs (strip dashes).
  - Escape FTS5 special characters.
  - An empty query returns everything.
  - Use prefix matching (`helm*`).
- **UI**: empty states, loading skeletons, an error toast, long nomenclature truncated with a tooltip, and keeping 10k+ rows fast with server-side paging plus indexes.

## Testing
- vitest unit tests:
  - grid parser against a saved real `RfqRecs` HTML fixture
  - PDF field extractor against 1–2 saved PDFs
  - query builder (filter combos, FTS escaping, NSN/solicitation detection)
  - CSV escaping
- A smoke test that ingests 1 day live.
- Manual UI check in the browser.

## Housekeeping
- Delete the leftover probe files in the repo root (`probe_dates.html`, `probe_recs.html`) at the start of implementation.
- `git init`, README with approach, filter rationale, tradeoffs, and how to run.
