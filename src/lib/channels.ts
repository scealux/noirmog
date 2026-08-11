import * as THREE from 'three'
import { matrixForFrame, BLENDSHAPE_COUNT, type TrackingData } from './trackingData'
import type { ChannelEditSettings } from '../state/performanceStore'
import type { BoneHeadRig } from './headMesh'

/**
 * Driver channel system: named float channels sampled per frame, applied to the
 * head rig. v1 ships head rotation + jawOpen; new channels = new entries in
 * CHANNEL_APPLIERS plus a row in the sampler's precomputed set — no refactoring.
 */
export type ChannelValues = Record<string, number>

export type ChannelApplier = (value: number, rig: BoneHeadRig) => void

export const CHANNEL_APPLIERS: Record<string, ChannelApplier> = {
  headYaw: (v, rig) => {
    rig.yaw = v
  },
  headPitch: (v, rig) => {
    rig.pitch = v
  },
  headRoll: (v, rig) => {
    rig.roll = v
  },
  jawOpen: (v, rig) => {
    rig.jawOpen = v
  },
}

export function applyChannels(values: ChannelValues, rig: BoneHeadRig): void {
  for (const [name, value] of Object.entries(values)) {
    CHANNEL_APPLIERS[name]?.(value, rig)
  }
  rig.apply()
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const qRef = new THREE.Quaternion()
const qRel = new THREE.Quaternion()
const euler = new THREE.Euler()
const pos = new THREE.Vector3()
const scl = new THREE.Vector3()

/** Which precomputed channels count as "head motion" for the scale control. */
const HEAD_CHANNELS = ['headYaw', 'headPitch', 'headRoll'] as const

/**
 * Samples per-frame channel values from tracking data. Raw values are
 * precomputed once per performance; edit settings (smoothing radius, scales)
 * are applied at sample time so they stay non-destructive and live-tweakable.
 */
export class ChannelSampler {
  private frameCount: number
  private raw: Record<string, Float32Array>

  constructor(data: TrackingData) {
    this.frameCount = data.frameCount
    const yaw = new Float32Array(data.frameCount)
    const pitch = new Float32Array(data.frameCount)
    const roll = new Float32Array(data.frameCount)
    const jaw = new Float32Array(data.frameCount)

    // Reference = first tracked frame, so the subject's resting webcam angle
    // reads as neutral and only performance motion drives the head.
    const firstTracked = Math.max(0, data.tracked.findIndex((t) => t === 1))
    m4.fromArray(matrixForFrame(data, firstTracked))
    m4.decompose(pos, qRef, scl)
    const refInv = qRef.clone().invert()

    const jawIndex = data.blendshapeNames.indexOf('jawOpen')
    for (let f = 0; f < data.frameCount; f++) {
      m4.fromArray(matrixForFrame(data, f))
      m4.decompose(pos, q, scl)
      qRel.copy(refInv).multiply(q)
      euler.setFromQuaternion(qRel, 'YXZ')
      yaw[f] = euler.y
      pitch[f] = euler.x
      roll[f] = euler.z
      jaw[f] = jawIndex >= 0 ? data.blendshapes[f * BLENDSHAPE_COUNT + jawIndex] : 0
    }
    this.raw = { headYaw: yaw, headPitch: pitch, headRoll: roll, jawOpen: jaw }
  }

  private smoothed(name: string, frame: number, radius: number): number {
    const arr = this.raw[name]
    if (radius <= 0) return arr[frame]
    const from = Math.max(0, frame - radius)
    const to = Math.min(this.frameCount - 1, frame + radius)
    let sum = 0
    for (let f = from; f <= to; f++) sum += arr[f]
    return sum / (to - from + 1)
  }

  sample(frame: number, settings: ChannelEditSettings, out: ChannelValues = {}): ChannelValues {
    const f = Math.min(this.frameCount - 1, Math.max(0, frame))
    const radius = Math.round(settings.smoothing)
    for (const name of HEAD_CHANNELS) {
      out[name] = this.smoothed(name, f, radius) * settings.headMotionScale
    }
    out.jawOpen = Math.min(1, Math.max(0, this.smoothed('jawOpen', f, radius) * settings.jawScale))
    return out
  }
}
