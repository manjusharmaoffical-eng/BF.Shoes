const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+@-]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet formula execution when an exported field is opened in Excel/Sheets.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows, columns) {
  const header = columns.map(column => csvCell(column.label)).join(',');
  const body = rows.map(row => columns.map(column => csvCell(row[column.key])).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}
