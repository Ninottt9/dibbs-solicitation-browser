// "New since your last visit": a baseline time per browser tab, so a reload doesn't wipe the badges.
//  - localStorage keeps when you were last here (touched while the tab is open),
//  - sessionStorage pins the baseline for this tab, taken from that value when the tab opens.
const LAST = 'dibbs.lastVisit.v1'
const BASE = 'dibbs.baseline.v1'

const read = (s: Storage, k: string) => {
  try { return s.getItem(k) } catch { return null }
}
const write = (s: Storage, k: string, v: string) => {
  try { s.setItem(k, v) } catch { /* storage blocked: badges just won't persist */ }
}

/** Baseline for this tab (null on a first-ever visit). Call once, before touchVisit(). */
export function initBaseline(): string | null {
  const pinned = read(sessionStorage, BASE)
  if (pinned !== null) return pinned || null
  const prev = read(localStorage, LAST)
  write(sessionStorage, BASE, prev ?? '')
  return prev
}

export const touchVisit = () => write(localStorage, LAST, new Date().toISOString())

/** "Mark all as seen": everything currently listed stops being new. */
export function markSeen(): string {
  const now = new Date().toISOString()
  write(sessionStorage, BASE, now)
  touchVisit()
  return now
}
