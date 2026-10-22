import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FscPicker from './components/FscPicker'
import Drawer from './components/Drawer'
import Pills from './components/Pills'
import { useTriage } from './triage'
import {
  DEFAULTS, PAGE_SIZE, filterQuery, fmtDate, fromUrl, isSmallBizAside, rowKey, shortAside, toParams,
  type Filters, type Meta, type Rfq,
} from './lib'

function DueBadge({ days, iso }: { days: number | null; iso: string }) {
  if (days == null) return <>—</>
  const cls = days <= 1 ? 'b-red' : days <= 5 ? 'b-amber' : 'b-green'
  const label = days < 0 ? `${-days}d ago` : days === 0 ? 'today' : `${days}d`
  return (
    <span title={iso}>
      {fmtDate(iso)} <span className={`badge ${cls}`}>{label}</span>
    </span>
  )
}

export default function App() {
  const [f, setF] = useState<Filters>(fromUrl)
  const [qInput, setQInput] = useState(f.q)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [data, setData] = useState<{ items: Rfq[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reqId = useRef(0)
  const triage = useTriage()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [starredView, setStarredView] = useState(false)

  const update = useCallback((patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, page: 1, ...patch }))
  }, [])

  // debounce the search box; keep it in sync when a pill clears the search
  useEffect(() => {
    const t = setTimeout(() => qInput !== f.q && update({ q: qInput }), 250)
    return () => clearTimeout(t)
  }, [qInput, f.q, update])
  useEffect(() => { setQInput(f.q) }, [f.q])

  // filter state lives in the URL so views are shareable
  useEffect(() => {
    const s = toParams(f).toString()
    history.replaceState(null, '', s ? `?${s}` : location.pathname)
  }, [f])

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await (await fetch('/api/meta')).json())
    } catch {
      /* header chip just stays empty */
    }
  }, [])
  useEffect(() => { loadMeta() }, [loadMeta])

  // poll while a refresh is running
  useEffect(() => {
    if (!meta?.ingesting) return
    const t = setInterval(loadMeta, 2500)
    return () => clearInterval(t)
  }, [meta?.ingesting, loadMeta])

  const wasIngesting = useRef(false)
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    if (wasIngesting.current && meta && !meta.ingesting) setRefreshTick((n) => n + 1)
    wasIngesting.current = !!meta?.ingesting
  }, [meta])

  const query = useMemo(() => {
    const p = filterQuery(f)
    p.set('page', String(f.page))
    p.set('pageSize', String(PAGE_SIZE))
    return p.toString()
  }, [f])

  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    fetch(`/api/rfqs?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (id === reqId.current) { setData(d); setError('') } })
      .catch((e) => { if (id === reqId.current) setError(String(e.message ?? e)) })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [query, refreshTick])

  const refresh = async () => {
    const r = await fetch('/api/ingest', { method: 'POST' })
    if (r.status === 409 || r.ok) loadMeta().then(() => setMeta((m) => (m ? { ...m, ingesting: true } : m)))
  }

  const fscName = useCallback(
    (code: string) => meta?.fscs.find((o) => o.value === code)?.name ?? '',
    [meta],
  )
  const smallBiz = (meta?.setAsides ?? []).filter((o) => /small business/i.test(o.value)).map((o) => o.value).join(',')
  const chipOn = {
    soon: f.dueWithinDays === '3',
    docs: f.techDocs === 'yes',
    small: !!smallBiz && f.setAside === smallBiz,
    qty: f.qtyMin === '10',
  }
  const sortBy = (col: string) =>
    update({ sort: col, dir: f.sort === col && f.dir === 'asc' ? 'desc' : col === 'qty' || col === 'issued' ? 'desc' : 'asc' })
  const arrow = (col: string) => (f.sort === col ? (f.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const clearAll = () => {
    setQInput('')
    setF({ ...DEFAULTS })
  }

  // starred view comes from local snapshots, so days-left is recomputed from today's date
  const starredRows: Rfq[] = triage.starred
    .map((r) => ({
      ...r,
      days_left: meta && r.return_by ? Math.round((Date.parse(r.return_by + 'T00:00:00Z') - Date.parse(meta.today + 'T00:00:00Z')) / 86400000) : r.days_left,
    }))
    .sort((a, b) => a.return_by.localeCompare(b.return_by))
  const baseRows = starredView ? starredRows : data?.items ?? []
  const hiddenOnPage = starredView ? 0 : baseRows.filter(triage.isHidden).length
  const rows = showHidden || starredView ? baseRows : baseRows.filter((r) => !triage.isHidden(r))
  const openIdx = openKey ? rows.findIndex((r) => rowKey(r) === openKey) : -1
  const openRow = openIdx >= 0 ? rows[openIdx] : null
  const moveOpen = (delta: number) => {
    const next = rows[openIdx + delta]
    if (next) setOpenKey(rowKey(next))
  }

  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const stale = meta?.lastRun && meta.lastRun.status !== 'ok'

  return (
    <div className="app">
      <header>
        <h1>
          DIBBS Solicitation Browser<small>open RFQs, soonest due first</small>
        </h1>
        <div className={`status ${stale ? 'stale' : ''}`}>
          {meta?.lastRun ? (
            <span>
              Issue date {meta.lastRun.date} · {meta.totals.open.toLocaleString()} open RFQs · updated{' '}
              {new Date(meta.lastRun.finished_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              {stale ? ` · partial (${meta.lastRun.rows}/${meta.lastRun.expected})` : ''}
            </span>
          ) : (
            <span>No data loaded yet — hit Refresh</span>
          )}
          <button className="primary" onClick={refresh} disabled={meta?.ingesting}>
            {meta?.ingesting ? 'Refreshing from DIBBS…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="bar">
        <input
          type="search"
          placeholder="Search NSN, solicitation #, or part name…  e.g. 8475-01-537-3803, SPE1C1-27-Q-0091, helmet"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <button className={`chip ${chipOn.soon ? 'on' : ''}`} onClick={() => update({ dueWithinDays: chipOn.soon ? '' : '3' })}>
          Closing ≤ 3 days
        </button>
        <button className={`chip ${chipOn.docs ? 'on' : ''}`} onClick={() => update({ techDocs: chipOn.docs ? '' : 'yes' })}>
          Has tech docs
        </button>
        <button
          className={`chip ${chipOn.small ? 'on' : ''}`}
          disabled={!smallBiz}
          onClick={() => update({ setAside: chipOn.small ? '' : smallBiz })}
        >
          Small business
        </button>
        <button className={`chip ${chipOn.qty ? 'on' : ''}`} onClick={() => update({ qtyMin: chipOn.qty ? '' : '10' })}>
          Qty ≥ 10
        </button>
        <button
          className={`chip ${f.fastAward ? 'on' : ''}`}
          title="Micro-purchase: quotes may be awarded before the return date, so be quick"
          onClick={() => update({ fastAward: !f.fastAward })}
        >
          ⚡ Fast award
        </button>
        <button
          className={`chip ${starredView ? 'on' : ''}`}
          title="RFQs you starred (saved in this browser)"
          onClick={() => setStarredView((v) => !v)}
        >
          ★ Starred ({triage.starredCount})
        </button>

        <div className="row2">
          <FscPicker options={meta?.fscs ?? []} value={f.fsc} onChange={(v) => update({ fsc: v })} />
          <select value={f.setAside} onChange={(e) => update({ setAside: e.target.value })}>
            <option value="">Any set-aside</option>
            {meta?.setAsides.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.n})
              </option>
            ))}
            {smallBiz.includes(',') && <option value={smallBiz}>All small-business types</option>}
          </select>
          <select value={f.office} onChange={(e) => update({ office: e.target.value })} title="Buying office (solicitation prefix)">
            <option value="">All buying offices</option>
            {meta?.offices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.n})
              </option>
            ))}
          </select>
          <select value={f.techDocs} onChange={(e) => update({ techDocs: e.target.value })}>
            <option value="">Tech docs: any</option>
            <option value="yes">Tech docs available</option>
            <option value="no">No tech docs</option>
          </select>
          <label className="muted">
            Due within{' '}
            <input type="number" min={0} placeholder="days" value={f.dueWithinDays} onChange={(e) => update({ dueWithinDays: e.target.value })} />
          </label>
          <label className="muted">
            Qty min{' '}
            <input type="number" min={0} value={f.qtyMin} onChange={(e) => update({ qtyMin: e.target.value })} />
          </label>
          <label className="muted">
            <input type="checkbox" checked={f.includePast} onChange={(e) => update({ includePast: e.target.checked })} /> Include closed / past due
          </label>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {starredView
              ? `${rows.length} starred`
              : loading && !data ? 'Loading…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {starredView ? (
        <div className="notice">
          Showing your starred RFQs, soonest due first. They are saved in this browser, so statuses may be out of date; open one to check on DIBBS.
          <button className="linklike" onClick={() => setStarredView(false)}>Back to all RFQs</button>
        </div>
      ) : (
        <Pills f={f} fscName={fscName} smallBiz={smallBiz} onChange={update} onClearAll={clearAll} />
      )}
      {!starredView && triage.hiddenCount > 0 && (
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          {hiddenOnPage > 0 ? `${hiddenOnPage} hidden on this page · ` : ''}{triage.hiddenCount} hidden in total ·{' '}
          <button className="linklike" onClick={() => setShowHidden((v) => !v)}>{showHidden ? 'Hide them again' : 'Show hidden'}</button>
          {' · '}
          <button className="linklike" onClick={triage.clearHidden}>Unhide all</button>
        </div>
      )}

      {error && <div className="err">Couldn’t load RFQs: {error}. The server may be down.</div>}

      <div className="tablewrap" style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .15s' }}>
        <table>
          <thead>
            <tr>
              <th className="star" aria-label="Star" />
              <th>Solicitation</th>
              <th className="sortable" onClick={() => sortBy('nsn')}>NSN{arrow('nsn')}</th>
              <th>Nomenclature</th>
              <th>FSC</th>
              <th className="num sortable" onClick={() => sortBy('qty')}>Qty{arrow('qty')}</th>
              <th>Set-aside</th>
              <th>Tech docs</th>
              <th className="sortable" onClick={() => sortBy('issued')}>Issued{arrow('issued')}</th>
              <th className="sortable" onClick={() => sortBy('due')}>Due{arrow('due')}</th>
              <th>DIBBS</th>
            </tr>
          </thead>
          <tbody>
            {!data && !starredView &&
              Array.from({ length: 10 }, (_, i) => (
                <tr key={i} className="skel">
                  {Array.from({ length: 11 }, (_, j) => <td key={j} />)}
                </tr>
              ))}
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                className={`clickable ${triage.isHidden(r) ? 'hiddenrow' : ''} ${openKey === rowKey(r) ? 'selected' : ''}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a,button')) return
                  setOpenKey(rowKey(r))
                }}
              >
                <td className="star">
                  <button
                    className={`iconbtn ${triage.isStarred(r) ? 'on' : ''}`}
                    aria-label={triage.isStarred(r) ? 'Unstar' : 'Star'}
                    title={triage.isStarred(r) ? 'Remove star' : 'Star this RFQ'}
                    onClick={() => triage.toggleStar(r)}
                  >
                    {triage.isStarred(r) ? '★' : '☆'}
                  </button>
                </td>
                <td className="sol mono">
                  <a href={r.package_url} target="_blank" rel="noreferrer" title="Open this solicitation on DIBBS (Package View)">
                    {r.sol_display}
                  </a>
                  {r.fast_award ? <span className="badge b-amber" title="Fast Award Candidate: micro-purchase quotes may be awarded before the return date"> ⚡</span> : null}
                </td>
                <td className="mono nsn">
                  <a href={r.nsn_url} target="_blank" rel="noreferrer" title="NSN history on DIBBS">{r.nsn}</a>
                </td>
                <td className="nomen" title={r.nomenclature}>{r.nomenclature}</td>
                <td className="mono" title={r.fsc_name}>{r.fsc || '—'}</td>
                <td className="num">{r.qty?.toLocaleString() ?? '—'}</td>
                <td>
                  <span className={`badge ${isSmallBizAside(r.set_aside) ? 'b-green' : 'b-gray'}`} title={r.set_aside}>
                    {shortAside(r.set_aside)}
                  </span>
                </td>
                <td>{r.tech_docs && r.tech_docs !== 'None' ? <span className="badge b-gray">{r.tech_docs}</span> : <span className="muted">None</span>}</td>
                <td>{fmtDate(r.issue_date)}</td>
                <td><DueBadge days={r.days_left} iso={r.return_by} /></td>
                <td className="links">
                  <a href={r.pdf_url} target="_blank" rel="noreferrer" title="RFQ document (DIBBS asks you to accept the DoD notice first)">PDF</a>
                  <a href={r.quote_url} target="_blank" rel="noreferrer" title="Submit a quote on DIBBS">Quote</a>
                  <button className="iconbtn" onClick={() => triage.toggleHide(r)} title={triage.isHidden(r) ? 'Unhide' : 'Hide this RFQ (not for me)'}>
                    {triage.isHidden(r) ? '↺' : '✕'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(starredView || data) && rows.length === 0 && (
          <div className="empty">
            {starredView
              ? 'Nothing starred yet. Click ☆ on any row to keep it here.'
              : meta && meta.totals.total === 0
                ? 'No data yet. Click Refresh to pull the latest RFQs from DIBBS.'
                : hiddenOnPage > 0
                  ? 'Every RFQ on this page is hidden.'
                  : 'No RFQs match these filters.'}
          </div>
        )}
      </div>

      {openRow && (
        <Drawer
          row={openRow}
          index={openIdx}
          count={rows.length}
          starred={triage.isStarred(openRow)}
          hidden={triage.isHidden(openRow)}
          onClose={() => setOpenKey(null)}
          onMove={moveOpen}
          onStar={() => triage.toggleStar(openRow)}
          onHide={() => {
            // hiding removes the row from the list, so move on to its neighbour (or close)
            const next = rows[openIdx + 1] ?? rows[openIdx - 1]
            const willHide = !triage.isHidden(openRow)
            triage.toggleHide(openRow)
            if (willHide && !showHidden && !starredView) setOpenKey(next ? rowKey(next) : null)
          }}
          onSameNsn={() => {
            setStarredView(false)
            setOpenKey(null)
            // the server matches a pasted NSN exactly and part numbers by word search
            update({ ...DEFAULTS, q: openRow.nsn, includePast: true })
          }}
        />
      )}

      {!starredView && total > PAGE_SIZE && (
        <div className="pager">
          <span className="muted">
            {(f.page - 1) * PAGE_SIZE + 1}–{Math.min(f.page * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>← Prev</button>
          <span>Page {f.page} / {lastPage}</span>
          <button disabled={f.page >= lastPage} onClick={() => setF({ ...f, page: f.page + 1 })}>Next →</button>
        </div>
      )}
    </div>
  )
}
