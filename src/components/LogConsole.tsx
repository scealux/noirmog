import { useEffect, useRef, useState } from 'react'
import { useTaskStore, type LogLevel } from '../state/taskStore'

const LEVELS: LogLevel[] = ['info', 'success', 'warn', 'error']

function formatTime(t: number): string {
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export function LogConsole() {
  const logs = useTaskStore((s) => s.logs)
  const clearLogs = useTaskStore((s) => s.clearLogs)
  const [enabled, setEnabled] = useState<Record<LogLevel, boolean>>({
    info: true,
    success: true,
    warn: true,
    error: true,
  })
  const bodyRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  const visible = logs.filter((entry) => enabled[entry.level])

  // Auto-scroll to newest unless the user has scrolled up to read.
  useEffect(() => {
    const el = bodyRef.current
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

  return (
    <section className="log-console" aria-label="Log console">
      <div className="log-toolbar">
        <span className="title">Log</span>
        {LEVELS.map((level) => (
          <button
            key={level}
            className={enabled[level] ? 'on' : ''}
            onClick={() => setEnabled((prev) => ({ ...prev, [level]: !prev[level] }))}
            aria-pressed={enabled[level]}
          >
            {level}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={clearLogs}>Clear</button>
      </div>
      <div className="log-body" ref={bodyRef} onScroll={onScroll}>
        {visible.length === 0 ? (
          <div className="log-empty">No log entries{logs.length > 0 ? ' at these levels' : ''}.</div>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className={`log-row ${entry.level}`}>
              <span className="time">{formatTime(entry.time)}</span>
              <span className="level">{entry.level.toUpperCase()}</span>
              <span className="source">{entry.source}</span>
              <span className="message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
