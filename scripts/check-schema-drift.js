import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function splitTopLevel(definition) {
  const parts = [];
  let start = 0, depth = 0, quote = null;
  for (let i = 0; i < definition.length; i++) {
    const char = definition[i];
    if (quote) {
      if (char === quote && definition[i + 1] === quote) { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) { parts.push(definition.slice(start, i)); start = i + 1; }
  }
  parts.push(definition.slice(start));
  return parts;
}

function closingParen(source, openAt) {
  let depth = 0, quote = null;
  for (let i = openAt; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i + 1] === quote) { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) return i;
  }
  throw new Error('Unclosed table definition in schema.sql');
}

export function extractSchemaExpectations(sql) {
  const tables = new Map();
  const tablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const match of sql.matchAll(tablePattern)) {
    const openAt = match.index + match[0].lastIndexOf('(');
    const closeAt = closingParen(sql, openAt);
    const body = sql.slice(openAt + 1, closeAt);
    const columns = new Set();
    for (const part of splitTopLevel(body)) {
      const declaration = part.trim();
      if (!declaration || /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(declaration)) continue;
      const column = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(declaration)?.[1];
      if (column) columns.add(column.toLowerCase());
    }
    tables.set(match[1].toLowerCase(), columns);
  }
  const alterPattern = /ALTER\s+TABLE\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?([a-z_][a-z0-9_]*)"?/gi;
  for (const match of sql.matchAll(alterPattern)) {
    const table = match[1].toLowerCase(), column = match[2].toLowerCase();
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(column);
  }
  const indexes = new Set([...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+"?([a-z_][a-z0-9_]*)"?/gi)].map(match => match[1].toLowerCase()));
  return { tables, indexes };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the already-verified target database. No schema changes will be made.');
  const sql = await fs.readFile(path.join(root, 'schema.sql'), 'utf8');
  const expected = extractSchemaExpectations(sql);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000
  });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const [tableRows, columnRows, indexRows] = await Promise.all([
      client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"),
      client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'"),
      client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'")
    ]);
    await client.query('ROLLBACK');
    const actualTables = new Set(tableRows.rows.map(row => row.table_name));
    const actualColumns = new Map();
    for (const row of columnRows.rows) {
      if (!actualColumns.has(row.table_name)) actualColumns.set(row.table_name, new Set());
      actualColumns.get(row.table_name).add(row.column_name);
    }
    const actualIndexes = new Set(indexRows.rows.map(row => row.indexname));
    const missingTables = [], missingColumns = [], missingIndexes = [];
    for (const [table, columns] of expected.tables) {
      if (!actualTables.has(table)) { missingTables.push(table); continue; }
      for (const column of columns) if (!actualColumns.get(table)?.has(column)) missingColumns.push(`${table}.${column}`);
    }
    for (const index of expected.indexes) if (!actualIndexes.has(index)) missingIndexes.push(index);
    const report = { checked_read_only: true, expected_tables: expected.tables.size, expected_indexes: expected.indexes.size, missing_tables: missingTables, missing_columns: missingColumns, missing_indexes: missingIndexes, in_sync: !missingTables.length && !missingColumns.length && !missingIndexes.length };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.in_sync) process.exitCode = 1;
  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`Schema drift check failed: ${error.message}\n`); process.exitCode = 1; });
}
