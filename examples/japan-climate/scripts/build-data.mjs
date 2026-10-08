// Turns the cached JMA tables into two Parquet files under public/data/:
//   stations.parquet  one row per station (name, kana, lat, lon, elevation)
//   monthly.parquet   one row per station × year × month with six measures
// Each measure keeps a quality flag: 0 normal, 1 quasi-normal ")",
// 2 insufficient "]". Missing cells are NULL. Requires the duckdb CLI.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const cache = join(root, '.cache')
const out = join(root, 'public/data')
const MEASURES = { a1: 'tavg', a2: 'tmax', a3: 'tmin', p5: 'precip', p4: 'sun', p6: 'snow' }

function parseCell(raw) {
  const text = raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  if (text === '' || text.includes('×') || text.includes('///')) return [null, null]
  if (text.startsWith('--')) return [0, 0] // phenomenon did not occur (e.g. no snow)
  const value = Number.parseFloat(text.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(value)) return [null, null]
  const flag = text.includes(']') ? 2 : text.includes(')') ? 1 : 0
  return [value, flag]
}

function parseTable(html) {
  const rows = new Map()
  for (const [, tr] of html.matchAll(/<tr[^>]*class="mtx"[^>]*>([\s\S]*?)<\/tr>/g)) {
    // The year cell is not closed with </td>, so split on the opening tags.
    const cells = tr.split(/<td[^>]*>/).slice(1).map((c) => c.replace(/<\/td>/g, ''))
    const year = Number.parseInt(cells[0]?.replace(/<[^>]+>/g, '').trim() ?? '', 10)
    if (!Number.isInteger(year) || cells.length < 13) continue
    rows.set(year, cells.slice(1, 13).map(parseCell))
  }
  return rows
}

const stations = JSON.parse(await readFile(join(cache, 'stations.json'), 'utf8'))
const lines = ['block,year,month,' + Object.values(MEASURES).flatMap((m) => [m, `${m}_q`]).join(',')]
for (const s of stations) {
  const tables = {}
  for (const view of Object.keys(MEASURES)) {
    try {
      tables[view] = parseTable(await readFile(join(cache, 'raw', `${s.block}_${view}.html`), 'utf8'))
    } catch {
      tables[view] = new Map()
    }
  }
  const years = new Set(Object.values(tables).flatMap((t) => [...t.keys()]))
  for (const year of [...years].sort()) {
    for (let month = 1; month <= 12; month++) {
      const values = Object.keys(MEASURES).flatMap((v) => tables[v].get(year)?.[month - 1] ?? [null, null])
      if (values.every((x) => x === null)) continue
      lines.push([s.block, year, month, ...values.map((x) => (x === null ? '' : x))].join(','))
    }
  }
}

await mkdir(out, { recursive: true })
await writeFile(join(cache, 'monthly.csv'), lines.join('\n'))
await writeFile(join(cache, 'stations.csv'), ['block,name,kana,lat,lon,elev', ...stations.map((s) => [s.block, s.name, s.kana, s.lat, s.lon, s.elev].join(','))].join('\n'))
const sql = `
COPY (SELECT block, name, kana, lat, lon, elev FROM read_csv('${cache}/stations.csv', header=true, columns={'block':'VARCHAR','name':'VARCHAR','kana':'VARCHAR','lat':'DOUBLE','lon':'DOUBLE','elev':'DOUBLE'}) ORDER BY lat DESC)
  TO '${out}/stations.parquet' (FORMAT parquet, COMPRESSION zstd);
COPY (SELECT * FROM read_csv('${cache}/monthly.csv', header=true, types={'block':'VARCHAR','year':'SMALLINT','month':'TINYINT'}) ORDER BY block, year, month)
  TO '${out}/monthly.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000);
SELECT count(*) AS rows, count(DISTINCT block) AS stations, min(year) AS first_year, max(year) AS last_year FROM '${out}/monthly.parquet';
`
console.log(execFileSync('duckdb', ['-c', sql], { encoding: 'utf8' }))
