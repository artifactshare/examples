// DuckDB-WASM runs entirely in the browser. The engine comes from jsDelivr;
// the data is two Parquet files shipped next to this page.
import type * as Duck from '@duckdb/duckdb-wasm'

const DUCKDB_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm'

export type Row = Record<string, string | number | null>
export type QueryLog = { id: number; label: string; sql: string; ms: number; rows: number; at: number; error?: string }

let connection: Duck.AsyncDuckDBConnection | null = null
let ready: Promise<void> | null = null
let logId = 0
const logs: QueryLog[] = []
const listeners = new Set<() => void>()

export function subscribeLogs(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getLogs = () => logs

function record(entry: Omit<QueryLog, 'id' | 'at'>) {
  logs.unshift({ ...entry, id: ++logId, at: Date.now() })
  logs.length = Math.min(logs.length, 40)
  for (const fn of listeners) fn()
}

const dataUrl = (name: string) => new URL(`data/${name}`, location.href).href

// Turns Arrow values into plain JSON-friendly values.
function plain(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' || typeof value === 'string') return value
  return String(value)
}

async function open(onStep: (step: string) => void) {
  onStep('DuckDB-WASM を読み込んでいます')
  const duckdb: typeof Duck = await import(/* @vite-ignore */ DUCKDB_ESM)
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles())
  // A blob worker imports the jsDelivr worker script, so the page needs no
  // cross-origin Worker constructor.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
  )
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl))
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  URL.revokeObjectURL(workerUrl)

  onStep('観測データ（Parquet）を取得しています')
  for (const file of ['monthly.parquet', 'stations.parquet']) {
    const bytes = new Uint8Array(await (await fetch(dataUrl(file))).arrayBuffer())
    await db.registerFileBuffer(file, bytes)
  }
  connection = await db.connect()

  // Reading Parquet needs DuckDB's parquet extension, normally fetched from
  // extensions.duckdb.org. If that origin is unreachable, fall back to a copy
  // bundled under ext/ next to this page.
  try {
    await connection.query('LOAD parquet')
  } catch {
    await connection.query(`SET custom_extension_repository='${new URL('ext', location.href).href}'`)
    await connection.query('LOAD parquet')
  }

  onStep('20 万行をテーブルに展開しています')
  await run('テーブルの準備', SETUP_SQL)
}

// Annual means count only complete years (12 months, none flagged as
// insufficient). Normals are the 1961–1990 means, the WMO reference period
// most stations cover; anomalies are measured against them.
const SETUP_SQL = `
CREATE TABLE stations AS SELECT * FROM 'stations.parquet';
CREATE TABLE monthly AS SELECT * FROM 'monthly.parquet';
CREATE TABLE annual AS
  SELECT block, year, avg(tavg) AS tavg, avg(tmax) AS tmax, avg(tmin) AS tmin,
         sum(precip) AS precip, sum(snow) AS snow
  FROM monthly
  GROUP BY block, year
  HAVING count(tavg) FILTER (WHERE tavg_q < 2) = 12;
CREATE TABLE normals AS
  SELECT block, avg(tavg) AS tavg, count(*) AS years
  FROM annual WHERE year BETWEEN 1961 AND 1990
  GROUP BY block HAVING count(*) >= 20;
CREATE TABLE monthly_normals AS
  SELECT block, month, avg(tavg) AS tavg
  FROM monthly WHERE year BETWEEN 1961 AND 1990 AND tavg_q < 2
  GROUP BY block, month;
CREATE TABLE anomalies AS
  SELECT a.block, a.year, a.tavg, a.tavg - n.tavg AS anom
  FROM annual a JOIN normals n USING (block);
`

export function init(onStep: (step: string) => void) {
  ready ??= open(onStep)
  return ready
}

export async function run(label: string, sql: string): Promise<Row[]> {
  if (!connection) throw new Error('DuckDB is not ready')
  const started = performance.now()
  try {
    const table = await connection.query(sql)
    const rows = table.toArray().map((r: { toJSON(): Record<string, unknown> }) => {
      const out: Row = {}
      for (const [k, v] of Object.entries(r.toJSON())) out[k] = plain(v)
      return out
    })
    record({ label, sql: sql.trim(), ms: performance.now() - started, rows: rows.length })
    return rows
  } catch (error) {
    record({ label, sql: sql.trim(), ms: performance.now() - started, rows: 0, error: String(error) })
    throw error
  }
}
