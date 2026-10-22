import { writeFileSync } from 'node:fs';
import { get } from './client.js';
const e = await get('/RFQ/');
console.log('entry', e.url, e.html.length);
const d = await get('/Rfq/RfqDates.aspx?category=issue');
writeFileSync('fixtures/dates.html', d.html);
console.log('dates', d.url, d.html.length);
const m = [...d.html.matchAll(/Value=(\d\d-\d\d-\d{4})/g)].map((x) => x[1]);
console.log([...new Set(m)].slice(0, 5));
