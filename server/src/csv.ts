/** CSV for Excel: UTF-8 BOM, CRLF rows, quoted cells, and formula-injection guarding. */
export const CSV_BOM = '﻿';

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // a cell that starts with = + - @ is executed as a formula by Excel/Sheets; neutralise it
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';

/** Column order is the same as the table, plus the DIBBS links. */
export const RFQ_COLUMNS: { header: string; get: (r: Record<string, unknown>) => unknown }[] = [
  { header: 'Solicitation', get: (r) => r.sol_display },
  { header: 'NSN', get: (r) => r.nsn },
  { header: 'Nomenclature', get: (r) => r.nomenclature },
  { header: 'FSC', get: (r) => r.fsc },
  { header: 'Product class', get: (r) => r.fsc_name },
  { header: 'Qty', get: (r) => r.qty },
  { header: 'Set-aside', get: (r) => r.set_aside },
  { header: 'Tech docs', get: (r) => r.tech_docs },
  { header: 'Fast award', get: (r) => (r.fast_award ? 'Yes' : '') },
  { header: 'Status', get: (r) => r.status },
  { header: 'PR number', get: (r) => r.pr_no },
  { header: 'Issued', get: (r) => r.issue_date },
  { header: 'Return by', get: (r) => r.return_by },
  { header: 'Days left', get: (r) => r.days_left },
  { header: 'Approved sources listed', get: (r) => r.src_n },
  { header: 'Buying office', get: (r) => r.office_prefix },
  { header: 'DIBBS package view', get: (r) => r.package_url },
  { header: 'RFQ PDF', get: (r) => r.pdf_url },
  { header: 'NSN page', get: (r) => r.nsn_url },
];
