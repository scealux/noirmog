import { create } from 'zustand'

export type StepId = 1 | 2 | 3

export const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: 1, title: 'Adjust Base Mesh', blurb: 'Fit the generic head to your subject' },
  { id: 2, title: 'Capture Performance', blurb: 'Record or upload, then track & stabilize' },
  { id: 3, title: 'Edit & Export', blurb: 'Trim, blend, preview and export' },
]

interface AppState {
  currentStep: StepId
  setStep: (step: StepId) => void

  showLogConsole: boolean
  setShowLogConsole: (show: boolean) => void

  panelWidth: number
  setPanelWidth: (w: number) => void
}

const PANEL_WIDTH_KEY = 'noirmog.panelWidth'
export const PANEL_MIN = 280
export const PANEL_MAX = 560

function loadPanelWidth(): number {
  const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(stored) && stored >= PANEL_MIN && stored <= PANEL_MAX ? stored : 320
}

export const useAppStore = create<AppState>((set) => ({
  currentStep: 1,
  setStep: (step) => set({ currentStep: step }),

  showLogConsole: false,
  setShowLogConsole: (show) => set({ showLogConsole: show }),

  panelWidth: loadPanelWidth(),
  setPanelWidth: (w) => {
    const clamped = Math.min(PANEL_MAX, Math.max(PANEL_MIN, w))
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped))
    set({ panelWidth: clamped })
  },
}))
