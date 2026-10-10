import "dotenv/config";
import sql from "mssql";

// Two ways to reach the source SQL Server:
// - Default (Linux/Docker): SQL login (`sa`) over TCP via mssql's bundled tedious driver.
// - MSSQL_TRUSTED_CONNECTION=true (Windows, e.g. a local SQLEXPRESS instance): Windows
//   integrated auth via the optional `msnodesqlv8` driver + the installed ODBC driver.
//   Works over shared memory, so it needs neither TCP enabled nor SQL logins (mixed-mode
//   auth) turned on — both are off by default on a fresh SQL Server Express install.
function isTrustedConnection(): boolean {
  return process.env.MSSQL_TRUSTED_CONNECTION === "true";
}

function getSqlLoginConfig(): sql.config {
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

function getTrustedConfig(): sql.config {
  for (const key of ["MSSQL_HOST", "MSSQL_DATABASE"]) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var ${key} — copy .env.example to .env first.`);
    }
  }
  const driver = process.env.MSSQL_ODBC_DRIVER ?? "ODBC Driver 18 for SQL Server";
  return {
    server: process.env.MSSQL_HOST!,
    database: process.env.MSSQL_DATABASE!,
    driver: "msnodesqlv8",
    connectionString:
      `Driver={${driver}};Server=${process.env.MSSQL_HOST};Database=${process.env.MSSQL_DATABASE};` +
      `Trusted_Connection=yes;TrustServerCertificate=yes;`,
    // Match tedious' default so DATETIME values decode identically in both modes.
    options: { useUTC: true },
  } as sql.config;
}

export async function connect(): Promise<sql.ConnectionPool> {
  if (isTrustedConnection()) {
    // Loaded lazily: msnodesqlv8 is an optional, Windows-only native dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const msnodesql = require("mssql/msnodesqlv8") as typeof sql;
    return new msnodesql.ConnectionPool(getTrustedConfig()).connect();
  }
  return new sql.ConnectionPool(getSqlLoginConfig()).connect();
}

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = connect();
  }
  return poolPromise;
}

export async function closePool(): Promise<void> {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}
