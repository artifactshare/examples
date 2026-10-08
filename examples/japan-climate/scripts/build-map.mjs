// Builds public/data/japan-map.json: simplified coastlines and prefecture
// borders of Japan from Natural Earth 1:10m admin-1 (public domain).
// Requires network access and runs mapshaper through npx.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const cache = join(root, '.cache/map')
await mkdir(cache, { recursive: true })
const src = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
const all = await (await fetch(src)).json()
const japan = { type: 'FeatureCollection', features: all.features.filter((f) => f.properties.adm0_a3 === 'JPN') }
await writeFile(join(cache, 'jpn.geojson'), JSON.stringify(japan))

const mapshaper = (...args) => execFileSync('npx', ['-y', 'mapshaper@0.6', join(cache, 'jpn.geojson'), ...args], { stdio: 'inherit' })
mapshaper('-simplify', '18%', 'keep-shapes', '-innerlines', '-o', 'format=geojson', join(cache, 'inner.geojson'))
mapshaper('-simplify', '18%', 'keep-shapes', '-dissolve', '-lines', '-o', 'format=geojson', join(cache, 'coast.geojson'))

async function lines(file) {
  const d = JSON.parse(await readFile(file, 'utf8'))
  const geoms = d.type === 'FeatureCollection' ? d.features.map((f) => f.geometry) : d.type === 'GeometryCollection' ? d.geometries : [d]
  return geoms.flatMap((g) => (g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : []))
    .filter((p) => p.length >= 2)
    .map((p) => p.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]))
}
const out = {
  coast: await lines(join(cache, 'coast.geojson')),
  borders: await lines(join(cache, 'inner.geojson')),
  source: 'Natural Earth 1:10m admin-1 states and provinces (public domain)',
}
await writeFile(join(root, 'public/data/japan-map.json'), JSON.stringify(out))
console.log(`coast ${out.coast.length}, borders ${out.borders.length}`)
