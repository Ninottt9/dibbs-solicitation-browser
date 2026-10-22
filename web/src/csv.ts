import type { Rfq } from './lib'

// Client-side CSV, used for the starred view (starred RFQs only exist in this browser).
// Filtered results use the server's /api/rfqs/export.csv, which exports every matching row.
const COLUMNS: [string, (r: Rfq) => unknown][] = [
  ['Solicitation', (r) => r.sol_display],
  ['NSN', (r) => r.nsn],
  ['Nomenclature', (r) => r.nomenclature],
  ['FSC', (r) => r.fsc],
  ['Product class', (r) => r.fsc_name],
  ['Qty', (r) => r.qty],
  ['Set-aside', (r) => r.set_aside],
  ['Tech docs', (r) => r.tech_docs],
  ['Fast award', (r) => (r.fast_award ? 'Yes' : '')],
  ['Status', (r) => r.status],
  ['PR number', (r) => r.pr_no],
  ['Issued', (r) => r.issue_date],
  ['Return by', (r) => r.return_by],
  ['Days left', (r) => r.days_left],
  ['Buying office', (r) => r.office_prefix],
  ['DIBBS package view', (r) => r.package_url],
  ['RFQ PDF', (r) => r.pdf_url],
  ['NSN page', (r) => r.nsn_url],
]

function cell(v: unknown) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s // block spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadRfqCsv(rows: Rfq[], filename: string) {
  const lines = [COLUMNS.map(([h]) => h), ...rows.map((r) => COLUMNS.map(([, get]) => get(r)))]
  const body = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
