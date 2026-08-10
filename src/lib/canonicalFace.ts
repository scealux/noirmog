import data from '../data/canonicalFace.json'

/**
 * MediaPipe's canonical face model (Apache-2.0), baked by tools/bake-canonical-face.mjs.
 * Vertex order matches the first 468 Face Landmarker landmarks; units are centimeters,
 * +y up, +z toward the viewer (out of the face).
 */
export const CANONICAL_VERTEX_COUNT: number = data.vertexCount
export const canonicalPositions = new Float32Array(data.positions)
export const canonicalTriangles = new Uint16Array(data.triangles)

export function canonicalVertex(i: number): [number, number, number] {
  return [canonicalPositions[i * 3], canonicalPositions[i * 3 + 1], canonicalPositions[i * 3 + 2]]
}
