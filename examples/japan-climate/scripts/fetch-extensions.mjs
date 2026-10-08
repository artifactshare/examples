// Optional: copies DuckDB's parquet extension next to the page under ext/.
// The app loads extensions from extensions.duckdb.org first and falls back to
// this copy, for hosts whose content policy does not allow that origin.
import { mkdir, writeFile } from 'node:fs/promises'

const DUCKDB_VERSION = 'v1.4.3' // matches @duckdb/duckdb-wasm 1.32.0
for (const build of ['wasm_eh', 'wasm_mvp']) {
  const dir = new URL(`../public/ext/${DUCKDB_VERSION}/${build}/`, import.meta.url)
  await mkdir(dir, { recursive: true })
  const url = `https://extensions.duckdb.org/${DUCKDB_VERSION}/${build}/parquet.duckdb_extension.wasm`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await writeFile(new URL('parquet.duckdb_extension.wasm', dir), Buffer.from(await res.arrayBuffer()))
  console.log(`saved ${build}`)
}
