import { db } from './db.js';
import { isIngesting, runRefresh } from './ingest.js';

/**
 * Opt-in background refresh (`npm run start:live`): hourly, weekdays, 8:00-18:00 US Eastern, which is
 * when DIBBS posts. Each run reads the newest day from the site and loads any bulk days we're missing;
 * the first run of each Eastern day also re-reads the previous issue day so statuses don't go stale.
 */

const TZ = 'America/New_York';
const FIRST_HOUR = 8;
const LAST_HOUR = 18;
const STALE_MS = 2 * 3600_000; // on start-up, catch up if the last site read is older than this

interface EtParts { dow: string; date: string; hour: number; minute: number }
function etParts(d: Date): EtParts {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { dow: p.weekday, date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
const isBusinessSlot = (p: EtParts) => !['Sat', 'Sun'].includes(p.dow) && p.hour >= FIRST_HOUR && p.hour <= LAST_HOUR;

/** The next top-of-the-hour slot after `from`, as a label like "Thu 9:00 AM ET". */
export function nextSlotLabel(from = new Date()): string {
  const t = new Date(Math.ceil((from.getTime() + 1) / 3600_000) * 3600_000); // next whole UTC hour == whole ET hour (whole-hour offsets)
  for (let i = 0; i < 24 * 8; i++, t.setTime(t.getTime() + 3600_000)) {
    if (isBusinessSlot(etParts(t))) {
      return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t) + ' ET';
    }
  }
  return '';
}

const state = { enabled: false, lastSlot: '', lastError: '' as string };
export const autoRefreshInfo = () => ({
  enabled: state.enabled,
  next: state.enabled ? nextSlotLabel() : '',
  lastError: state.lastError,
});

async function tick(log: (m: string) => void) {
  const now = etParts(new Date());
  const slot = `${now.date}-${now.hour}`;
  if (!isBusinessSlot(now) || slot === state.lastSlot || isIngesting()) return;
  state.lastSlot = slot;
  const lastOk = db.prepare("SELECT MAX(started_at) t FROM ingest_run WHERE mode='site' AND status IN ('ok','partial')").get() as { t: string | null };
  const firstOfDay = !lastOk.t || etParts(new Date(lastOk.t)).date !== now.date;
  log(`auto-refresh ${slot}${firstOfDay ? ' (first of day: also previous issue day)' : ''}`);
  try {
    await runRefresh(log, { previousDay: firstOfDay });
    state.lastError = '';
  } catch (e) {
    state.lastError = String(e);
    log(`auto-refresh failed: ${e}`);
  }
}

export function startScheduler(log: (m: string) => void = console.log) {
  state.enabled = true;
  setInterval(() => void tick(log), 60_000).unref?.();
  // catch up straight away if we've been off for a while during business hours
  const last = db.prepare("SELECT MAX(finished_at) t FROM ingest_run WHERE mode='site' AND status IN ('ok','partial')").get() as { t: string | null };
  const age = last.t ? Date.now() - Date.parse(last.t) : Infinity;
  if (age > STALE_MS) setTimeout(() => void tick(log), 5_000);
  log(`auto-refresh on: hourly, weekdays ${FIRST_HOUR}:00-${LAST_HOUR}:00 ET; next ${nextSlotLabel()}`);
}
