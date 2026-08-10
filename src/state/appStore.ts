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
}

export const useAppStore = create<AppState>((set) => ({
  currentStep: 1,
  setStep: (step) => set({ currentStep: step }),

  showLogConsole: false,
  setShowLogConsole: (show) => set({ showLogConsole: show }),
}))
