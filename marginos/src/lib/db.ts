import { PGlite, type Transaction } from "@electric-sql/pglite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Database access. Locally MarginOS runs an embedded PostgreSQL (PGlite) persisted to
 * MARGINOS_DATA_DIR, using exactly the same SQL migrations a Supabase project would use.
 * All access goes through `query` / `tx` so the backing driver can be swapped for a
 * Supabase/Postgres pool in one place.
 */

export type Queryable = Pick<PGlite, "query"> | Transaction;

// Default lives outside the project so dev-server file watchers and cloud-sync folders (e.g. OneDrive) never touch database files.
const DATA_DIR = process.env.MARGINOS_DATA_DIR ? path.resolve(process.cwd(), process.env.MARGINOS_DATA_DIR) : path.join(os.homedir(), ".marginos");
// RLS (0090) runs on Supabase only: it depends on the auth schema.
const LOCAL_MIGRATIONS = ["0001_init.sql", "0002_stock_and_orders.sql", "0003_auth.sql"];

type GlobalDb = { __marginosDb?: Promise<PGlite> };
const g = globalThis as unknown as GlobalDb;

async function open(): Promise<PGlite> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new PGlite(path.join(DATA_DIR, "pg"));
  await db.waitReady;
  await db.exec(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await db.query<{ name: string }>(`select name from _migrations`)).rows.map((r) => r.name));
  for (const name of LOCAL_MIGRATIONS) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", name), "utf8");
    await db.exec(sql);
    await db.query(`insert into _migrations (name) values ($1)`, [name]);
    console.info(`[db] applied migration ${name}`);
  }
  return db;
}

export function getDb(): Promise<PGlite> {
  if (!g.__marginosDb) {
    g.__marginosDb = open().catch((err) => {
      g.__marginosDb = undefined;
      throw err;
    });
  }
  return g.__marginosDb;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return (await db.query<T>(sql, params)).rows;
}

export async function tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(fn);
}

export const uploadsDir = () => {
  const dir = path.join(DATA_DIR, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Postgres numeric comes back as string; normalise. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Multi-row insert helper: builds `insert into t (cols) values (...),(...)` in chunks. */
export async function bulkInsert(
  db: Queryable,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunk = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: unknown[] = [];
    const values = slice
      .map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`)
      .join(",");
    await db.query(`insert into ${table} (${columns.join(",")}) values ${values}`, params);
  }
}
