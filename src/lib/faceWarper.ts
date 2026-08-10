import * as THREE from 'three'
import { canonicalTriangles, CANONICAL_VERTEX_COUNT } from './canonicalFace'

const TEXTURE_SIZE = 1024

/**
 * GPU warper: renders the current video frame, warped by landmark triangles,
 * into a render target laid out in the head's UV space.
 *
 * Vertex positions are the FIXED per-landmark UV destinations (computed once
 * from the head mesh); per-frame we only update the texture coordinates to the
 * landmark positions found in that video frame. Fixed destinations cancel head
 * motion (stabilization) and produce the UV-layout texture in the same pass.
 * Later stages (de-lighting in v2) slot in as additional passes over the target.
 */
export class FaceTextureWarper {
  readonly texture: THREE.Texture
  private target: THREE.WebGLRenderTarget
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private geometry: THREE.BufferGeometry
  private uvAttr: THREE.BufferAttribute
  private videoTexture: THREE.VideoTexture

  constructor(landmarkUV: Float32Array, video: HTMLVideoElement, skinColor: [number, number, number]) {
    this.target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      depthBuffer: false,
    })
    this.texture = this.target.texture

    // Positions: landmark UV destinations mapped to the ortho frustum (0..1).
    const positions = new Float32Array(CANONICAL_VERTEX_COUNT * 3)
    for (let i = 0; i < CANONICAL_VERTEX_COUNT; i++) {
      positions[i * 3] = landmarkUV[i * 2]
      positions[i * 3 + 1] = landmarkUV[i * 2 + 1]
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.uvAttr = new THREE.BufferAttribute(new Float32Array(CANONICAL_VERTEX_COUNT * 2), 2)
    this.uvAttr.setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('uv', this.uvAttr)
    this.geometry.setIndex(new THREE.BufferAttribute(canonicalTriangles, 1))

    this.videoTexture = new THREE.VideoTexture(video)
    this.videoTexture.colorSpace = THREE.SRGBColorSpace

    // DoubleSide: the UV layout's v orientation can mirror the warp mesh,
    // which would otherwise reverse winding and cull every triangle.
    const material = new THREE.MeshBasicMaterial({ map: this.videoTexture, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(this.geometry, material)
    this.scene = new THREE.Scene()
    const [r, g, b] = skinColor
    this.scene.background = new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear()
    this.scene.add(mesh)
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1)
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
