import type { Filters } from '../lib'
import { DEFAULTS, shortAside, splitList } from '../lib'

interface Pill { key: string; label: string; title?: string; clear: Partial<Filters> }

/** One removable pill per active filter, so the current view is always readable at a glance. */
export default function Pills({
  f, fscName, smallBiz, onChange, onClearAll,
}: {
  f: Filters
  fscName: (code: string) => string
  smallBiz: string
  onChange: (patch: Partial<Filters>) => void
  onClearAll: () => void
}) {
  const pills: Pill[] = []
  if (f.q) pills.push({ key: 'q', label: `Search: “${f.q}”`, clear: { q: '' } })
  const codes = splitList(f.fsc)
  for (const c of codes) {
    const name = fscName(c)
    pills.push({
      key: `fsc-${c}`,
      label: name ? `${c} ${name}` : c,
      title: 'Product class',
      clear: { fsc: codes.filter((x) => x !== c).join(',') },
    })
  }
  if (f.setAside) {
    pills.push({
      key: 'aside',
      label: f.setAside === smallBiz ? 'Small business (all types)' : shortAside(f.setAside),
      title: f.setAside,
      clear: { setAside: '' },
    })
  }
  if (f.office) pills.push({ key: 'office', label: `Office ${f.office}`, clear: { office: '' } })
  if (f.techDocs) pills.push({ key: 'docs', label: f.techDocs === 'yes' ? 'Has tech docs' : 'No tech docs', clear: { techDocs: '' } })
  if (f.dueWithinDays) pills.push({ key: 'due', label: `Due within ${f.dueWithinDays}d`, clear: { dueWithinDays: '' } })
  if (f.qtyMin) pills.push({ key: 'qty', label: `Qty ≥ ${f.qtyMin}`, clear: { qtyMin: '' } })
  if (f.cage.length === 5) pills.push({ key: 'cage', label: `Approved source: ${f.cage}`, clear: { cage: '' } })
  if (f.onlyNew) pills.push({ key: 'new', label: '🆕 New since last visit', clear: { onlyNew: false } })
  if (f.fastAward) pills.push({ key: 'fast', label: '⚡ Fast award', clear: { fastAward: false } })
  if (f.includePast) pills.push({ key: 'past', label: 'Incl. closed / past due', clear: { includePast: DEFAULTS.includePast } })
  if (!pills.length) return null

  return (
    <div className="pills" aria-label="Active filters">
      {pills.map((p) => (
        <span className="pill" key={p.key} title={p.title}>
          {p.label}
          <button type="button" aria-label={`Remove filter ${p.label}`} onClick={() => onChange(p.clear)}>×</button>
        </span>
      ))}
      <button type="button" className="linklike" onClick={onClearAll}>Clear all</button>
    </div>
  )
}
