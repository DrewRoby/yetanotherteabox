import "dotenv/config";
import sql from "mssql";

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

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = sql.connect(getConfig());
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
