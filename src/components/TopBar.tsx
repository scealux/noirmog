import { Stepper } from './Stepper'
import { SettingsMenu } from './SettingsMenu'

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-logo">
        NOIR<span className="accent">MOG</span>
      </div>
      <div className="topbar-spacer" />
      <Stepper />
      <div className="topbar-spacer" />
      <SettingsMenu />
    </header>
  )
}
