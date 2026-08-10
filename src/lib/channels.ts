import * as THREE from 'three'
import { blendshapeForFrame, matrixForFrame, type TrackingData } from './trackingData'

/**
 * Driver channel system: named float channels sampled per frame, applied to the
 * head rig. v1 ships head rotation + jawOpen; new channels = new entries in
 * CHANNEL_APPLIERS plus a sampler that fills them — no refactoring.
 */
export type ChannelValues = Record<string, number>

export interface HeadRig {
  /** Group whose origin sits at the neck pivot; rotation channels apply here. */
  headGroup: THREE.Object3D
  /** Mesh with morph target 0 = jawOpen. */
  mesh: THREE.Mesh
}

export type ChannelApplier = (value: number, rig: HeadRig) => void

export const CHANNEL_APPLIERS: Record<string, ChannelApplier> = {
  headYaw: (v, rig) => {
    rig.headGroup.rotation.y = v
  },
  headPitch: (v, rig) => {
    rig.headGroup.rotation.x = v
  },
  headRoll: (v, rig) => {
    rig.headGroup.rotation.z = v
  },
  jawOpen: (v, rig) => {
    if (rig.mesh.morphTargetInfluences) rig.mesh.morphTargetInfluences[0] = v
  },
}

export function applyChannels(values: ChannelValues, rig: HeadRig): void {
  for (const [name, value] of Object.entries(values)) {
    CHANNEL_APPLIERS[name]?.(value, rig)
  }
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const qRef = new THREE.Quaternion()
const qRel = new THREE.Quaternion()
const euler = new THREE.Euler()
const pos = new THREE.Vector3()
const scl = new THREE.Vector3()

/** Samples per-frame channel values from tracking data. */
export class ChannelSampler {
  private data: TrackingData
  private jawIndex: number
  private refRotation: THREE.Quaternion

  constructor(data: TrackingData) {
    this.data = data
    this.jawIndex = data.blendshapeNames.indexOf('jawOpen')
    // Reference = first tracked frame, so the subject's resting webcam angle
    // reads as neutral and only performance motion drives the head.
    const first = data.tracked.findIndex((t) => t === 1)
    m4.fromArray(matrixForFrame(data, Math.max(0, first)))
    m4.decompose(pos, qRef, scl)
    this.refRotation = qRef.clone().invert()
  }

  sample(frame: number, out: ChannelValues = {}): ChannelValues {
    m4.fromArray(matrixForFrame(this.data, frame))
    m4.decompose(pos, q, scl)
    qRel.copy(this.refRotation).multiply(q)
    euler.setFromQuaternion(qRel, 'YXZ')
    out.headYaw = euler.y
    out.headPitch = euler.x
    out.headRoll = euler.z
    out.jawOpen =
      this.jawIndex >= 0 ? blendshapeForFrame(this.data, frame, this.jawIndex) : 0
    return out
  }
}
