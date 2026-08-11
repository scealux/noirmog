import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { canonicalPositions, canonicalVertex, CANONICAL_VERTEX_COUNT } from './canonicalFace'
import { PipelineError } from './runTask'

/**
 * The head mesh prepared for the pipeline:
 * - geometry with a procedural "jawOpen" morph target (index 0)
 * - landmarkUV: for each of the 468 landmarks, its fixed destination in the
 *   head's UV square. Warping video frames to these fixed destinations is what
 *   stabilizes the texture AND lays it out in UV space in one step.
 */
export interface PreparedHead {
  geometry: THREE.BufferGeometry
  landmarkUV: Float32Array // 468 * 2, in UV space (0..1, v up)
  /** Neck pivot in mesh space; rotate the head group around this point. */
  pivot: THREE.Vector3
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
function makeSurfaceUVLookup(geometry: THREE.BufferGeometry): (x: number, y: number) => [number, number] {
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
    if (!hit?.uv) {
      throw new PipelineError(
        `Face landmark at (${x.toFixed(3)}, ${y.toFixed(3)}) does not project onto the head mesh`,
        'The head mesh may be too narrow for the canonical face; check the base mesh.',
      )
    }
    return [hit.uv.x, hit.uv.y]
  }
}

/** Landmark indices used to locate facial features in canonical space. */
const CANON = {
  eyeOuterL: 33,
  eyeOuterR: 263,
  upperLip: 13,
  lowerLip: 14,
  chin: 152,
}

/**
 * Build a procedural jawOpen morph target: vertices below the lip line rotate
 * down around a hinge axis at ear height, with a smooth falloff.
 */
function buildJawMorph(geometry: THREE.BufferGeometry, fit: SimilarityFit): void {
  const pos = geometry.getAttribute('position')
  const delta = new Float32Array(pos.count * 3)

  const toHead = (i: number) => {
    const [x, y] = canonicalVertex(i)
    return [fit.scale * x + fit.tx, fit.scale * y + fit.ty]
  }
  const [, mouthY] = toHead(CANON.upperLip)
  const [, chinY] = toHead(CANON.chin)
  const [, eyeY] = toHead(CANON.eyeOuterL)
  const hingeY = (eyeY + mouthY) / 2

  const bounds = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
  const zMid = (bounds.min.z + bounds.max.z) / 2
  const hingeZ = zMid

  const maxAngle = THREE.MathUtils.degToRad(14)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i)
    if (v.z < zMid * 0.15) continue // back of head / neck stays put
    // 1 at chin, 0 at lip line and above.
    const t = THREE.MathUtils.smoothstep(mouthY - v.y, 0, Math.max(1e-4, mouthY - chinY) * 0.9)
    if (t <= 0) continue
    const angle = maxAngle * t
    const dy = v.y - hingeY
    const dz = v.z - hingeZ
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Rotate around the x-axis through (hingeY, hingeZ): mouth drops down/back.
    const ny = hingeY + dy * cos + dz * sin
    const nz = hingeZ - dy * sin + dz * cos
    delta[i * 3 + 1] = ny - v.y
    delta[i * 3 + 2] = nz - v.z
  }

  const morph = new THREE.BufferAttribute(delta, 3)
  geometry.morphAttributes.position = [morph]
  ;(geometry as THREE.BufferGeometry & { morphTargetsRelative: boolean }).morphTargetsRelative = true
}

let cached: Promise<PreparedHead> | null = null

export function prepareHead(url = `${import.meta.env.BASE_URL}models/head.glb`): Promise<PreparedHead> {
  cached ??= loadAndPrepare(url).catch((err) => {
    cached = null
    throw err
  })
  return cached
}

async function loadAndPrepare(url: string): Promise<PreparedHead> {
  const gltf = await new GLTFLoader().loadAsync(url)
  let geometry: THREE.BufferGeometry | null = null
  gltf.scene.traverse((obj) => {
    if (!geometry && obj instanceof THREE.Mesh) geometry = obj.geometry as THREE.BufferGeometry
  })
  if (!geometry) throw new PipelineError('No mesh found in head GLB', 'Check public/models/head.glb')
  geometry = geometry as THREE.BufferGeometry
  if (!geometry.getAttribute('uv')) throw new PipelineError('Head mesh has no UVs')

  const pos = geometry.getAttribute('position')
  const fit = fitCanonicalToHead(pos.array as ArrayLike<number>, pos.count)
  const surfaceUV = makeSurfaceUVLookup(geometry)

  // Fixed UV destination for every landmark: canonical -> head space -> raycast
  // onto the head surface -> authored UV at the hit point.
  const landmarkUV = new Float32Array(CANONICAL_VERTEX_COUNT * 2)
  for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
    const [cx, cy] = canonicalVertex(i)
    const [u, v] = surfaceUV(fit.scale * cx + fit.tx, fit.scale * cy + fit.ty)
    landmarkUV[i * 2] = u
    landmarkUV[i * 2 + 1] = v
  }

  buildJawMorph(geometry, fit)

  const bounds = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
  const pivot = new THREE.Vector3(0, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.25, 0)

  return { geometry, landmarkUV, pivot, bounds }
}
