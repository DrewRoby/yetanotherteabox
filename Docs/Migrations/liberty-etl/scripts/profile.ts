// Profiles every table in the restored Liberty SQL Server database: row counts,
// per-column null/distinct stats, and top/sample values. No public Liberty schema
// exists (see ../../sql_server_data_model_migration_spec.md §3.1), so this replaces
// hand-written exploratory queries with one repeatable pass whose output is reviewed
// against the spec before any transform code gets written.
//
// Usage: npm run profile   (reads .env — copy .env.example first)
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import sql from "mssql";

const SAMPLE_SIZE = 2000;
const RANDOM_SAMPLE_ROW_LIMIT = 200_000; // above this, skip ORDER BY NEWID() (full sort is too costly)
const TOP_VALUES_MAX_DISTINCT = 20; // show top values only for low-cardinality columns
const TOP_N = 8;

interface TableRowCount {
  schema: string;
  table: string;
  rowCount: number;
}

interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  maxLength: number | null;
}

interface ColumnProfile extends ColumnMeta {
  sampleSize: number;
  nonNullCount: number;
  nonNullPct: number;
  distinctInSample: number;
  topValues?: { value: string; count: number }[];
  examples?: string[];
}

interface TableProfile {
  schema: string;
  table: string;
  rowCount: number;
  columns: ColumnProfile[];
  fkGuesses: { column: string; likelyReferences: string }[];
}

function getConfig(): sql.config {
  const required = ["MSSQL_HOST", "MSSQL_USER", "MSSQL_PASSWORD", "MSSQL_DATABASE"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var ${key} — copy .env.example to .env first.`);
    }
  }
  return {
    server: process.env.MSSQL_HOST!,
    port: Number(process.env.MSSQL_PORT ?? 1433),
    user: process.env.MSSQL_USER!,
    password: process.env.MSSQL_PASSWORD!,
    database: process.env.MSSQL_DATABASE!,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === "true",
      trustServerCertificate: true,
    },
  };
}

async function getTableRowCounts(pool: sql.ConnectionPool): Promise<TableRowCount[]> {
  // sys.partitions-based count avoids a full table scan per table.
  const result = await pool.request().query(`
    SELECT s.name AS [schema], t.name AS [table], SUM(p.rows) AS [rowCount]
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.partitions p ON t.object_id = p.object_id
    WHERE p.index_id IN (0, 1)
    GROUP BY s.name, t.name
    ORDER BY s.name, t.name;
  `);
  return result.recordset.map((r) => ({
    schema: r.schema,
    table: r.table,
    rowCount: Number(r.rowCount),
  }));
}

async function getColumns(pool: sql.ConnectionPool, schema: string, table: string): Promise<ColumnMeta[]> {
  const result = await pool
    .request()
    .input("schema", sql.NVarChar, schema)
    .input("table", sql.NVarChar, table)
    .query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS isNullable,
             CHARACTER_MAXIMUM_LENGTH AS maxLength
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION;
    `);
  return result.recordset.map((r) => ({
    name: r.name,
    dataType: r.dataType,
    isNullable: r.isNullable === "YES",
    maxLength: r.maxLength ?? null,
  }));
}

async function getPrimaryKeyColumns(pool: sql.ConnectionPool): Promise<Set<string>> {
  // Lowercased "schema.table.column" set, used only for the FK-guess heuristic below.
  const result = await pool.request().query(`
    SELECT s.name AS [schema], t.name AS [table], c.name AS [column]
    FROM sys.key_constraints kc
    JOIN sys.tables t ON kc.parent_object_id = t.object_id
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
    JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
    WHERE kc.type = 'PK';
  `);
  return new Set(
    result.recordset.map((r) => `${r.schema}.${r.table}.${r.column}`.toLowerCase())
  );
}

async function sampleRows(
  pool: sql.ConnectionPool,
  schema: string,
  table: string,
  rowCount: number
): Promise<Record<string, unknown>[]> {
  const n = Math.min(SAMPLE_SIZE, rowCount);
  const useRandom = rowCount <= RANDOM_SAMPLE_ROW_LIMIT;
  const orderBy = useRandom ? "ORDER BY NEWID()" : "";
  const query = `SELECT TOP ${n} * FROM [${schema}].[${table}] ${orderBy};`;
  const result = await pool.request().query(query);
  return result.recordset;
}

function profileColumn(meta: ColumnMeta, sample: Record<string, unknown>[]): ColumnProfile {
  const values = sample.map((r) => r[meta.name]);
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  const freq = new Map<string, number>();
  for (const v of nonNull) {
    const key = v instanceof Date ? v.toISOString() : String(v);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const distinct = freq.size;
  const profile: ColumnProfile = {
    ...meta,
    sampleSize: sample.length,
    nonNullCount: nonNull.length,
    nonNullPct: sample.length === 0 ? 0 : Math.round((nonNull.length / sample.length) * 1000) / 10,
    distinctInSample: distinct,
  };
  if (distinct > 0 && distinct <= TOP_VALUES_MAX_DISTINCT) {
    profile.topValues = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([value, count]) => ({ value, count }));
  } else if (distinct > 0) {
    profile.examples = [...freq.keys()].slice(0, 5);
  }
  return profile;
}

function guessForeignKeys(
  columns: ColumnMeta[],
  schema: string,
  table: string,
  allTables: TableRowCount[]
): { column: string; likelyReferences: string }[] {
  const guesses: { column: string; likelyReferences: string }[] = [];
  for (const col of columns) {
    const name = col.name.toLowerCase();
    if (!name.endsWith("id") || name === "id") continue;
    // Strip trailing "id" and match against other table names, e.g. "accountid" -> "account".
    const base = name.slice(0, -2);
    const candidate = allTables.find(
      (t) =>
        (t.schema !== schema || t.table !== table) &&
        (t.table.toLowerCase() === base ||
          t.table.toLowerCase() === base + "s" ||
          t.table.toLowerCase().replace(/s$/, "") === base)
    );
    if (candidate) {
      guesses.push({ column: col.name, likelyReferences: `${candidate.schema}.${candidate.table}` });
    }
  }
  return guesses;
}

function toMarkdown(profiles: TableProfile[], skipped: TableRowCount[]): string {
  const lines: string[] = [];
  lines.push(`# Liberty source data profile`);
  lines.push(``);
  lines.push(`Generated by \`liberty-etl/scripts/profile.ts\`. Read this alongside`);
  lines.push(`\`../sql_server_data_model_migration_spec.md\` — it exists to confirm or`);
  lines.push(`correct that spec's speculative field mapping, not to replace it.`);
  lines.push(``);
  lines.push(`## Zero-row tables (excluded from migration scope)`);
  lines.push(``);
  if (skipped.length === 0) {
    lines.push(`_None — every table in this database has at least one row._`);
  } else {
    for (const t of skipped) lines.push(`- \`${t.schema}.${t.table}\``);
  }
  lines.push(``);
  lines.push(`## Populated tables`);
  lines.push(``);
  for (const p of profiles) {
    lines.push(`### \`${p.schema}.${p.table}\` — ${p.rowCount.toLocaleString()} rows`);
    lines.push(``);
    if (p.fkGuesses.length > 0) {
      lines.push(`Possible FK columns (name-based guess, verify against actual values):`);
      for (const g of p.fkGuesses) lines.push(`- \`${g.column}\` → maybe \`${g.likelyReferences}\``);
      lines.push(``);
    }
    lines.push(`| Column | Type | Nullable | Non-null % (sample) | Distinct (sample) | Top values / examples |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const c of p.columns) {
      const vals = c.topValues
        ? c.topValues.map((v) => `${v.value} (${v.count})`).join(", ")
        : (c.examples ?? []).join(", ");
      lines.push(
        `| \`${c.name}\` | ${c.dataType}${c.maxLength ? `(${c.maxLength})` : ""} | ${c.isNullable ? "yes" : "no"} | ${c.nonNullPct}% | ${c.distinctInSample} | ${vals.replace(/\|/g, "\\|")} |`
      );
    }
    lines.push(``);
  }
  return lines.join("\n");
}

async function main() {
  const pool = await sql.connect(getConfig());
  try {
    console.log("Fetching table row counts...");
    const allTables = await getTableRowCounts(pool);
    const populated = allTables.filter((t) => t.rowCount > 0);
    const skipped = allTables.filter((t) => t.rowCount === 0);
    console.log(`${allTables.length} tables total, ${populated.length} populated, ${skipped.length} empty (skipped).`);

    const profiles: TableProfile[] = [];
    for (const t of populated) {
      console.log(`Profiling ${t.schema}.${t.table} (${t.rowCount.toLocaleString()} rows)...`);
      const columns = await getColumns(pool, t.schema, t.table);
      const sample = await sampleRows(pool, t.schema, t.table, t.rowCount);
      const columnProfiles = columns.map((c) => profileColumn(c, sample));
      const fkGuesses = guessForeignKeys(columns, t.schema, t.table, allTables);
      profiles.push({ schema: t.schema, table: t.table, rowCount: t.rowCount, columns: columnProfiles, fkGuesses });
    }

    const outDir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "profile.json"), JSON.stringify({ populated: profiles, skipped }, null, 2));
    fs.writeFileSync(path.join(outDir, "profile.md"), toMarkdown(profiles, skipped));
    console.log(`\nWrote reports/profile.md and reports/profile.json`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
