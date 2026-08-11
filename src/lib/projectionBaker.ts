import * as THREE from 'three'

export type PhotoSlot = 'left' | 'right' | 'back' | 'top'

export interface SlotPhoto {
  url: string
  /** User framing corrections. */
  scale: number
  offsetX: number
  offsetY: number
  /** Exposure trim multiplier on top of auto color normalization. */
  exposure: number
  /** Rotation of the photo in degrees. */
  rotation: number
}

export type SlotPhotos = Partial<Record<PhotoSlot, SlotPhoto>>

/** Per-slot projection frame: camera direction and image axes in head space. */
const SLOT_FRAMES: Record<PhotoSlot, { view: THREE.Vector3; uAxis: THREE.Vector3; vAxis: THREE.Vector3 }> = {
  // view = direction from head toward the camera; weight = dot(normal, view).
  // The subject faces +z, so their anatomical LEFT is world +x: the "left"
  // photo's camera sits at +x. (These were swapped once — verify with a beard.)
  left: {
    view: new THREE.Vector3(1, 0, 0),
    uAxis: new THREE.Vector3(0, 0, -1),
    vAxis: new THREE.Vector3(0, 1, 0),
  },
  right: {
    view: new THREE.Vector3(-1, 0, 0),
    uAxis: new THREE.Vector3(0, 0, 1),
    vAxis: new THREE.Vector3(0, 1, 0),
  },
  back: {
    view: new THREE.Vector3(0, 0, -1),
    uAxis: new THREE.Vector3(1, 0, 0),
    vAxis: new THREE.Vector3(0, 1, 0),
  },
  top: {
    view: new THREE.Vector3(0, 1, 0),
    uAxis: new THREE.Vector3(1, 0, 0),
    vAxis: new THREE.Vector3(0, 0, -1),
  },
}

const BAKE_SIZE = 1024

const textureCache = new Map<string, Promise<{ tex: THREE.Texture; avg: [number, number, number] }>>()

function loadTextureCached(url: string): Promise<{ tex: THREE.Texture; avg: [number, number, number] }> {
  let entry = textureCache.get(url)
  if (!entry) {
    entry = new THREE.TextureLoader().loadAsync(url).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      return { tex, avg: averageColor(tex.image as HTMLImageElement) }
    })
    entry.catch(() => textureCache.delete(url))
    textureCache.set(url, entry)
  }
  return entry
}

/** Average color of the central region of a photo (for auto color-matching). */
function averageColor(image: HTMLImageElement): [number, number, number] {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 32
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return [128, 128, 128]
  // Sample the middle 50% crop where the head is.
  ctx.drawImage(
    image,
    image.naturalWidth * 0.25,
    image.naturalHeight * 0.25,
    image.naturalWidth * 0.5,
    image.naturalHeight * 0.5,
    0,
    0,
    32,
    32,
  )
  const data = ctx.getImageData(0, 0, 32, 32).data
  let r = 0,
    g = 0,
    b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const n = data.length / 4
  return [r / n, g / n, b / n]
}

/**
 * Bakes reference photos into a static full-head base texture in UV space.
 * Built as an N-source compositor: each photo is one weighted pass, and the
 * live face video later feathers over the result (the multi-camera rig will
 * reuse exactly this machinery).
 */
export class ProjectionBaker {
  readonly texture: THREE.Texture
  private target: THREE.WebGLRenderTarget
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private geometry: THREE.BufferGeometry
  private material: THREE.MeshBasicMaterial
  private mesh: THREE.Mesh
  private headGeometry: THREE.BufferGeometry
  private headBounds: THREE.Box3
  private queue: Promise<void> = Promise.resolve()

  constructor(headGeometry: THREE.BufferGeometry) {
    this.headGeometry = headGeometry
    this.headBounds = new THREE.Box3().setFromBufferAttribute(
      headGeometry.getAttribute('position') as THREE.BufferAttribute,
    )
    this.target = new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, { depthBuffer: false })
    this.texture = this.target.texture

    // Head geometry laid out flat in UV space; per-pass we rewrite `uv`
    // (photo coords) and vertex alpha (view-facing weight).
    const uvAttr = headGeometry.getAttribute('uv') as THREE.BufferAttribute
    const count = uvAttr.count
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = uvAttr.getX(i)
      positions[i * 3 + 1] = uvAttr.getY(i)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4),
    )
    this.geometry.setIndex(headGeometry.getIndex())

    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      vertexColors: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene = new THREE.Scene()
    this.scene.add(this.mesh)
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1)
  }

  /**
   * Re-bake all photos. `mirrorFill`: when only one side photo exists, reuse
   * it (flipped) for the opposite side. Returns per-slot auto color gains for
   * diagnostics.
   */
  bake(
    renderer: THREE.WebGLRenderer,
    photos: SlotPhotos,
    skinColor: [number, number, number],
    mirrorFill: boolean,
  ): Promise<void> {
    // Serialize: overlapping bakes (slider drags) run one at a time.
    this.queue = this.queue.then(() => this.bakeNow(renderer, photos, skinColor, mirrorFill, this.target))
    return this.queue
  }

  /** Bake straight to a renderer's canvas (the 2D texture editor preview). */
  bakeToCanvas(
    renderer: THREE.WebGLRenderer,
    photos: SlotPhotos,
    skinColor: [number, number, number],
    mirrorFill: boolean,
  ): Promise<void> {
    this.queue = this.queue.then(() => this.bakeNow(renderer, photos, skinColor, mirrorFill, null))
    return this.queue
  }

  private async bakeNow(
    renderer: THREE.WebGLRenderer,
    photos: SlotPhotos,
    skinColor: [number, number, number],
    mirrorFill: boolean,
    target: THREE.WebGLRenderTarget | null,
  ): Promise<void> {
    // Start from the flat skin tone.
    const prev = renderer.getRenderTarget()
    const prevClear = new THREE.Color()
    renderer.getClearColor(prevClear)
    const prevAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(target)
    renderer.setClearColor(
      new THREE.Color(skinColor[0] / 255, skinColor[1] / 255, skinColor[2] / 255).convertSRGBToLinear(),
      1,
    )
    renderer.clear(true, false, false)

    const passes: { slot: PhotoSlot; photo: SlotPhoto; mirrored: boolean }[] = []
    const order: PhotoSlot[] = ['back', 'top', 'left', 'right']
    for (const slot of order) {
      const photo = photos[slot]
      if (photo) passes.push({ slot, photo, mirrored: false })
    }
    if (mirrorFill) {
      if (photos.left && !photos.right) passes.push({ slot: 'right', photo: photos.left, mirrored: true })
      if (photos.right && !photos.left) passes.push({ slot: 'left', photo: photos.right, mirrored: true })
    }

    for (const pass of passes) {
      const { tex, avg } = await loadTextureCached(pass.photo.url)
      // Auto color-match HALFWAY toward the video's sampled skin tone (a full
      // match bleaches hair to skin color when the photo is mostly hair),
      // then apply the user's exposure trim.
      const soften = (g: number) => 1 + (Math.min(2.5, g) - 1) * 0.5
      const gain: [number, number, number] = [
        soften(skinColor[0] / Math.max(1, avg[0])) * pass.photo.exposure,
        soften(skinColor[1] / Math.max(1, avg[1])) * pass.photo.exposure,
        soften(skinColor[2] / Math.max(1, avg[2])) * pass.photo.exposure,
      ]
      this.preparePass(pass.slot, pass.photo, pass.mirrored, tex.image as HTMLImageElement)
      this.material.map = tex
      this.material.color.setRGB(gain[0], gain[1], gain[2])
      renderer.render(this.scene, this.camera)
    }

    renderer.setRenderTarget(prev)
    renderer.setClearColor(prevClear, prevAlpha)
  }

  /** Fill uv + alpha attributes for one photo pass. */
  private preparePass(
    slot: PhotoSlot,
    photo: SlotPhoto,
    mirrored: boolean,
    image: HTMLImageElement,
  ): void {
    const frame = SLOT_FRAMES[slot]
    const posAttr = this.headGeometry.getAttribute('position') as THREE.BufferAttribute
    const normalAttr = this.headGeometry.getAttribute('normal') as THREE.BufferAttribute
    const uvOut = this.geometry.getAttribute('uv') as THREE.BufferAttribute
    const colorOut = this.geometry.getAttribute('color') as THREE.BufferAttribute

    const size = this.headBounds.getSize(new THREE.Vector3())
    const center = this.headBounds.getCenter(new THREE.Vector3())
    // The head's height maps to ~70% of the photo's height.
    const headSpan = Math.max(size.y, 1e-4)
    const aspect = image.naturalWidth / Math.max(1, image.naturalHeight)

    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).sub(center)
      n.fromBufferAttribute(normalAttr, i)
      let a = v.dot(frame.uAxis)
      let b = v.dot(frame.vAxis)
      if (mirrored) a = -a
      if (photo.rotation) {
        const rad = (photo.rotation * Math.PI) / 180
        const ca = Math.cos(rad)
        const sa = Math.sin(rad)
        const ra = a * ca - b * sa
        b = a * sa + b * ca
        a = ra
      }
      const u = 0.5 + (a / (headSpan * aspect)) * (0.7 / photo.scale) + photo.offsetX
      const w = 0.5 + (b / headSpan) * (0.7 / photo.scale) + photo.offsetY
      uvOut.setXY(i, u, w)

      // Visibility is about THIS pass's direction; mirroring only flips the
      // photo sampling (handled in `a` above), not the facing test.
      const weight = n.dot(frame.view)
      // Ease in from grazing angles; fully opaque when facing the camera.
      const alpha = THREE.MathUtils.smoothstep(weight, 0.05, 0.55)
      colorOut.setXYZW(i, 1, 1, 1, alpha)
    }
    uvOut.needsUpdate = true
    colorOut.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.target.dispose()
  }
}
