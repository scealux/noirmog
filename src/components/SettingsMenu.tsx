import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { runDemoTask, runFailingDemoTask } from '../lib/demoTasks'

export function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const showLogConsole = useAppStore((s) => s.showLogConsole)
  const setShowLogConsole = useAppStore((s) => s.setShowLogConsole)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="settings" ref={rootRef}>
      <button
        className={`icon-button${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="settings-menu" role="menu">
          <div className="menu-heading">View</div>
          <button
            className="menu-item"
            role="menuitemcheckbox"
            aria-checked={showLogConsole}
            onClick={() => setShowLogConsole(!showLogConsole)}
          >
            <input type="checkbox" checked={showLogConsole} readOnly tabIndex={-1} />
            Show log console
          </button>

          <div className="menu-sep" />
          <div className="menu-heading">Diagnostics</div>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void runDemoTask()
            }}
          >
            Run demo task
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void runFailingDemoTask()
            }}
          >
            Run failing demo task
          </button>
        </div>
      )}
    </div>
  )
}
