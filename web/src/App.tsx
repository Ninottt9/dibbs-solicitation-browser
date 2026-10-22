import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Rfq {
  sol_no: string; sol_display: string; nsn: string; fsc: string; nomenclature: string
  tech_docs: string; set_aside: string; status: string; pr_no: string; qty: number | null
  issue_date: string; return_by: string; office_prefix: string
  pdf_url: string; package_url: string; nsn_url: string; quote_url: string; days_left: number | null; fast_award: number
}
interface Opt { value: string; n: number; sample?: string }
interface Meta {
  today: string; fscs: Opt[]; setAsides: Opt[]; offices: Opt[]
  totals: { total: number; open: number; latestIssue: string }
  lastRun: { finished_at: string; date: string; rows: number; expected: number; status: string } | null
  ingesting: boolean
}
interface Filters {
  q: string; fsc: string; setAside: string; office: string; techDocs: string
  dueWithinDays: string; qtyMin: string; includePast: boolean; fastAward: boolean; sort: string; dir: string; page: number
}

const DEFAULTS: Filters = {
  q: '', fsc: '', setAside: '', office: '', techDocs: '', dueWithinDays: '', qtyMin: '',
  includePast: false, fastAward: false, sort: 'due', dir: 'asc', page: 1,
}
const PAGE_SIZE = 50

function fromUrl(): Filters {
  const p = new URLSearchParams(location.search)
  const f = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const v = p.get(k)
    if (v == null) continue
    if (k === 'includePast' || k === 'fastAward') f[k] = v === '1'
    else if (k === 'page') f.page = Math.max(1, Number(v) || 1)
    else (f[k] as string) = v
  }
  return f
}

function toParams(f: Filters) {
  const p = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const v = f[k]
    if (v === DEFAULTS[k] || v === '') continue
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  return p
}

const fmtDate = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

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

function shortAside(s: string) {
  if (!s) return '—'
  if (/unrestricted/i.test(s)) return 'Unrestricted'
  return s.replace(/ Set-Aside/i, '')
}

export default function App() {
  const [f, setF] = useState<Filters>(fromUrl)
  const [qInput, setQInput] = useState(f.q)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [data, setData] = useState<{ items: Rfq[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reqId = useRef(0)

  const update = useCallback((patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, page: 1, ...patch }))
  }, [])

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => qInput !== f.q && update({ q: qInput }), 250)
    return () => clearTimeout(t)
  }, [qInput, f.q, update])

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
    const t = setInterval(async () => {
      await loadMeta()
    }, 2500)
    return () => clearInterval(t)
  }, [meta?.ingesting, loadMeta])

  const wasIngesting = useRef(false)
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    if (wasIngesting.current && meta && !meta.ingesting) setRefreshTick((n) => n + 1)
    wasIngesting.current = !!meta?.ingesting
  }, [meta])

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (f.q) p.set('q', f.q)
    if (f.fsc) p.set('fsc', f.fsc)
    if (f.setAside) p.set('setAside', f.setAside)
    if (f.office) p.set('office', f.office)
    if (f.techDocs) p.set('techDocs', f.techDocs)
    if (f.dueWithinDays) p.set('dueWithinDays', f.dueWithinDays)
    if (f.qtyMin) p.set('qtyMin', f.qtyMin)
    if (f.includePast) p.set('includePast', '1')
    if (f.fastAward) p.set('fastAward', '1')
    p.set('sort', f.sort); p.set('dir', f.dir)
    p.set('page', String(f.page)); p.set('pageSize', String(PAGE_SIZE))
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

  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const stale = meta?.lastRun && meta.lastRun.status !== 'ok'
  const dirty = Object.keys(DEFAULTS).some((k) => !['sort', 'dir', 'page'].includes(k) && f[k as keyof Filters] !== DEFAULTS[k as keyof Filters])

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

        <div className="row2">
          <select value={f.fsc} onChange={(e) => update({ fsc: e.target.value })} title="Federal Supply Class — the product category">
            <option value="">All product classes (FSC)</option>
            {meta?.fscs.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} · {o.sample} ({o.n})
              </option>
            ))}
          </select>
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
          {dirty && (
            <button
              onClick={() => {
                setQInput('')
                setF({ ...DEFAULTS })
              }}
            >
              Clear filters
            </button>
          )}
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {loading && !data ? 'Loading…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {error && <div className="err">Couldn’t load RFQs: {error}. The server may be down.</div>}

      <div className="tablewrap" style={{ opacity: loading && data ? 0.6 : 1, transition: 'opacity .15s' }}>
        <table>
          <thead>
            <tr>
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
            {!data &&
              Array.from({ length: 10 }, (_, i) => (
                <tr key={i} className="skel">
                  {Array.from({ length: 10 }, (_, j) => <td key={j} />)}
                </tr>
              ))}
            {data?.items.map((r) => (
              <tr key={`${r.sol_no}|${r.nsn}|${r.pr_no}`}>
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
                <td className="mono">{r.fsc || '—'}</td>
                <td className="num">{r.qty?.toLocaleString() ?? '—'}</td>
                <td>
                  <span className={`badge ${/small|8\(a\)|hubzone|service|women/i.test(r.set_aside) ? 'b-green' : 'b-gray'}`} title={r.set_aside}>
                    {shortAside(r.set_aside)}
                  </span>
                </td>
                <td>{r.tech_docs && r.tech_docs !== 'None' ? <span className="badge b-gray">{r.tech_docs}</span> : <span className="muted">None</span>}</td>
                <td>{fmtDate(r.issue_date)}</td>
                <td><DueBadge days={r.days_left} iso={r.return_by} /></td>
                <td className="links">
                  <a href={r.pdf_url} target="_blank" rel="noreferrer" title="RFQ document (DIBBS asks you to accept the DoD notice first)">PDF</a>
                  <a href={r.quote_url} target="_blank" rel="noreferrer" title="Submit a quote on DIBBS">Quote</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && (
          <div className="empty">
            {meta && meta.totals.total === 0 ? 'No data yet. Click Refresh to pull the latest RFQs from DIBBS.' : 'No RFQs match these filters.'}
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
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
