import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Ask } from './components/Ask'
import { Hero } from './components/Hero'
import { SqlLog } from './components/SqlLog'
import { StationDetail } from './components/StationDetail'
import { StripesWall } from './components/StripesWall'
import { init, run } from './db'
import type { AnomalyGrid, JapanMap, NationalYear, Station } from './types'

type Data = { stations: Station[]; grid: AnomalyGrid; national: NationalYear[]; firstYear: number; lastYear: number; dataFirstYear: number; rows: number; map: JapanMap | null }

async function load(onStep: (s: string) => void): Promise<Data> {
  const mapPromise = fetch(new URL('data/japan-map.json', location.href))
    .then((r) => (r.ok ? (r.json() as Promise<JapanMap>) : null))
    .catch(() => null)
  await init(onStep)
  onStep('平年差を計算しています')
  const [stations, cells, nationalRows, meta] = await Promise.all([
    run('地点の一覧', `SELECT block, name, kana, lat, lon, elev FROM stations WHERE block IN (SELECT block FROM normals) ORDER BY lat DESC`),
    run('全地点 × 全年の偏差', `SELECT block, year, anom FROM anomalies`),
    // The national mean only counts years with at least 40 stations reporting.
    run(
      '全国平均の偏差',
      `SELECT year, avg(anom) AS anom, count(*) AS stations FROM anomalies GROUP BY year HAVING count(*) >= 40 ORDER BY year`,
    ),
    run('データの範囲', `SELECT min(year) AS first, max(year) AS last, (SELECT count(*) FROM monthly) AS rows FROM anomalies`),
  ])
  const grid: AnomalyGrid = new Map()
  for (const c of cells) {
    const block = String(c.block)
    if (!grid.has(block)) grid.set(block, new Map())
    grid.get(block)!.set(Number(c.year), Number(c.anom))
  }
  const natMap = new Map(nationalRows.map((n) => [Number(n.year), n]))
  const firstYear = Number(nationalRows[0]?.year ?? meta[0].first)
  const lastYear = Number(meta[0].last)
  const national: NationalYear[] = []
  for (let y = firstYear; y <= lastYear; y++) {
    const n = natMap.get(y)
    national.push({ year: y, anom: n ? Number(n.anom) : null, stations: n ? Number(n.stations) : 0 })
  }
  return {
    stations: stations.map((s) => ({
      block: String(s.block),
      name: String(s.name),
      kana: String(s.kana),
      lat: Number(s.lat),
      lon: Number(s.lon),
      elev: Number(s.elev),
    })),
    grid,
    national,
    firstYear,
    lastYear,
    dataFirstYear: Number(meta[0].first),
    rows: Number(meta[0].rows),
    map: await mapPromise,
  }
}

export function App() {
  const [data, setData] = useState<Data | null>(null)
  const [step, setStep] = useState('準備しています')
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('47662') // 東京

  useEffect(() => {
    load(setStep).then(setData, (e) => setError(String(e)))
  }, [])

  const station = useMemo(() => data?.stations.find((s) => s.block === selected) ?? data?.stations[0], [data, selected])

  const select = (block: string) => {
    setSelected(block)
    document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div className="grain" aria-hidden />
      <AnimatePresence>
        {!data && (
          <motion.div className="loading" exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <div className="loading-stripes" aria-hidden>
              {Array.from({ length: 48 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 30}ms` }} />
              ))}
            </div>
            <p>{error ? `読み込めませんでした：${error}` : step}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {data && station && (
        <main>
          <Hero
            stations={data.stations}
            national={data.national}
            map={data.map}
            firstYear={data.firstYear}
            lastYear={data.lastYear}
            selected={selected}
            onSelect={select}
          />
          <StripesWall
            stations={data.stations}
            grid={data.grid}
            firstYear={data.dataFirstYear}
            lastYear={data.lastYear}
            selected={selected}
            onSelect={select}
          />
          <div id="detail">
            <StationDetail station={station} stations={data.stations} onSelect={setSelected} />
          </div>
          <Ask />
          <footer className="colophon">
            <p>
              出典：気象庁ホームページ「過去の気象データ検索」の月別値（{data.rows.toLocaleString('ja-JP')} 件）をもとに加工して作成。
              平年差は各地点の 1961–1990 年平均との差で、12 か月がそろい資料不足のない年だけを使っています。観測所の移転による不連続は補正していません。
            </p>
            <p>
              地図は Natural Earth（パブリックドメイン）。DuckDB-WASM と React で作り、Artifact Share の静的サイトとして公開しています。ソースコード：
              <a href="https://github.com/artifactshare/examples">github.com/artifactshare/examples</a>
            </p>
          </footer>
          <SqlLog />
        </main>
      )}
    </>
  )
}
