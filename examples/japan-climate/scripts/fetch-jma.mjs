// Downloads the monthly climate tables of every JMA surface station (気象官署)
// from the "past weather data" pages. Run once; the pages are cached under
// .cache/ so a rerun only fetches what is missing. Requests are spaced to stay
// polite to the JMA servers.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const cache = new URL('../.cache/', import.meta.url).pathname
const base = 'https://www.data.jma.go.jp/stats/etrn'
// a1 mean, a2 mean of daily max, a3 mean of daily min, p5 precipitation,
// p4 sunshine hours, p6 snowfall depth
export const VIEWS = ['a1', 'a2', 'a3', 'p5', 'p4', 'p6']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'artifactshare-examples (japan-climate)' } })
      if (res.ok) return await res.text()
    } catch {}
    await sleep(3000)
  }
  throw new Error(`failed: ${url}`)
}

async function cached(file, url) {
  const path = join(cache, file)
  try {
    if ((await stat(path)).size > 2000) return readFile(path, 'utf8')
  } catch {}
  const text = await fetchText(url)
  await writeFile(path, text)
  await sleep(350)
  return text
}

await mkdir(join(cache, 'pref'), { recursive: true })
await mkdir(join(cache, 'raw'), { recursive: true })

const index = await cached('prefectures.html', `${base}/select/prefecture00.php`)
const precs = [...new Set([...index.matchAll(/prec_no=(\d+)/g)].map((m) => m[1]))]
const stations = new Map()
for (const prec of precs) {
  const html = await cached(`pref/${prec}.html`, `${base}/select/prefecture.php?prec_no=${prec}`)
  const re = /viewPoint\('s','(\d+)','([^']*)','([^']*)','(\d+)','([\d.]+)','(\d+)','([\d.]+)','([\d.-]+)'/g
  for (const [, block, name, kana, la, lam, lo, lom, elev] of html.matchAll(re))
    stations.set(block, {
      block, prec, name, kana,
      lat: +(+la + lam / 60).toFixed(4),
      lon: +(+lo + lom / 60).toFixed(4),
      elev: +elev,
    })
}
await writeFile(join(cache, 'stations.json'), JSON.stringify([...stations.values()], null, 1))
console.log(`${stations.size} stations`)

for (const s of stations.values()) {
  for (const view of VIEWS)
    await cached(`raw/${s.block}_${view}.html`, `${base}/view/monthly_s3.php?prec_no=${s.prec}&block_no=${s.block}&view=${view}`)
  console.log(`fetched ${s.block} ${s.name}`)
}
