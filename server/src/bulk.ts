import { unzipSync } from 'fflate';
import { BASE, get, getBuffer } from './client.js';
import type { Rfq } from './scrape.js';

/**
 * DIBBS's official bulk files ("RFQ Download files" page): one fixed-width index per post date.
 * One small file replaces ~31 throttled page requests, so it is how older days are backfilled.
 *
 * Caveats found while checking it against the site:
 *  - the file date is the POST date, not the "Issued" date shown on the site (many RFQs posted on
 *    10-21 are issued 10-22), so bulk rows carry post_date and leave issue_date empty;
 *  - it has no status, tech-docs or fast-award flags, so those stay unknown until the scraper sees the row;
 *  - today's file is only published the next day.
 */

export interface BulkDay {
  date: string; // post date, ISO
  indexUrl: string;
  bqUrl: string; // batch-quote zip (also holds the approved-sources file)
}

const RECENT = '/RFQ/RFQDates.aspx?category=recent';

/** Days offered on the Recent RFQ page, newest first. Links are read from the page, not guessed. */
export async function listBulkDays(): Promise<BulkDay[]> {
  const r = await get(RECENT);
  const byDate = new Map<string, Partial<BulkDay>>();
  for (const m of r.html.matchAll(/href=['"]([^'"]*\/(in|bq)(\d{2})(\d{2})(\d{2})\.(?:txt|zip))['"]/gi)) {
    const [, url, kind, yy, mm, dd] = m;
    const date = `20${yy}-${mm}-${dd}`;
    const d = byDate.get(date) ?? { date };
    if (kind.toLowerCase() === 'in') d.indexUrl = url;
    else d.bqUrl = url;
    byDate.set(date, d);
  }
  return [...byDate.values()]
    .filter((d): d is BulkDay => !!d.indexUrl && !!d.bqUrl)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Column widths from the "RFQ file layout" help page; every real line is exactly 140 characters.
const WIDTHS = [13, 46, 13, 8, 19, 7, 2, 21, 5, 1, 1, 1, 3] as const;
const LINE_LEN = WIDTHS.reduce((a, b) => a + b, 0);

const ASIDE: Record<string, string> = {
  N: 'Unrestricted/Not Set Aside',
  Y: 'Small Business Set-Aside',
  H: 'HubZone Set-Aside',
  R: 'Service Disabled Veteran Owned Small Business (SDVosb) Set-Aside',
  L: 'Woman Owned Small Business (WOSB) Set-Aside',
  A: '8(a) Set-Aside',
  E: 'Economically Disadvantaged Woman Owned Small Business (EDWOSB) Set-Aside',
};

const dashNsn = (n: string) => (/^\d{13}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 9)}-${n.slice(9)}` : n);
// bulk nomenclature is "PAD,HELMET,AIRCRAFT" (no spaces) while the site shows "PAD, HELMET, AIRCRAFT"
const prettyNomen = (s: string) => s.replace(/,(?=\S)/g, ', ');
const mdy = (s: string) => {
  const m = s.match(/^(\d\d)\/(\d\d)\/(\d\d)$/);
  return m ? `20${m[3]}-${m[1]}-${m[2]}` : '';
};

export interface BulkRfq extends Rfq {
  post_date: string;
}

/** Pure: index-file text -> rows shaped like scraped ones (unknown fields left empty). */
export function parseIndex(text: string, postDate: string): BulkRfq[] {
  const rows: BulkRfq[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < LINE_LEN - 10) continue;
    let o = 0;
    const f = WIDTHS.map((w) => {
      const s = line.slice(o, o + w).trim();
      o += w;
      return s;
    });
    const [sol_no, nsnRaw, pr_no, ret, , qty, , nomen, , , itemType, aside] = f;
    if (!sol_no || !nsnRaw) continue;
    const sol_display = /^(.{6})(\d\d)(.)(\d{4})$/.exec(sol_no)?.slice(1).join('-') ?? sol_no;
    const nsn = itemType === '2' ? nsnRaw : dashNsn(nsnRaw);
    const nsn13 = nsnRaw.replace(/\D/g, '');
    rows.push({
      sol_no,
      sol_display,
      nsn,
      nsn13,
      fsc: itemType !== '2' && /^\d{13}$/.test(nsnRaw) ? nsnRaw.slice(0, 4) : '',
      nomenclature: prettyNomen(nomen),
      tech_docs: '',
      set_aside: ASIDE[aside] ?? '',
      fast_award: 0,
      status: '',
      pr_no,
      qty: qty ? Number(qty) : null,
      issue_date: '',
      return_by: mdy(ret),
      office_prefix: sol_no.slice(0, 6),
      // the PDF folder is the last digit of the solicitation number (checked against scraped links)
      pdf_url: `https://dibbs2.bsm.dla.mil/Downloads/RFQ/${sol_no.slice(-1)}/${sol_no}.PDF`,
      package_url: `${BASE}/rfq/rfqrec.aspx?sn=${sol_no}`,
      nsn_url: `${BASE}/RFQ/RFQNsn.aspx?value=${nsn13}&category=issue&Scope=`,
      quote_url: `${BASE}/RA/Quote/QuoteFrm.aspx?sn=${sol_no}`,
      post_date: postDate,
    });
  }
  return rows;
}

/** Download and parse one day's index file (the second DIBBS host has its own consent, handled by the client). */
export async function fetchIndex(day: BulkDay): Promise<BulkRfq[]> {
  const r = await get(day.indexUrl);
  if (/<html/i.test(r.html.slice(0, 200))) throw new Error(`unexpected HTML instead of index file for ${day.date}`);
  return parseIndex(r.html, day.date);
}

// ---- approved sources -------------------------------------------------------------------------
// Each day's batch-quote zip (bq<yymmdd>.zip) also holds as<yymmdd>.txt: for each NSN, the sources DLA
// has approved (CAGE code + part number, company name when it has one). That is the competition
// and "am I eligible" signal, without opening a single PDF.

export interface ApprovedSource {
  nsn13: string;
  cage: string;
  part_no: string;
  company: string;
}

/** One CSV line with double-quoted fields (and "" escapes). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Pure: as-file text -> rows. Lines without an NSN or CAGE are skipped. */
export function parseApproved(text: string): ApprovedSource[] {
  const rows: ApprovedSource[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [nsn, cage, part, company] = csvFields(line).map((s) => s.trim());
    const nsn13 = (nsn ?? '').replace(/\D/g, '');
    if (!nsn13 || !cage) continue;
    rows.push({ nsn13, cage: cage.toUpperCase(), part_no: part ?? '', company: company ?? '' });
  }
  return rows;
}

export async function fetchApprovedSources(day: BulkDay): Promise<ApprovedSource[]> {
  const zip = await getBuffer(day.bqUrl);
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => /(^|\/)as\d{6}\.txt$/i.test(f.name) });
  const file = Object.values(files)[0];
  if (!file) throw new Error(`no approved-sources file inside ${day.bqUrl}`);
  return parseApproved(new TextDecoder('iso-8859-1').decode(file));
}
