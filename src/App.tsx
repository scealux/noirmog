import { TopBar } from './components/TopBar'
import { Viewport } from './components/Viewport'
import { StepPanel } from './components/StepPanel'
import { TaskProgress } from './components/TaskProgress'
import { LogConsole } from './components/LogConsole'
import { StatusBar } from './components/StatusBar'
import { useAppStore } from './state/appStore'
import { useRef } from 'react'

function PanelDivider() {
  const setPanelWidth = useAppStore((s) => s.setPanelWidth)
  const dragging = useRef(false)
  return (
    <div
      className="panel-divider"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.classList.add('dragging')
      }}
      onPointerMove={(e) => {
        if (dragging.current) setPanelWidth(window.innerWidth - e.clientX)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.classList.remove('dragging')
      }}
      title="Drag to resize panel"
    />
  )
}

export default function App() {
  const showLogConsole = useAppStore((s) => s.showLogConsole)
  const panelWidth = useAppStore((s) => s.panelWidth)

  return (
    <div className="app" style={{ '--panel-width': panelWidth + 'px' } as React.CSSProperties}>
      <TopBar />
      <main className="app-main">
        <div className="center-stage">
          <Viewport />
          <TaskProgress />
        </div>
        <PanelDivider />
        <StepPanel />
      </main>
      {showLogConsole && <LogConsole />}
      <StatusBar />
    </div>
  )
}
