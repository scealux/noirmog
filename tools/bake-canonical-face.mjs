// Bakes MediaPipe's canonical face model (Apache-2.0) into src/data/canonicalFace.json.
// Source: https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
// Vertex order matches the first 468 Face Landmarker landmarks; units are centimeters.
// Usage: node tools/bake-canonical-face.mjs <path-to-canonical_face_model.obj>
import { readFileSync, writeFileSync } from 'node:fs'

const objPath = process.argv[2]
if (!objPath) {
  console.error('usage: node tools/bake-canonical-face.mjs <canonical_face_model.obj>')
  process.exit(1)
}

const positions = []
const triangles = []
for (const line of readFileSync(objPath, 'utf8').split('\n')) {
  const parts = line.trim().split(/\s+/)
  if (parts[0] === 'v') {
    positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
  } else if (parts[0] === 'f') {
    // f v/vt v/vt v/vt — OBJ is 1-indexed
    const idx = parts.slice(1).map((p) => Number(p.split('/')[0]) - 1)
    if (idx.length !== 3) throw new Error(`non-triangle face: ${line}`)
    triangles.push(...idx)
  }
}

if (positions.length / 3 !== 468) throw new Error(`expected 468 vertices, got ${positions.length / 3}`)

const round = (n) => Math.round(n * 1e6) / 1e6
writeFileSync(
  new URL('../src/data/canonicalFace.json', import.meta.url),
  JSON.stringify({
    vertexCount: positions.length / 3,
    positions: positions.map(round),
    triangles,
  }),
)
console.log(`baked ${positions.length / 3} vertices, ${triangles.length / 3} triangles`)
