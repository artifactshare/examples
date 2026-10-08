import { useEffect, useMemo, useRef, useState } from 'react'
import { anomalyColor, formatAnom } from '../color'
import type { AnomalyGrid, Station } from '../types'

type Props = {
  stations: Station[] // north → south
  grid: AnomalyGrid
  firstYear: number
  lastYear: number
  selected: string | null
  onSelect: (block: string) => void
}

const ANCHORS = ['稚内', '札幌', '仙台', '東京', '名古屋', '大阪', '広島', '福岡', '鹿児島', '那覇', '石垣島']
const LABEL_W = 64

export function StripesWall({ stations, grid, firstYear, lastYear, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ row: number; year: number; x: number; y: number } | null>(null)
  const rows = useMemo(() => stations.filter((s) => grid.has(s.block)), [stations, grid])
  const rowH = width < 640 ? 3 : 4
  const height = rows.length * rowH
  const years = lastYear - firstYear + 1

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const plotW = width - LABEL_W
    const dpr = window.devicePixelRatio || 1
    canvas.width = plotW * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, plotW, height)
    const cw = plotW / years
    rows.forEach((s, r) => {
      const series = grid.get(s.block)!
      for (const [year, anom] of series) {
        ctx.fillStyle = anomalyColor(anom)
        ctx.fillRect(Math.floor((year - firstYear) * cw), r * rowH, Math.ceil(cw) + 0.5, rowH)
      }
    })
  }, [rows, grid, width, height, years, firstYear, rowH])

  const plotW = Math.max(0, width - LABEL_W)
  const hoverStation = hover ? rows[hover.row] : null
  const hoverAnom = hoverStation ? grid.get(hoverStation.block)?.get(hover!.year) : undefined
  const selectedRow = rows.findIndex((s) => s.block === selected)

  const locate = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const row = Math.min(rows.length - 1, Math.max(0, Math.floor(y / rowH)))
    const year = Math.min(lastYear, Math.max(firstYear, firstYear + Math.floor((x / r.width) * years)))
    return { row, year, x, y }
  }

  return (
    <section className="wall" aria-labelledby="wall-title">
      <header className="section-head">
        <p className="eyebrow">01 · 縞の壁</p>
        <h2 id="wall-title">{rows.length} 地点 × {years} 年を、一枚に。</h2>
        <p className="lede">
          1 行が 1 地点（上が北、下が南）、1 本の縞が 1 年。青は 1961–1990 年の平年より涼しく、赤は暑い年です。
          どの地点も、右へ行くほど赤くなります。行をクリックすると、その地点を詳しく見られます。
        </p>
      </header>
      <div className="wall-body" ref={wrapRef} style={{ height }}>
        <div className="wall-labels" style={{ width: LABEL_W }}>
          {rows.map((s, i) =>
            ANCHORS.includes(s.name) || i === selectedRow ? (
              <span key={s.block} className={i === selectedRow ? 'is-selected' : ''} style={{ top: i * rowH + rowH / 2 }}>
                {s.name}
              </span>
            ) : null,
          )}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: plotW, height, left: LABEL_W }}
          onPointerMove={(e) => setHover(locate(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSelect(rows[locate(e).row].block)}
          role="img"
          aria-label="地点ごとの年平均気温の平年差。上が北、右が新しい年。"
        />
        {selectedRow >= 0 && <div className="wall-row-mark" style={{ top: selectedRow * rowH - 1, height: rowH + 2, left: LABEL_W }} />}
        {hover && (
          <>
            <div className="wall-cross-v" style={{ left: LABEL_W + hover.x }} />
            <div className="tip wall-tip" style={{ left: LABEL_W + hover.x, top: hover.y }}>
              <b>{hoverStation?.name} · {hover.year}年</b>
              <span>{hoverAnom === undefined ? '記録なし（欠測・資料不足）' : `平年差 ${formatAnom(hoverAnom)}`}</span>
            </div>
          </>
        )}
      </div>
      <div className="wall-axis" style={{ marginLeft: LABEL_W }}>
        {[1880, 1900, 1920, 1940, 1960, 1980, 2000, 2020].filter((y) => y >= firstYear).map((y) => (
          <span key={y} style={{ left: `${((y - firstYear) / years) * 100}%` }}>{y}</span>
        ))}
      </div>
      <Legend />
    </section>
  )
}

export function Legend() {
  const steps = [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]
  return (
    <div className="legend" aria-label="色の凡例：平年差">
      <span>涼しい</span>
      <div className="legend-bar">
        {steps.map((s) => (
          <i key={s} style={{ background: anomalyColor(s) }} title={formatAnom(s)} />
        ))}
      </div>
      <span>暑い</span>
      <small>−2.5℃ … 平年 … +2.5℃（1961–1990 年平均との差）</small>
    </div>
  )
}
