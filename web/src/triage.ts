import { useCallback, useEffect, useState } from 'react'
import { rowKey, type Rfq } from './lib'

const KEY = 'dibbs.triage.v1'

interface State {
  starred: Record<string, Rfq> // full snapshot, so the starred list works without the server's filters
  hidden: Record<string, true>
}
const EMPTY: State = { starred: {}, hidden: {} }

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const s = JSON.parse(raw)
    return { starred: s.starred ?? {}, hidden: s.hidden ?? {} }
  } catch {
    return EMPTY
  }
}

/** Per-browser triage: star RFQs you care about, hide the ones you've ruled out. Survives reloads. */
export function useTriage() {
  const [state, setState] = useState<State>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* private mode / quota: triage just won't persist */
    }
  }, [state])

  // keep two open tabs in step
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState(load()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggleStar = useCallback((r: Rfq) => {
    const k = rowKey(r)
    setState((s) => {
      const starred = { ...s.starred }
      if (starred[k]) delete starred[k]
      else starred[k] = r
      return { ...s, starred }
    })
  }, [])

  const toggleHide = useCallback((r: Rfq) => {
    const k = rowKey(r)
    setState((s) => {
      const hidden = { ...s.hidden }
      if (hidden[k]) delete hidden[k]
      else hidden[k] = true
      return { ...s, hidden }
    })
  }, [])

  return {
    starred: Object.values(state.starred),
    starredCount: Object.keys(state.starred).length,
    hiddenCount: Object.keys(state.hidden).length,
    isStarred: (r: Rfq) => !!state.starred[rowKey(r)],
    isHidden: (r: Rfq) => !!state.hidden[rowKey(r)],
    toggleStar,
    toggleHide,
    clearHidden: () => setState((s) => ({ ...s, hidden: {} })),
  }
}
