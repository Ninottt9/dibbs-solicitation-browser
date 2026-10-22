import * as cheerio from 'cheerio';
import { BASE, get, hiddenFields, post } from './client.js';

export interface Rfq {
  sol_no: string; // normalized, no dashes
  sol_display: string;
  nsn: string; // as shown, e.g. 8475-01-537-3803 (may be a part number)
  nsn13: string; // digits only
  fsc: string; // first 4 digits of the NSN
  nomenclature: string;
  tech_docs: string;
  set_aside: string;
  status: string;
  pr_no: string;
  qty: number | null;
  issue_date: string; // ISO yyyy-mm-dd
  return_by: string; // ISO yyyy-mm-dd
  office_prefix: string;
  pdf_url: string;
  package_url: string;
  nsn_url: string;
  quote_url: string;
}

const clean = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const isoDate = (s: string) => {
  const m = clean(s).match(/^(\d\d)-(\d\d)-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
};

/** Pure: grid HTML -> rows. Every field is optional-safe. */
export function parseGrid(html: string): Rfq[] {
  const $ = cheerio.load(html);
  const rows: Rfq[] = [];
  $('tr.BgWhite, tr.BgSilver').each((_, tr) => {
    const f = (k: string) => $(tr).find(`span[id$="${k}"]`).first();
    const nsnA = f('lblNsn').find('a').first();
    const nsn = clean(nsnA.text() || f('lblNsn').text());
    const solSpan = f('lblSolicitation');
    const solA = solSpan.find('a').first();
    const sol_display = clean(solA.text());
    if (!sol_display) return;
    const pr = (f('lblPr').html() ?? '').split(/<br\s*\/?>/i).map((x) => clean(cheerio.load(x).text()));
    const qtyM = (pr[1] ?? '').match(/QTY:\s*([\d,]+)/i);
    const nsn13 = nsn.replace(/\D/g, '');
    const sol_no = sol_display.replace(/-/g, '');
    rows.push({
      sol_no,
      sol_display,
      nsn,
      nsn13,
      fsc: /^\d{13}$/.test(nsn13) ? nsn13.slice(0, 4) : '',
      nomenclature: clean(f('lblNomenclature').text()),
      tech_docs: clean(f('lblTechnicalDocuments').text()),
      set_aside: clean(solSpan.find('img').first().attr('alt') ?? ''),
      status: clean(f('lblStatus').children('span').first().text() || f('lblStatus').text()),
      pr_no: pr[0] ?? '',
      qty: qtyM ? Number(qtyM[1].replace(/,/g, '')) : null,
      issue_date: isoDate(f('lblIssued').text()),
      return_by: isoDate(f('lblReturnBy').text()),
      office_prefix: sol_no.slice(0, 6),
      pdf_url: solA.attr('href') ?? '',
      package_url: solSpan.find('a.SubMenuLink').attr('href') ?? `${BASE}/rfq/rfqrec.aspx?sn=${sol_no}`,
      nsn_url: nsnA.attr('href') ?? '',
      quote_url: f('lblStatus').find('a').first().attr('href') ?? '',
    });
  });
  return rows;
}

export const parseTotal = (html: string) => {
  const m = html.match(/Records Found:\s*<strong>\s*([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
};

/** Issue dates listed on DIBBS, newest first (kept as DIBBS spells them, MM-DD-YYYY). */
export async function listDates(): Promise<string[]> {
  const r = await get('/Rfq/RfqDates.aspx?category=issue');
  const all = [...new Set([...r.html.matchAll(/Value=(\d\d-\d\d-\d{4})/g)].map((m) => m[1]))];
  return all.sort((a, b) => isoDate(b).localeCompare(isoDate(a)));
}

/**
 * Fetch every page of one issue day. ASP.NET postbacks chain VIEWSTATE, so pages are strictly
 * sequential. We stop when the pager no longer offers Page$N+1 (it shows "..." after page 10,
 * which still links to the next page) rather than trusting the visible numbers.
 */
export async function ingestDay(
  date: string,
  onPage: (rows: Rfq[], page: number, total: number) => void,
  maxPages = 100,
) {
  let r = await get(`/RFQ/RfqRecs.aspx?category=issue&TypeSrch=dt&Value=${date}`);
  const total = parseTotal(r.html);
  let page = 1;
  let seen = 0;
  for (;;) {
    const rows = parseGrid(r.html);
    seen += rows.length;
    onPage(rows, page, total);
    const next = page + 1;
    const hasNext = r.html.includes(`Page$${next}&#39;`) || r.html.includes(`Page$${next}'`);
    if (!rows.length || page >= maxPages || !hasNext) break;
    const body = hiddenFields(cheerio.load(r.html));
    body.set('__EVENTTARGET', 'ctl00$cph1$grdRfqSearch');
    body.set('__EVENTARGUMENT', `Page$${next}`);
    try {
      r = await post(r.url, body);
    } catch (e) {
      // one retry for a hung/failed request; a lost session ends this day's crawl (rows so far are kept)
      if ((e as Error).message === 'SESSION_LOST') throw e;
      r = await post(r.url, body);
    }
    page = next;
  }
  return { pages: page, seen, total };
}
