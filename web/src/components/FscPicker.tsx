import { useEffect, useMemo, useRef, useState } from 'react'
import type { Opt } from '../lib'
import { splitList } from '../lib'

/** Multi-select product-class (FSC) picker: type to search by code or official name. */
export default function FscPicker({
  options, value, onChange,
}: { options: Opt[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => new Set(splitList(value)), [value])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const t = term.trim().toLowerCase()
  const shown = useMemo(
    () => options.filter((o) => !t || o.value.startsWith(t) || (o.name ?? '').toLowerCase().includes(t)),
    [options, t],
  )

  const toggle = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next].join(','))
  }

  return (
    <div className="picker" ref={box}>
      <button type="button" className={selected.size ? 'chip on' : ''} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Product class{selected.size ? ` (${selected.size})` : ''} ▾
      </button>
      {open && (
        <div className="popover" role="listbox" aria-multiselectable>
          <input
            autoFocus
            type="search"
            placeholder="Search class, e.g. hose, 5340, medical…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <div className="popmeta muted">
            <span>{shown.length} of {options.length} classes</span>
            {selected.size > 0 && <button type="button" className="linklike" onClick={() => onChange('')}>Clear selection</button>}
          </div>
          <ul>
            {shown.map((o) => (
              <li key={o.value}>
                <label>
                  <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                  <span className="mono">{o.value}</span>
                  <span className="pname">{o.name || '—'}</span>
                  <span className="muted">{o.n}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="muted pad">No matching class</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
