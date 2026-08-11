import * as THREE from 'three'
import { canonicalTriangles, CANONICAL_VERTEX_COUNT } from './canonicalFace'

const TEXTURE_SIZE = 1024

/** Unique undirected edges of the canonical face mesh, as flat index pairs. */
function buildEdges(): Uint16Array {
  const seen = new Set<number>()
  const edges: number[] = []
  for (let t = 0; t < canonicalTriangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = canonicalTriangles[t + e]
      const b = canonicalTriangles[t + ((e + 1) % 3)]
      const key = a < b ? a * 65536 + b : b * 65536 + a
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(a, b)
      }
    }
  }
  return new Uint16Array(edges)
}

/**
 * Vertices on the OUTER boundary of the face mesh (the face oval). The mesh
 * also has interior boundary loops around the eyes and lips — those must NOT
 * feather, so boundary components are separated and the largest one wins.
 */
function findOuterRing(): Uint16Array {
  const count = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a)
  for (let t = 0; t < canonicalTriangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = canonicalTriangles[t + e]
      const b = canonicalTriangles[t + ((e + 1) % 3)]
      count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1)
    }
  }
  // Boundary edges belong to exactly one triangle.
  const adjacency = new Map<number, number[]>()
  for (const [k, c] of count) {
    if (c !== 1) continue
    const a = Math.floor(k / 65536)
    const b = k % 65536
    adjacency.set(a, [...(adjacency.get(a) ?? []), b])
    adjacency.set(b, [...(adjacency.get(b) ?? []), a])
  }
  // Split into connected loops, keep the largest (the face oval).
  const unvisited = new Set(adjacency.keys())
  let best: number[] = []
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as number
    const component: number[] = []
    const stack = [start]
    unvisited.delete(start)
    while (stack.length) {
      const v = stack.pop() as number
      component.push(v)
      for (const n of adjacency.get(v) ?? []) {
        if (unvisited.has(n)) {
          unvisited.delete(n)
          stack.push(n)
        }
      }
    }
    if (component.length > best.length) best = component
  }
  return new Uint16Array(best)
}

const EDGES = buildEdges()
const OUTER_RING = findOuterRing()

/**
 * GPU warper: renders the current video frame, warped by landmark triangles,
 * into a render target laid out in the head's UV space.
 *
 * Vertex positions are the FIXED per-landmark UV destinations (computed once
 * from the head mesh); per-frame we only update the texture coordinates to the
 * landmark positions found in that video frame. Fixed destinations cancel head
 * motion (stabilization) and produce the UV-layout texture in the same pass.
 *
 * A per-vertex alpha fades the face out over `feather` UV-units from its outer
 * boundary, blending it into the skin-tone background instead of a hard seam.
 * Later stages (de-lighting in v2) slot in as additional passes over the target.
 */
export class FaceTextureWarper {
  readonly texture: THREE.Texture
  private target: THREE.WebGLRenderTarget
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private geometry: THREE.BufferGeometry
  private posAttr: THREE.BufferAttribute
  private uvAttr: THREE.BufferAttribute
  private colorAttr: THREE.BufferAttribute
  private videoTexture: THREE.VideoTexture
  private landmarkUV: Float32Array
  private feather: number

  constructor(
    landmarkUV: Float32Array,
    video: HTMLVideoElement,
    skinColor: [number, number, number],
    feather = 0.06,
  ) {
    this.landmarkUV = landmarkUV
    this.feather = feather
    this.target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      depthBuffer: false,
    })
    this.texture = this.target.texture

    this.geometry = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(new Float32Array(CANONICAL_VERTEX_COUNT * 3), 3)
    this.geometry.setAttribute('position', this.posAttr)
    this.uvAttr = new THREE.BufferAttribute(new Float32Array(CANONICAL_VERTEX_COUNT * 2), 2)
    this.uvAttr.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('uv', this.uvAttr)
    const colors = new Float32Array(CANONICAL_VERTEX_COUNT * 4).fill(1)
    this.colorAttr = new THREE.BufferAttribute(colors, 4)
    this.geometry.setAttribute('color', this.colorAttr)
    this.geometry.setIndex(new THREE.BufferAttribute(canonicalTriangles, 1))

    this.videoTexture = new THREE.VideoTexture(video)
    this.videoTexture.colorSpace = THREE.SRGBColorSpace

    // DoubleSide: the UV layout's v orientation can mirror the warp mesh,
    // which would otherwise reverse winding and cull every triangle.
    // Vertex alpha feathers the face edge into the background skin tone.
    const material = new THREE.MeshBasicMaterial({
      map: this.videoTexture,
      side: THREE.DoubleSide,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.frustumCulled = false
    this.scene = new THREE.Scene()
    const [r, g, b] = skinColor
    this.scene.background = new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear()
    this.scene.add(mesh)
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1)

    this.applyLandmarkUV()
  }

  /** Replace the fixed landmark destinations (face-fit change). */
  setLandmarkUV(landmarkUV: Float32Array): void {
    this.landmarkUV = landmarkUV
    this.applyLandmarkUV()
  }

  /** Feather distance in UV units (0 = hard edge). */
  setFeather(feather: number): void {
    this.feather = feather
    this.recomputeAlpha()
  }

  private applyLandmarkUV(): void {
    const pos = this.posAttr.array as Float32Array
    for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
      pos[i * 3] = this.landmarkUV[i * 2]
      pos[i * 3 + 1] = this.landmarkUV[i * 2 + 1]
    }
    this.posAttr.needsUpdate = true
    this.recomputeAlpha()
  }

  /**
   * Alpha = distance to the outer face boundary (shortest path over mesh edges
   * in UV space), ramped over the feather distance.
   */
  private recomputeAlpha(): void {
    const uv = this.landmarkUV
    const dist = new Float32Array(CANONICAL_VERTEX_COUNT).fill(Infinity)
    for (const v of OUTER_RING) dist[v] = 0

    // Bellman-Ford-style relaxation; the mesh is tiny and this converges fast.
    let changed = true
    let iterations = 0
    while (changed && iterations++ < 50) {
      changed = false
      for (let e = 0; e < EDGES.length; e += 2) {
        const a = EDGES[e]
        const b = EDGES[e + 1]
        const len = Math.hypot(uv[a * 2] - uv[b * 2], uv[a * 2 + 1] - uv[b * 2 + 1])
        if (dist[a] + len < dist[b]) {
          dist[b] = dist[a] + len
          changed = true
        } else if (dist[b] + len < dist[a]) {
          dist[a] = dist[b] + len
          changed = true
        }
      }
    }

    const colors = this.colorAttr.array as Float32Array
    for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
      const a = this.feather <= 0 ? 1 : Math.min(1, dist[i] / this.feather)
      colors[i * 4 + 3] = a * a * (3 - 2 * a) // smoothstep
    }
    this.colorAttr.needsUpdate = true
  }

  /** Point texture coords at this frame's landmark positions (normalized video space, y down). */
  update(frameLandmarks: Float32Array): void {
    const uv = this.uvAttr.array as Float32Array
    for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
      uv[i * 2] = frameLandmarks[i * 2]
      uv[i * 2 + 1] = 1 - frameLandmarks[i * 2 + 1]
    }
    this.uvAttr.needsUpdate = true
  }

  render(renderer: THREE.WebGLRenderer): void {
    // Upload the video's current frame every render — the default
    // requestVideoFrameCallback path misses paused/seeked frames.
    this.videoTexture.needsUpdate = true
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(prev)
  }

  dispose(): void {
    this.geometry.dispose()
    this.videoTexture.dispose()
    this.target.dispose()
  }
}
