export interface Rfq {
  sol_no: string; sol_display: string; nsn: string; fsc: string; fsc_name: string; nomenclature: string
  tech_docs: string; set_aside: string; status: string; pr_no: string; qty: number | null
  issue_date: string; return_by: string; office_prefix: string
  pdf_url: string; package_url: string; nsn_url: string; quote_url: string
  days_left: number | null; fast_award: number; source: string; post_date: string | null; first_seen_at: string
}
export interface Opt { value: string; n: number; name?: string }
export interface Meta {
  today: string; fscs: Opt[]; setAsides: Opt[]; offices: Opt[]
  totals: { total: number; open: number; latestIssue: string }
  lastRun: { finished_at: string; date: string; rows: number; expected: number; status: string } | null
  ingesting: boolean; phase: string; newCount: number
  autoRefresh: { enabled: boolean; next: string; lastError: string }
  coverage: { from: string | null; to: string | null; bulkRows: number }
}
export interface Filters {
  q: string; fsc: string; setAside: string; office: string; techDocs: string
  dueWithinDays: string; qtyMin: string; includePast: boolean; fastAward: boolean; onlyNew: boolean
  sort: string; dir: string; page: number
}

export const DEFAULTS: Filters = {
  q: '', fsc: '', setAside: '', office: '', techDocs: '', dueWithinDays: '', qtyMin: '',
  includePast: false, fastAward: false, onlyNew: false, sort: 'due', dir: 'asc', page: 1,
}
export const PAGE_SIZE = 50

export const rowKey = (r: Pick<Rfq, 'sol_no' | 'nsn' | 'pr_no'>) => `${r.sol_no}|${r.nsn}|${r.pr_no}`

export function fromUrl(): Filters {
  const p = new URLSearchParams(location.search)
  const f = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const v = p.get(k)
    if (v == null) continue
    if (k === 'includePast' || k === 'fastAward' || k === 'onlyNew') f[k] = v === '1'
    else if (k === 'page') f.page = Math.max(1, Number(v) || 1)
    else (f[k] as string) = v
  }
  return f
}

export function toParams(f: Filters) {
  const p = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
    const v = f[k]
    if (v === DEFAULTS[k] || v === '') continue
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  return p
}

/** The filter part of the query string, shared by the table and the CSV export. */
export function filterQuery(f: Filters, baseline?: string | null) {
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
  if (f.onlyNew && baseline) p.set('newSince', baseline)
  p.set('sort', f.sort)
  p.set('dir', f.dir)
  return p
}

export const fmtDate = (iso: string) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export function shortAside(s: string) {
  if (!s) return '—'
  if (/unrestricted/i.test(s)) return 'Unrestricted'
  return s.replace(/ Set-Aside/i, '')
}
export const isSmallBizAside = (s: string) => /small|8\(a\)|hubzone|service|women/i.test(s)

export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
