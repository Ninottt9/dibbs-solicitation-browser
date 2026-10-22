import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const BASE = 'https://www.dibbs.bsm.dla.mil';
const TIMEOUT_S = 25;
const MIN_GAP_MS = 800;
const JAR = join(tmpdir(), 'dibbs-cookies.txt');

let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP call via curl. DIBBS sits behind an F5 WAF that answers Node's TLS fingerprint with
 * "Request Rejected" but accepts curl's, so curl is the transport. It also gives us the cookie
 * jar, redirect following and a hard timeout.
 */
async function http(url: string, body?: URLSearchParams): Promise<{ html: string; url: string }> {
  const wait = MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const args = [
    '-sS', '-L', '--max-redirs', '8', '--max-time', String(TIMEOUT_S), '--compressed',
    '-A', UA, '-b', JAR, '-c', JAR,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-w', '\n%{url_effective}',
  ];
  if (body) args.push('--data-binary', '@-', '-H', 'Content-Type: application/x-www-form-urlencoded');
  args.push(url);
  const out = await new Promise<Buffer>((resolve, reject) => {
    const p = execFile('curl', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`curl failed: ${stderr.toString() || err.message}`)) : resolve(stdout),
    );
    if (body) p.stdin!.end(body.toString());
  });
  const nl = out.lastIndexOf(10);
  return { html: new TextDecoder('iso-8859-1').decode(out.subarray(0, nl)), url: out.subarray(nl + 1).toString() };
}

export function hiddenFields($: cheerio.CheerioAPI): URLSearchParams {
  const p = new URLSearchParams();
  $('input[type=hidden]').each((_, el) => {
    const n = $(el).attr('name');
    if (n) p.set(n, $(el).attr('value') ?? '');
  });
  return p;
}

const isConsent = (url: string, html: string) => /dodwarning/i.test(url) || /butAgree/.test(html);

async function consent(html: string, url: string) {
  const $ = cheerio.load(html);
  const p = hiddenFields($);
  p.set('butAgree', 'OK');
  const action = new URL($('form').attr('action') ?? 'dodwarning.aspx', url).toString();
  await http(action, p);
}

/** GET a page, clearing the consent wall transparently (once). */
export async function get(path: string) {
  const url = path.startsWith('http') ? path : BASE + path;
  let r = await http(url);
  if (isConsent(r.url, r.html)) {
    await consent(r.html, r.url);
    r = await http(url);
  }
  return r;
}

/** POST a postback. A dropped session surfaces as SESSION_LOST so the caller can re-consent. */
export async function post(url: string, body: URLSearchParams) {
  const r = await http(url, body);
  if (isConsent(r.url, r.html)) throw new Error('SESSION_LOST');
  return r;
}
