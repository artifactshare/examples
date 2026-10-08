import { useEffect, useState } from 'react'
import { anomalyColor } from '../color'
import { run, type Row } from '../db'

type Preset = { id: string; label: string; sql: string; unit?: string; signed?: boolean }

const PRESETS: Preset[] = [
  {
    id: 'fastest',
    label: '温暖化がいちばん速い 10 地点',
    unit: '℃/10年',
    signed: true,
    sql: `-- 1961 年以降の年平均気温の上昇率（10 年あたり）
SELECT s.name AS 地点, round(regr_slope(a.tavg, a.year) * 10, 2) AS 上昇
FROM annual a JOIN stations s USING (block)
WHERE a.year >= 1961
GROUP BY s.name HAVING count(*) >= 50
ORDER BY 上昇 DESC LIMIT 10`,
  },
  {
    id: 'hottest-months',
    label: '観測史上いちばん暑い月',
    unit: '℃',
    sql: `-- 月平均気温の上位 10 件（資料不足の月は除く）
SELECT s.name || ' ' || m.year || '年' || m.month || '月' AS 記録, m.tavg AS 月平均気温
FROM monthly m JOIN stations s USING (block)
WHERE m.tavg_q < 2
ORDER BY m.tavg DESC LIMIT 10`,
  },
  {
    id: 'snow',
    label: '雪が減った街',
    unit: 'cm',
    sql: `-- 年間降雪量：1961–1990 年平均 → 1996–2025 年平均の差
SELECT s.name AS 地点,
       round(avg(snow) FILTER (WHERE year BETWEEN 1996 AND 2025)
           - avg(snow) FILTER (WHERE year BETWEEN 1961 AND 1990)) AS 増減
FROM annual a JOIN stations s USING (block)
GROUP BY s.name
HAVING avg(snow) FILTER (WHERE year BETWEEN 1961 AND 1990) > 50
ORDER BY 増減 ASC LIMIT 10`,
  },
  {
    id: 'summer',
    label: '真夏の月は何倍になった？',
    sql: `-- 月平均気温 25℃ 以上の「真夏の月」の数（全地点合計、10 年ごと）
SELECT (year // 10 * 10)::VARCHAR || '年代' AS 年代, count(*) AS 真夏の月
FROM monthly
WHERE tavg >= 25 AND tavg_q < 2 AND year BETWEEN 1930 AND 2019
GROUP BY ALL ORDER BY 年代`,
  },
  {
    id: 'rain',
    label: '1 年でいちばん雨が多かった記録',
    unit: 'mm',
    sql: `-- 年間降水量の上位 10 件（12 か月そろった年）
SELECT s.name || ' ' || a.year || '年' AS 記録, round(a.precip) AS 年間降水量
FROM annual a JOIN stations s USING (block)
ORDER BY a.precip DESC NULLS LAST LIMIT 10`,
  },
]

const ALLOWED = /^\s*(--[^\n]*\n\s*)*(select|with|from|summarize|describe|show)\b/i

export function Ask() {
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [sql, setSql] = useState(PRESETS[0].sql)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ms, setMs] = useState<number | null>(null)

  const execute = async (text: string, label: string) => {
    if (!ALLOWED.test(text)) {
      setError('読み取りのクエリ（SELECT / WITH / FROM / SUMMARIZE）だけ実行できます。')
      return
    }
    setError(null)
    const started = performance.now()
    try {
      setRows(await run(label, text))
      setMs(performance.now() - started)
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
      setRows([])
    }
  }

  useEffect(() => {
    execute(preset.sql, preset.label)
  }, [preset])

  const columns = rows[0] ? Object.keys(rows[0]) : []
  const valueCol = columns.find((c, i) => i > 0 && typeof rows[0][c] === 'number')
  const max = valueCol ? Math.max(...rows.map((r) => Math.abs(Number(r[valueCol]) || 0))) : 0

  return (
    <section className="ask" aria-labelledby="ask-title">
      <header className="section-head">
        <p className="eyebrow">03 · データに聞く</p>
        <h2 id="ask-title">20 万行に、その場で SQL を。</h2>
        <p className="lede">
          サーバーはありません。この画面の中で DuckDB が動いていて、問いを選ぶたびに Parquet を直接集計します。SQL は書き換えて、そのまま実行できます。
        </p>
      </header>
      <div className="chips" role="tablist" aria-label="問い">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === preset.id}
            className={p.id === preset.id ? 'chip is-on' : 'chip'}
            onClick={() => {
              setPreset(p)
              setSql(p.sql)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="ask-body">
        <div className="editor">
          <textarea
            value={sql}
            spellCheck={false}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') execute(sql, 'SQL を実行')
            }}
            aria-label="SQL"
          />
          <div className="editor-bar">
            <span>テーブル: stations · monthly · annual · anomalies · normals</span>
            <button className="run" onClick={() => execute(sql, 'SQL を実行')}>
              実行 <kbd>⌘↵</kbd>
            </button>
          </div>
        </div>
        <div className="result" aria-live="polite">
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <>
              <p className="result-meta">
                {rows.length} 行 {ms !== null && <span>· {ms.toFixed(1)} ms</span>}
              </p>
              {valueCol && columns.length === 2 ? (
                <ol className="bars">
                  {rows.map((r, i) => {
                    const v = Number(r[valueCol])
                    return (
                      <li key={i} style={{ animationDelay: `${i * 40}ms` }}>
                        <span className="bar-label">{String(r[columns[0]])}</span>
                        <span className="bar-track">
                          <span
                            className="bar-fill"
                            style={{
                              width: `${max ? (Math.abs(v) / max) * 100 : 0}%`,
                              background: preset.signed || v < 0 ? anomalyColor(v < 0 ? -1.8 : 1.8) : 'var(--ink-2)',
                            }}
                          />
                        </span>
                        <span className="bar-value">
                          {v > 0 && preset.signed ? '+' : ''}
                          {v.toLocaleString('ja-JP')}
                          {preset.unit && <small>{preset.unit}</small>}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((r, i) => (
                        <tr key={i}>{columns.map((c) => <td key={c}>{r[c] === null ? '—' : String(r[c])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
