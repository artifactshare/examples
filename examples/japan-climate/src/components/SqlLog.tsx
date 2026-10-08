import { useState, useSyncExternalStore } from 'react'
import { getLogs, subscribeLogs } from '../db'

// A live log of every query the page runs, so readers can see that each
// interaction is SQL executed in their own browser.
export function SqlLog() {
  const logs = useSyncExternalStore(subscribeLogs, () => getLogs()[0]?.id ?? 0)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const list = getLogs()
  const latest = list[0]
  void logs

  return (
    <aside className={open ? 'sqllog is-open' : 'sqllog'} aria-label="実行した SQL">
      <button className="sqllog-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="pulse" key={latest?.id} />
        <span className="sqllog-title">DuckDB-WASM</span>
        {latest && (
          <span className="sqllog-latest">
            {latest.label} · {latest.ms.toFixed(1)} ms
          </span>
        )}
        <span className="sqllog-count">{list.length} 件</span>
      </button>
      {open && (
        <ol className="sqllog-list">
          {list.map((q) => (
            <li key={q.id} className={q.error ? 'is-error' : ''}>
              <button onClick={() => setExpanded(expanded === q.id ? null : q.id)}>
                <span>{q.label}</span>
                <span className="mono">
                  {q.error ? 'error' : `${q.rows} 行`} · {q.ms.toFixed(1)} ms
                </span>
              </button>
              {expanded === q.id && <pre>{q.error ?? q.sql}</pre>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
