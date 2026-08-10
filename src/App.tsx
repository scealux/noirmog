import { TopBar } from './components/TopBar'
import { Viewport } from './components/Viewport'
import { StepPanel } from './components/StepPanel'
import { TaskProgress } from './components/TaskProgress'
import { LogConsole } from './components/LogConsole'
import { StatusBar } from './components/StatusBar'
import { useAppStore } from './state/appStore'

export default function App() {
  const showLogConsole = useAppStore((s) => s.showLogConsole)

  return (
    <div className="app">
      <TopBar />
      <main className="app-main">
        <div className="center-stage">
          <Viewport />
          <TaskProgress />
        </div>
        <StepPanel />
      </main>
      {showLogConsole && <LogConsole />}
      <StatusBar />
    </div>
  )
}
