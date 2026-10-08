import { useEffect, useMemo, useRef, useState } from 'react'
import { anomalyColor, formatAnom } from '../color'
import { run } from '../db'
import type { Station } from '../types'

type Props = { station: Station; stations: Station[]; onSelect: (block: string) => void }
type Point = { year: number; month: number; anom: number }
type Stats = {
  perCentury: number | null
  since1961: number | null
  firstYear: number
  lastYear: number
  hottestMonth: { year: number; month: number; tavg: number } | null
  hottestYear: { year: number; anom: number } | null
  snowOld: number | null
  snowNew: number | null
}

const SIZE = 560
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function StationDetail({ station, stations, onSelect }: Props) {
  const [points, setPoints] = useState<Point[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [upto, setUpto] = useState(0)
  const [replay, setReplay] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const id = station.block

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [series, trend, hottestMonth, hottestYear, snow] = await Promise.all([
        run(
          `${station.name}の月別偏差`,
          // A trailing 12-month mean turns noisy monthly anomalies into a
          // spiral that drifts outward as the station warms.
          `SELECT m.year, m.month,
                  avg(m.tavg - n.tavg) OVER (ORDER BY m.year, m.month ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS anom
           FROM monthly m JOIN monthly_normals n USING (block, month)
           WHERE m.block = '${id}' AND m.tavg_q < 2
           ORDER BY m.year, m.month`,
        ),
        run(
          `${station.name}の上昇率`,
          `SELECT regr_slope(tavg, year) * 100 AS per_century,
                  regr_slope(tavg, year) FILTER (WHERE year >= 1961) * 10 AS since_1961,
                  min(year) AS first_year, max(year) AS last_year
           FROM annual WHERE block = '${id}'`,
        ),
        run(
          `${station.name}の最も暑い月`,
          `SELECT year, month, tavg FROM monthly WHERE block = '${id}' AND tavg_q < 2 ORDER BY tavg DESC LIMIT 1`,
        ),
        run(`${station.name}の最も暑い年`, `SELECT year, anom FROM anomalies WHERE block = '${id}' ORDER BY anom DESC LIMIT 1`),
        run(
          `${station.name}の雪`,
          `SELECT avg(snow) FILTER (WHERE year BETWEEN 1961 AND 1990) AS old,
                  avg(snow) FILTER (WHERE year BETWEEN 1996 AND 2025) AS new
           FROM annual WHERE block = '${id}'`,
        ),
      ])
      if (!alive) return
      setPoints(series.map((r) => ({ year: Number(r.year), month: Number(r.month), anom: Number(r.anom) })))
      const t = trend[0]
      setStats({
        perCentury: t?.per_century === null ? null : Number(t?.per_century),
        since1961: t?.since_1961 === null ? null : Number(t?.since_1961),
        firstYear: Number(t?.first_year),
        lastYear: Number(t?.last_year),
        hottestMonth: hottestMonth[0]
          ? { year: Number(hottestMonth[0].year), month: Number(hottestMonth[0].month), tavg: Number(hottestMonth[0].tavg) }
          : null,
        hottestYear: hottestYear[0] ? { year: Number(hottestYear[0].year), anom: Number(hottestYear[0].anom) } : null,
        snowOld: snow[0]?.old === null ? null : Number(snow[0]?.old),
        snowNew: snow[0]?.new === null ? null : Number(snow[0]?.new),
      })
    })()
    return () => {
      alive = false
    }
  }, [id, station.name])

  const years = useMemo(() => [...new Set(points.map((p) => p.year))], [points])

  // Draw the spiral year by year (about 7 seconds end to end).
  useEffect(() => {
    if (years.length === 0) return
    if (reduceMotion()) {
      setUpto(years.length)
      return
    }
    setUpto(0)
    let raf = 0
    const started = performance.now()
    const duration = 7000
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      setUpto(Math.ceil(years.length * (1 - (1 - t) ** 2)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [years, replay])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, SIZE, SIZE)
    const c = SIZE / 2
    const R = SIZE * 0.44
    const r0 = R * 0.52
    const k = R * 0.26
    const radius = (anom: number) => Math.max(R * 0.08, r0 + Math.max(-1.8, Math.min(1.8, anom)) * k)
    const angle = (month: number) => ((month - 1) / 12) * Math.PI * 2 - Math.PI / 2

    // Reference rings at −2, 0, +2 °C and month spokes.
    ctx.lineWidth = 1
    for (const [v, label] of [[-1, '−1℃'], [0, '平年'], [1, '+1℃']] as const) {
      ctx.strokeStyle = v === 0 ? 'rgba(243,239,230,0.35)' : 'rgba(243,239,230,0.12)'
      ctx.setLineDash(v === 0 ? [] : [3, 5])
      ctx.beginPath()
      ctx.arc(c, c, radius(v), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(243,239,230,0.45)'
      ctx.font = '11px "IBM Plex Mono", monospace'
      ctx.fillText(label, c + 6, c - radius(v) - 4)
    }
    ctx.fillStyle = 'rgba(243,239,230,0.55)'
    ctx.font = '12px "Shippori Mincho B1", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let m = 1; m <= 12; m++) {
      const a = angle(m)
      ctx.fillText(`${m}月`, c + Math.cos(a) * (R + 14), c + Math.sin(a) * (R + 14))
    }

    const visible = new Set(years.slice(0, upto))
    const pts = points.filter((p) => visible.has(p.year))
    const newest = years[upto - 1]
    ctx.lineCap = 'round'
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      // Break the line across gaps in the record.
      const gap = (b.year - a.year) * 12 + (b.month - a.month)
      if (gap !== 1) continue
      const age = newest - b.year
      ctx.globalAlpha = age < 1 ? 1 : Math.max(0.22, 0.9 - age * 0.006)
      ctx.lineWidth = age < 1 ? 3 : 1.6
      ctx.strokeStyle = anomalyColor(b.anom * 1.6)
      // Interpolate in polar coordinates so each month bends along the circle.
      const a0 = angle(a.month)
      const a1 = b.month === 1 ? angle(13) : angle(b.month)
      ctx.beginPath()
      for (let step = 0; step <= 8; step++) {
        const f = step / 8
        const th = a0 + (a1 - a0) * f
        const rr = radius(a.anom + (b.anom - a.anom) * f)
        if (step === 0) ctx.moveTo(c + Math.cos(th) * rr, c + Math.sin(th) * rr)
        else ctx.lineTo(c + Math.cos(th) * rr, c + Math.sin(th) * rr)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }, [points, years, upto])

  const shownYear = years[Math.max(0, upto - 1)]
  const monthName = (m: number) => `${m}月`

  return (
    <section className="detail" aria-labelledby="detail-title">
      <header className="section-head">
        <p className="eyebrow">02 · 一地点の 150 年</p>
        <div className="detail-title-row">
          <h2 id="detail-title">{station.name}</h2>
          <select value={station.block} onChange={(e) => onSelect(e.target.value)} aria-label="地点を選ぶ">
            {stations.map((s) => (
              <option key={s.block} value={s.block}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="lede">
          直近 12 か月の平年差を、時計回りに 1 年で 1 周する螺旋にしました。外の輪ほど暑く、内側ほど涼しい時期です。古い年は淡く、新しい年ほど濃く描きます。
        </p>
      </header>
      <div className="detail-body">
        <div className="spiral">
          <canvas ref={canvasRef} role="img" aria-label={`${station.name}の月別平年差の螺旋`} />
          <div className="spiral-year">{shownYear ?? ''}</div>
          <button className="ghost" onClick={() => setReplay((n) => n + 1)}>
            ↻ もう一度描く
          </button>
        </div>
        {stats && (
          <dl className="stats">
            <div>
              <dt>100 年あたりの上昇</dt>
              <dd style={{ color: anomalyColor((stats.perCentury ?? 0) * 1.2) }}>{formatAnom(stats.perCentury)}</dd>
              <small>{stats.firstYear}–{stats.lastYear} 年の年平均気温の回帰</small>
            </div>
            <div>
              <dt>1961 年以降、10 年あたり</dt>
              <dd style={{ color: anomalyColor((stats.since1961 ?? 0) * 6) }}>{formatAnom(stats.since1961)}</dd>
              <small>最近ほど速いかどうか</small>
            </div>
            <div>
              <dt>観測史上いちばん暑い月</dt>
              <dd>{stats.hottestMonth ? `${stats.hottestMonth.tavg.toFixed(1)}℃` : '—'}</dd>
              <small>{stats.hottestMonth ? `${stats.hottestMonth.year} 年 ${monthName(stats.hottestMonth.month)}の月平均` : ''}</small>
            </div>
            <div>
              <dt>いちばん暑かった年</dt>
              <dd style={{ color: anomalyColor(stats.hottestYear?.anom ?? 0) }}>{stats.hottestYear ? stats.hottestYear.year : '—'}</dd>
              <small>{stats.hottestYear ? `平年差 ${formatAnom(stats.hottestYear.anom)}` : ''}</small>
            </div>
            {stats.snowOld !== null && stats.snowOld > 5 && (
              <div>
                <dt>年間の降雪</dt>
                <dd>
                  {Math.round(stats.snowOld)} → {Math.round(stats.snowNew ?? 0)} cm
                </dd>
                <small>1961–1990 年平均 → 1996–2025 年平均</small>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  )
}
