import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { anomalyColor, formatAnom } from '../color'
import { run } from '../db'
import type { JapanMap, NationalYear, Station } from '../types'

type Props = {
  stations: Station[]
  national: NationalYear[]
  map: JapanMap | null
  firstYear: number
  lastYear: number
  selected: string | null
  onSelect: (block: string) => void
}

type Frame = { year: number; values: Map<string, { anom: number; tavg: number }>; ms: number }

const LON = [122.6, 146.4]
const LAT = [24, 45.8]
// The Ogasawara islands and Minamitorishima sit far to the south-east; they
// are drawn in an inset so the main islands can fill the frame.
const isRemote = (s: { lat: number; lon: number }) => s.lon > 141 && s.lat < 30
const INSET = { lon: [141.6, 154.6], lat: [23.8, 27.6] }
const COS = Math.cos((36 * Math.PI) / 180)
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function Hero({ stations, national, map, firstYear, lastYear, selected, onSelect }: Props) {
  const [year, setYear] = useState(reduceMotion() ? lastYear : firstYear)
  const [playing, setPlaying] = useState(!reduceMotion())
  const [frame, setFrame] = useState<Frame | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [mapRef, size] = useSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inflight = useRef(false)
  const wanted = useRef(year)

  // Every frame of the timeline is a real SQL query against DuckDB-WASM.
  const fetchYear = useCallback(async (y: number) => {
    wanted.current = y
    if (inflight.current) return
    inflight.current = true
    try {
      while (true) {
        const target = wanted.current
        const started = performance.now()
        const rows = await run(`${target} 年の偏差`, `SELECT block, anom, tavg FROM anomalies WHERE year = ${target}`)
        const values = new Map(rows.map((r) => [String(r.block), { anom: Number(r.anom), tavg: Number(r.tavg) }]))
        setFrame({ year: target, values, ms: performance.now() - started })
        if (wanted.current === target) break
      }
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    fetchYear(year)
  }, [year, fetchYear])

  // Autoplay: ~13 seconds from the first year to the last, easing in.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      acc += now - last
      last = now
      const step = 85
      if (acc >= step) {
        acc = 0
        setYear((y) => {
          if (y >= lastYear) {
            setPlaying(false)
            return y
          }
          return y + 1
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, lastYear])

  const { project, projectMain, inset } = useMemo(() => {
    const pad = 24
    const spanX = (LON[1] - LON[0]) * COS
    const spanY = LAT[1] - LAT[0]
    const scale = Math.min((size.w - pad * 2) / spanX, (size.h - pad * 2) / spanY)
    const ox = (size.w - spanX * scale) / 2
    const oy = (size.h - spanY * scale) / 2
    const box = { w: Math.max(150, size.w * 0.26), h: Math.max(60, size.w * 0.09) }
    const box0 = { x: size.w - box.w - pad, y: size.h - box.h - pad }
    const ix = (lon: number) => box0.x + 12 + ((lon - INSET.lon[0]) / (INSET.lon[1] - INSET.lon[0])) * (box.w - 24)
    const iy = (lat: number) => box0.y + 10 + ((INSET.lat[1] - lat) / (INSET.lat[1] - INSET.lat[0])) * (box.h - 20)
    const main = (lat: number, lon: number) => [ox + (lon - LON[0]) * COS * scale, oy + (LAT[1] - lat) * scale] as const
    const fn = (lat: number, lon: number) => (isRemote({ lat, lon }) ? ([ix(lon), iy(lat)] as const) : main(lat, lon))
    return { project: fn, projectMain: main, inset: { ...box0, ...box } }
  }, [size])

  // Wireframe: graticule, prefecture borders and coastlines in the same
  // projection as the station dots.
  const wire = useMemo(() => {
    if (size.w === 0) return null
    const path = (line: [number, number][]) =>
      line.map(([lon, lat], i) => {
        const [x, y] = projectMain(lat, lon)
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      }).join('')
    const grat: string[] = []
    for (let lat = 24; lat <= 46; lat += 2) grat.push(path([[LON[0], lat], [LON[1], lat]]))
    for (let lon = 124; lon <= 146; lon += 2) grat.push(path([[lon, LAT[0]], [lon, LAT[1]]]))
    return {
      grat,
      coast: map?.coast.map(path) ?? [],
      borders: map?.borders.map(path) ?? [],
    }
  }, [map, projectMain, size.w])

  // Heat bloom: soft radial glows composited under the dots.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.globalCompositeOperation = 'screen'
    const radius = Math.max(36, size.w * 0.07)
    for (const s of stations) {
      const v = frame.values.get(s.block)
      if (!v) continue
      const [x, y] = project(s.lat, s.lon)
      const color = anomalyColor(v.anom)
      const strength = Math.min(1, Math.abs(v.anom) / 2.2)
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
      g.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', `,${0.18 + strength * 0.32})`))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [frame, stations, project, size])

  const summary = useMemo(() => {
    if (!frame) return null
    const vals = [...frame.values.values()]
    const warmer = vals.filter((v) => v.anom > 0).length
    const mean = vals.reduce((a, v) => a + v.anom, 0) / (vals.length || 1)
    return { count: vals.length, warmer, mean }
  }, [frame])

  const hovered = hover ? stations.find((s) => s.block === hover) : null
  const hoveredValue = hover ? frame?.values.get(hover) : undefined
  const shownYear = frame?.year ?? year

  const onScrub = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setPlaying(false)
    setYear(Math.round(firstYear + t * (lastYear - firstYear)))
  }

  return (
    <section className="hero" aria-label="日本列島の気温偏差の推移">
      <div className="hero-copy">
        <motion.p className="eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          気象庁 158 地点 · {firstYear}–{lastYear}
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }}>
          日本は、<br />どこから<br />暑くなったか。
        </motion.h1>
        <div className="year-counter" aria-live="polite">
          <span className="year-digits">{shownYear}</span>
          <span className="year-suffix">年</span>
        </div>
        {summary && (
          <p className="hero-summary">
            観測していた <strong>{summary.count}</strong> 地点のうち{' '}
            <strong style={{ color: anomalyColor(1.6) }}>{summary.warmer}</strong> 地点が、1961–1990 年の平年より暑かった。
            全地点の平均は <strong style={{ color: anomalyColor(summary.mean * 1.6) }}>{formatAnom(summary.mean)}</strong>。
          </p>
        )}
      </div>

      <div className="hero-map" ref={mapRef} onMouseLeave={() => setHover(null)}>
        <canvas ref={canvasRef} className="bloom" style={{ width: size.w, height: size.h }} aria-hidden />
        <svg width={size.w} height={size.h} role="img" aria-label={`${shownYear} 年の各地点の平年差`}>
          {wire && (
            <g className="wire" aria-hidden>
              <g className="wire-grat">{wire.grat.map((d, i) => <path key={i} d={d} />)}</g>
              <g className="wire-borders">{wire.borders.map((d, i) => <path key={i} d={d} pathLength={1} />)}</g>
              <g className="wire-coast">{wire.coast.map((d, i) => <path key={i} d={d} pathLength={1} />)}</g>
            </g>
          )}
          <rect x={inset.x} y={inset.y} width={inset.w} height={inset.h} rx={6} fill="none" stroke="#2b2925" strokeDasharray="3 4" />
          <text x={inset.x + 8} y={inset.y - 6} className="inset-label">小笠原・南鳥島</text>
          {stations.map((s) => {
            const v = frame?.values.get(s.block)
            const [x, y] = project(s.lat, s.lon)
            const active = hover === s.block || selected === s.block
            return (
              <g key={s.block} transform={`translate(${x},${y})`}>
                <circle
                  r={active ? 7 : v ? 4.2 : 2}
                  fill={v ? anomalyColor(v.anom) : 'none'}
                  stroke={v ? (active ? '#f3efe6' : '#0f0e0c') : '#3a3833'}
                  strokeWidth={active ? 2 : 1}
                  style={{ transition: 'r 160ms ease, fill 260ms linear' }}
                />
                <circle
                  r={14}
                  fill="transparent"
                  onMouseEnter={() => setHover(s.block)}
                  onClick={() => onSelect(s.block)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{s.name}</title>
                </circle>
              </g>
            )
          })}
        </svg>
        {hovered && (
          <div className="tip" style={{ left: project(hovered.lat, hovered.lon)[0], top: project(hovered.lat, hovered.lon)[1] }}>
            <b>{hovered.name}</b>
            <span>{hoveredValue ? `${hoveredValue.tavg.toFixed(1)}℃ · ${formatAnom(hoveredValue.anom)}` : 'この年の記録なし'}</span>
            <em>クリックで詳しく</em>
          </div>
        )}
      </div>

      <div className="scrubber">
        <button
          className="play"
          onClick={() => {
            if (year >= lastYear) setYear(firstYear)
            setPlaying((p) => !p)
          }}
          aria-label={playing ? '一時停止' : '再生'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div
          className="track"
          role="slider"
          tabIndex={0}
          aria-label="年"
          aria-valuemin={firstYear}
          aria-valuemax={lastYear}
          aria-valuenow={year}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            onScrub(e.clientX, e.currentTarget)
          }}
          onPointerMove={(e) => {
            if (e.buttons) onScrub(e.clientX, e.currentTarget)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setYear((y) => Math.min(lastYear, y + 1))
            if (e.key === 'ArrowLeft') setYear((y) => Math.max(firstYear, y - 1))
            if (e.key === ' ') {
              e.preventDefault()
              setPlaying((p) => !p)
            }
          }}
        >
          {national.map((n) => (
            <i key={n.year} style={{ background: anomalyColor(n.anom), flexGrow: 1 }} title={`${n.year}年 全国平均 ${formatAnom(n.anom)}`} />
          ))}
          <span className="handle" style={{ left: `${((year - firstYear) / (lastYear - firstYear)) * 100}%` }} />
        </div>
        <div className="scrub-labels">
          <span>{firstYear}</span>
          <span>全国平均の平年差（縞 1 本 = 1 年）</span>
          <span>{lastYear}</span>
        </div>
        {frame && (
          <code className="frame-sql">
            SELECT block, anom FROM anomalies WHERE year = {frame.year} <span>· {frame.ms.toFixed(1)} ms</span>
          </code>
        )}
      </div>
    </section>
  )
}
