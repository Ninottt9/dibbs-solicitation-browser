import { useEffect, useState } from 'react'
import type { Rfq } from '../lib'
import { fmtDate, isSmallBizAside } from '../lib'

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="linklike"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {done ? 'copied' : 'copy'}
    </button>
  )
}

const longDate = (iso: string) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function Drawer({
  row, index, count, starred, hidden, onClose, onMove, onStar, onHide, onSameNsn,
}: {
  row: Rfq
  index: number
  count: number
  starred: boolean
  hidden: boolean
  onClose: () => void
  onMove: (delta: number) => void
  onStar: () => void
  onHide: () => void
  onSameNsn: () => void
}) {
  // keyboard: Esc closes, ↑/↓ (or k/j) walk the list, s stars
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); onMove(1) }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); onMove(-1) }
      else if (e.key === 's') onStar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onMove, onStar])

  const d = row.days_left
  const dueCls = d == null ? '' : d <= 1 ? 'b-red' : d <= 5 ? 'b-amber' : 'b-green'
  const dueText = d == null ? '' : d < 0 ? `closed ${-d} day${-d === 1 ? '' : 's'} ago` : d === 0 ? 'due today' : `${d} day${d === 1 ? '' : 's'} left`

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`RFQ ${row.sol_display}`}>
        <div className="dhead">
          <div>
            <div className="mono sol">{row.sol_display}</div>
            <div className="dnomen">{row.nomenclature || '—'}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="dbody">
          <div className="dnav muted">
            <button type="button" onClick={() => onMove(-1)} disabled={index <= 0}>↑ Prev</button>
            <span>{index + 1} of {count}</span>
            <button type="button" onClick={() => onMove(1)} disabled={index >= count - 1}>Next ↓</button>
          </div>

          <div className="dsum">
            <span className={`badge ${dueCls}`}>{dueText || '—'}</span>
            <span className="muted">Return by {longDate(row.return_by)}</span>
            {row.fast_award ? <span className="badge b-amber" title="Micro-purchase quotes may be awarded before the return date">⚡ Fast award</span> : null}
          </div>

          <div className="dactions">
            <a className="btn primary" href={row.package_url} target="_blank" rel="noreferrer">Open on DIBBS</a>
            <a className="btn" href={row.quote_url} target="_blank" rel="noreferrer">Quote</a>
            <a className="btn" href={row.pdf_url} target="_blank" rel="noreferrer">RFQ PDF</a>
            <a className="btn" href={row.nsn_url} target="_blank" rel="noreferrer">NSN history</a>
          </div>

          <dl className="dgrid">
            <dt>NSN</dt>
            <dd><span className="mono">{row.nsn}</span> <Copy text={row.nsn} /></dd>
            <dt>Solicitation</dt>
            <dd><span className="mono">{row.sol_display}</span> <Copy text={row.sol_display} /></dd>
            <dt>Product class</dt>
            <dd>{row.fsc ? <><span className="mono">{row.fsc}</span> {row.fsc_name}</> : <span className="muted">— (part number, no NSN)</span>}</dd>
            <dt>Quantity</dt>
            <dd>{row.qty?.toLocaleString() ?? '—'}</dd>
            <dt>Purchase request</dt>
            <dd className="mono">{row.pr_no || '—'}</dd>
            <dt>Set-aside</dt>
            <dd><span className={`badge ${isSmallBizAside(row.set_aside) ? 'b-green' : 'b-gray'}`}>{row.set_aside || '—'}</span></dd>
            <dt>Tech docs</dt>
            <dd>{row.tech_docs && row.tech_docs !== 'None' ? row.tech_docs : row.status === '' ? 'Unknown' : 'None listed'}</dd>
            <dt>Status</dt>
            <dd>{row.status || 'Not checked yet'}</dd>
            <dt>{row.issue_date ? 'Issued' : 'Posted'}</dt>
            <dd>
              {row.issue_date
                ? `${fmtDate(row.issue_date)} · ${longDate(row.issue_date)}`
                : `${fmtDate(row.post_date ?? '')} · ${longDate(row.post_date ?? '')}`}
            </dd>
            <dt>Buying office</dt>
            <dd className="mono">{row.office_prefix}</dd>
          </dl>

          <div className="dactions">
            <button type="button" className={starred ? 'chip on' : 'chip'} onClick={onStar}>{starred ? '★ Starred' : '☆ Star'} <kbd>s</kbd></button>
            <button type="button" className="chip" onClick={onHide}>{hidden ? 'Unhide' : 'Hide this RFQ'}</button>
            <button type="button" className="chip" onClick={onSameNsn} title="Search every RFQ with this NSN, including closed ones">Other RFQs for this NSN</button>
          </div>

          {row.source === 'bulk' && row.status === '' && (
            <p className="notice" style={{ margin: 0 }}>
              This RFQ came from DIBBS’s daily bulk file, which has no status, tech-docs or fast-award flags and no issue date.
              Open it on DIBBS to confirm it is still open; a Refresh fills these in once the site list includes it.
            </p>
          )}

          <p className="muted dnote">
            DIBBS shows its DoD consent notice the first time you open a link, and the PDF lives on a second DIBBS host with its own notice.
            Star and hide are saved in this browser only.
          </p>
        </div>
      </aside>
    </>
  )
}
