import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { canonicalPositions, canonicalVertex, CANONICAL_VERTEX_COUNT } from './canonicalFace'
import { PipelineError } from './runTask'

/** User-adjustable placement of the face texture on the head. */
export interface FaceFitSettings {
  /** Scale of the landmark layout around the face center (1 = auto fit). */
  scale: number
  /** Vertical offset in head space (meters, + is up). */
  offsetY: number
}

/** How much of the head rotation is carried by the neck bone (rest by the head). */
const NECK_SHARE = 0.3
const JAW_MAX_ANGLE = THREE.MathUtils.degToRad(22)

/**
 * Drives the head's armature (Torso > Neck > Head > Jaw). Rotations are given
 * in tracking (world) axes; the neck carries a share of the motion and the
 * head bone lands on the exact tracked rotation, so the torso never moves.
 */
export class BoneHeadRig {
  yaw = 0
  pitch = 0
  roll = 0
  jawOpen = 0

  private neck: THREE.Bone
  private head: THREE.Bone
  private jaw: THREE.Bone
  private neckRest: THREE.Quaternion
  private jawRest: THREE.Quaternion
  private torsoWorld: THREE.Quaternion
  private torsoWorldInv: THREE.Quaternion
  private headWorldRest: THREE.Quaternion

  private e = new THREE.Euler()
  private qShare = new THREE.Quaternion()
  private qFull = new THREE.Quaternion()
  private qTmp = new THREE.Quaternion()
  private qJaw = new THREE.Quaternion()
  private xAxis = new THREE.Vector3(1, 0, 0)

  constructor(neck: THREE.Bone, head: THREE.Bone, jaw: THREE.Bone, scene: THREE.Object3D) {
    this.neck = neck
    this.head = head
    this.jaw = jaw
    scene.updateMatrixWorld(true)
    this.neckRest = neck.quaternion.clone()
    this.jawRest = jaw.quaternion.clone()
    this.torsoWorld = neck.parent!.getWorldQuaternion(new THREE.Quaternion())
    this.torsoWorldInv = this.torsoWorld.clone().invert()
    this.headWorldRest = head.getWorldQuaternion(new THREE.Quaternion())
  }

  apply(): void {
    // Neck takes its share of the rotation, expressed in world axes.
    this.e.set(this.pitch * NECK_SHARE, this.yaw * NECK_SHARE, this.roll * NECK_SHARE, 'YXZ')
    this.qShare.setFromEuler(this.e)
    this.neck.quaternion
      .copy(this.torsoWorldInv)
      .multiply(this.qShare)
      .multiply(this.torsoWorld)
      .multiply(this.neckRest)

    // Head bone lands exactly on the full tracked rotation regardless of the
    // neck's contribution: headWorld = R_full * headWorldRest.
    this.e.set(this.pitch, this.yaw, this.roll, 'YXZ')
    this.qFull.setFromEuler(this.e)
    const neckWorldNow = this.qTmp.copy(this.torsoWorld).multiply(this.neck.quaternion)
    this.head.quaternion
      .copy(neckWorldNow)
      .invert()
      .multiply(this.qFull)
      .multiply(this.headWorldRest)

    this.qJaw.setFromAxisAngle(this.xAxis, this.jawOpen * JAW_MAX_ANGLE)
    this.jaw.quaternion.copy(this.jawRest).multiply(this.qJaw)
  }
}

/**
 * The head prepared for the pipeline:
 * - scene: the rigged head (skinned mesh + armature) to add to the viewport
 * - rig: bone driver for head rotation + jaw
 * - mapToUV: computes, for each of the 468 landmarks, its fixed destination in
 *   the head's UV square under the given fit settings. Warping video frames to
 *   these fixed destinations is what stabilizes the texture AND lays it out in
 *   UV space in one step.
 */
/** Coarse Step 1 morphs; 1 = the unmodified base head. */
export interface HeadMorphSettings {
  faceWidth: number
  faceLength: number
  jawWidth: number
  headDepth: number
}

export const DEFAULT_HEAD_MORPH: HeadMorphSettings = {
  faceWidth: 1,
  faceLength: 1,
  jawWidth: 1,
  headDepth: 1,
}

export interface PreparedHead {
  scene: THREE.Group
  skinnedMesh: THREE.SkinnedMesh
  rig: BoneHeadRig
  geometry: THREE.BufferGeometry
  mapToUV: (fit: FaceFitSettings) => Float32Array // 468 * 2, in UV space
  /** Re-deform the head from its base shape (non-destructive, call freely). */
  applyMorph: (morph: HeadMorphSettings) => void
  bounds: THREE.Box3
}

interface SimilarityFit {
  scale: number
  tx: number
  ty: number
}

/** Nose tip = frontmost vertex; chin = lowest near-symmetry vertex that is still front. */
function findFaceAnchors(pos: ArrayLike<number>, count: number) {
  let noseIdx = 0
  let maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const z = pos[i * 3 + 2]
    if (z > maxZ) {
      maxZ = z
      noseIdx = i
    }
  }
  const nose = [pos[noseIdx * 3], pos[noseIdx * 3 + 1], pos[noseIdx * 3 + 2]]

  let xMin = Infinity
  let xMax = -Infinity
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3]
    if (x < xMin) xMin = x
    if (x > xMax) xMax = x
  }
  const xTol = (xMax - xMin) * 0.06

  let chinY = Infinity
  let chin = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    if (Math.abs(x - nose[0]) < xTol && z > maxZ * 0.55 && y < chinY) {
      chinY = y
      chin = [x, y, z]
    }
  }
  return { nose, chin }
}

/**
 * Fit scale + translation (no rotation; both faces are upright and x-symmetric)
 * taking canonical face space (cm) into head mesh space (m), matched on the
 * nose-tip → chin segment.
 */
function fitCanonicalToHead(headPos: ArrayLike<number>, headCount: number): SimilarityFit {
  const head = findFaceAnchors(headPos, headCount)
  const canon = findFaceAnchors(canonicalPositions, CANONICAL_VERTEX_COUNT)

  const headSpan = Math.hypot(head.nose[1] - head.chin[1], head.nose[0] - head.chin[0])
  const canonSpan = Math.hypot(canon.nose[1] - canon.chin[1], canon.nose[0] - canon.chin[0])
  const scale = headSpan / canonSpan
  return {
    scale,
    tx: head.nose[0] - scale * canon.nose[0],
    ty: head.nose[1] - scale * canon.nose[1],
  }
}

/**
 * Map face-space points into the head's UV square by raycasting front-on onto
 * the mesh surface and reading the authored UVs at the hit point. Exact for
 * any unwrap (the authored layout spreads the face to fill the square, so a
 * global affine fit is NOT a valid approximation).
 */
function makeSurfaceUVLookup(
  geometry: THREE.BufferGeometry,
): (x: number, y: number) => [number, number] | null {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  const bounds = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  )
  const raycaster = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const dir = new THREE.Vector3(0, 0, -1)

  return (x, y) => {
    origin.set(x, y, bounds.max.z + 1)
    raycaster.set(origin, dir)
    const hit = raycaster.intersectObject(mesh, false)[0]
    return hit?.uv ? [hit.uv.x, hit.uv.y] : null
  }
}

/** Selectable base heads. All must share the bone contract (see findBone). */
export const HEAD_MODELS = [
  { id: 'classic', label: 'Classic (low-poly)', file: 'models/head.glb' },
  { id: 'detailed', label: 'Detailed (eyes + mouth pocket)', file: 'models/head-detailed.glb' },
] as const

export type HeadModelId = (typeof HEAD_MODELS)[number]['id']

let activeHeadId: HeadModelId = 'classic'
export function setActiveHeadModel(id: HeadModelId): void {
  activeHeadId = id
}
export function getActiveHeadModel(): HeadModelId {
  return activeHeadId
}

const cache = new Map<string, Promise<PreparedHead>>()

export function prepareHead(id?: HeadModelId): Promise<PreparedHead> {
  const model = HEAD_MODELS.find((m) => m.id === (id ?? activeHeadId)) ?? HEAD_MODELS[0]
  const url = import.meta.env.BASE_URL + model.file
  let entry = cache.get(url)
  if (!entry) {
    entry = loadAndPrepare(url).catch((err) => {
      cache.delete(url)
      throw err
    })
    cache.set(url, entry)
  }
  return entry
}

async function loadAndPrepare(url: string): Promise<PreparedHead> {
  const gltf = await new GLTFLoader().loadAsync(url)
  let skinnedMesh: THREE.SkinnedMesh | null = null
  const bones = new Map<string, THREE.Bone>()
  gltf.scene.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh) {
      // The face mesh = the biggest skinned mesh (extra meshes are eyes/teeth).
      const count = (obj.geometry as THREE.BufferGeometry).getAttribute('position').count
      const best = skinnedMesh
        ? (skinnedMesh.geometry as THREE.BufferGeometry).getAttribute('position').count
        : -1
      if (count > best) skinnedMesh = obj
    }
    if (obj instanceof THREE.Bone) bones.set(obj.name, obj)
  })
  const findBone = (...names: string[]) => names.map((n) => bones.get(n)).find(Boolean)
  if (!skinnedMesh) {
    throw new PipelineError(
      'No skinned mesh found in head GLB',
      'The head model must be rigged (Torso/Neck/Head/Jaw bones). Check public/models/head.glb',
    )
  }
  skinnedMesh = skinnedMesh as THREE.SkinnedMesh
  const neckBone = findBone('Neck')
  const headBone = findBone('Head')
  const jawBone = findBone('Jaw', 'Jaw_D')
  if (!neckBone || !headBone || !jawBone) {
    throw new PipelineError(
      `Head GLB is missing bones (found: ${[...bones.keys()].join(', ') || 'none'})`,
      'Expected bones named Neck, Head and Jaw.',
    )
  }
  skinnedMesh.frustumCulled = false
  const geometry = skinnedMesh.geometry as THREE.BufferGeometry
  if (!geometry.getAttribute('uv')) throw new PipelineError('Head mesh has no UVs')
  const rig = new BoneHeadRig(neckBone, headBone, jawBone, gltf.scene)

  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const basePositions = new Float32Array(pos.array as Float32Array)
  const surfaceUV = makeSurfaceUVLookup(geometry)

  // Fixed UV destination for every landmark: canonical -> head space (with the
  // user's fit scale/offset applied around the nose) -> raycast onto the head
  // surface -> authored UV at the hit point. Anchors and the canonical fit are
  // recomputed on every call so morphing the head geometry re-fits the face.
  // Landmarks scaled past the silhouette are pulled back toward the center.
  const mapToUV = (userFit: FaceFitSettings): Float32Array => {
    const fit = fitCanonicalToHead(pos.array as ArrayLike<number>, pos.count)
    const headAnchors = findFaceAnchors(pos.array as ArrayLike<number>, pos.count)
    const centerX = headAnchors.nose[0]
    const centerY = headAnchors.nose[1]
    const landmarkUV = new Float32Array(CANONICAL_VERTEX_COUNT * 2)
    for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
      const [cx, cy] = canonicalVertex(i)
      const hx = fit.scale * cx + fit.tx
      const hy = fit.scale * cy + fit.ty
      let x = centerX + (hx - centerX) * userFit.scale
      let y = centerY + (hy - centerY) * userFit.scale + userFit.offsetY
      let hit = surfaceUV(x, y)
      let guard = 0
      while (!hit && guard++ < 8) {
        x = centerX + (x - centerX) * 0.92
        y = centerY + (y - centerY) * 0.92
        hit = surfaceUV(x, y)
      }
      if (!hit) {
        throw new PipelineError(
          `Face landmark ${i} does not project onto the head mesh`,
          'Reduce the face size, or check the base mesh.',
        )
      }
      landmarkUV[i * 2] = hit[0]
      landmarkUV[i * 2 + 1] = hit[1]
    }
    return landmarkUV
  }

  const bounds = new THREE.Box3().setFromBufferAttribute(pos)

  // Non-destructive morph: always recomputed from the pristine base positions.
  const applyMorph = (morph: HeadMorphSettings): void => {
    const out = pos.array as Float32Array
    const base = findFaceAnchors(basePositions, pos.count)
    const noseY = base.nose[1]
    const noseZ = base.nose[2]
    const chinY = base.chin[1]
    const mouthY = chinY + (noseY - chinY) * 0.35
    const faceSpan = Math.max(1e-4, noseY - chinY)
    // Below this line the mesh is neck/torso and must not stretch.
    const neckLineY = chinY - faceSpan * 0.6
    const zCenter = (bounds.min.z + bounds.max.z) / 2

    for (let i = 0; i < pos.count; i++) {
      let x = basePositions[i * 3]
      let y = basePositions[i * 3 + 1]
      let z = basePositions[i * 3 + 2]
      // Head-region weight: 1 above the neck line, fading to 0 at it.
      const headW = THREE.MathUtils.smoothstep(y - neckLineY, 0, faceSpan * 0.4)

      // Face width: lateral scale of the head region.
      x *= 1 + (morph.faceWidth - 1) * headW
      // Jaw width: extra lateral scale below the mouth line, strongest at the
      // chin, fading OUT again below it AND gated to the front of the head so
      // neck vertices (lower AND further back than the jawline) never move.
      const spanLipChin = Math.max(1e-4, mouthY - chinY)
      const jawDown = THREE.MathUtils.smoothstep(mouthY - y, 0, spanLipChin)
      const jawCut = THREE.MathUtils.smoothstep(y - (chinY - spanLipChin * 0.35), 0, spanLipChin * 0.35)
      const jawFront = THREE.MathUtils.smoothstep(z - noseZ * 0.3, 0, noseZ * 0.25)
      x *= 1 + (morph.jawWidth - 1) * jawDown * jawCut * jawFront * headW
      // Face length: vertical stretch of the head region about the nose line.
      y = noseY + (y - noseY) * (1 + (morph.faceLength - 1) * headW)
      // Head depth: front/back scale of the head region.
      z = zCenter + (z - zCenter) * (1 + (morph.headDepth - 1) * headW)

      out[i * 3] = x
      out[i * 3 + 1] = y
      out[i * 3 + 2] = z
    }
    pos.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
  }

  // Normalize world placement so differently-scaled heads share one camera
  // framing (geometry-space math above is unaffected).
  const height = bounds.max.y - bounds.min.y
  const TARGET_HEIGHT = 0.76
  const s = height > 1e-4 ? TARGET_HEIGHT / height : 1
  gltf.scene.scale.setScalar(s)
  gltf.scene.position.y = -0.09 - bounds.min.y * s
  gltf.scene.updateMatrixWorld(true)

  return { scene: gltf.scene, skinnedMesh, rig, geometry, mapToUV, applyMorph, bounds }
}
