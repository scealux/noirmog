import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'

/**
 * Person/background segmentation for reference photos (MediaPipe selfie
 * segmenter). Used to alpha-out the background so projected side photos don't
 * paint walls onto the head. Results are cached per photo URL.
 */

let segmenter: Promise<ImageSegmenter> | null = null

function getSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/selfie_segmenter.tflite`,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
    })
  })().catch((err) => {
    segmenter = null
    throw err
  })
  return segmenter
}

const cache = new Map<string, Promise<HTMLCanvasElement>>()

/** The photo with its background made transparent (soft mask). */
export function removeBackground(url: string): Promise<HTMLCanvasElement> {
  let entry = cache.get(url)
  if (!entry) {
    entry = doRemove(url)
    entry.catch(() => cache.delete(url))
    cache.set(url, entry)
  }
  return entry
}

async function doRemove(url: string): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not load photo for segmentation'))
    el.src = url
  })

  const seg = await getSegmenter()
  const result = seg.segment(img)
  const mask = result.confidenceMasks?.[0]

  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)

  if (mask) {
    const conf = mask.getAsFloat32Array()
    const mw = mask.width
    const mh = mask.height
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = data.data
    for (let y = 0; y < canvas.height; y++) {
      const my = Math.min(mh - 1, Math.round((y / canvas.height) * mh))
      for (let x = 0; x < canvas.width; x++) {
        const mx = Math.min(mw - 1, Math.round((x / canvas.width) * mw))
        // Confidence is "person-ness"; soft edge preserved as partial alpha.
        const a = conf[my * mw + mx]
        px[(y * canvas.width + x) * 4 + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255)
      }
    }
    ctx.putImageData(data, 0, 0)
    result.close()
  }
  return canvas
}
