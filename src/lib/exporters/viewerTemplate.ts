/**
 * Standalone viewer for the GLB bundle export. Kept as a template string so
 * the export is fully client-side. Serve the exported folder with any static
 * server (e.g. `npx serve`) — browsers block file:// module imports.
 */
export const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>NoirMog bust viewer</title>
<style>
  html, body { height: 100%; margin: 0; background: #161616; }
  #hint { position: fixed; top: 10px; left: 12px; color: #888; font: 12px sans-serif; }
</style>
<script type="importmap">
  { "imports": {
    "three": "https://unpkg.com/three@0.185.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.185.0/examples/jsm/"
  } }
</script>
</head>
<body>
<div id="hint">Click to play — NoirMog bust ("__BASENAME__")</div>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const NECK_ORDER = ['headYaw', 'headPitch', 'headRoll', 'jawOpen']

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color('#161616')
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100)
camera.position.set(0.28, 0.45, 0.95)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.32, 0)
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const sun = new THREE.DirectionalLight(0xffffff, 1.3)
sun.position.set(2, 3, 2)
scene.add(sun)

const video = document.createElement('video')
video.src = './__BASENAME__-uv-texture.webm'
video.loop = true
video.playsInline = true
const videoTexture = new THREE.VideoTexture(video)
videoTexture.colorSpace = THREE.SRGBColorSpace
videoTexture.flipY = false

const channels = await (await fetch('./__BASENAME__-channels.json')).json()
const gltf = await new GLTFLoader().loadAsync('./__BASENAME__.glb')
scene.add(gltf.scene)

const bones = {}
gltf.scene.traverse((o) => {
  if (o.isBone) bones[o.name] = o
  if (o.isSkinnedMesh) {
    o.material = new THREE.MeshStandardMaterial({ map: videoTexture, roughness: 0.9 })
    o.frustumCulled = false
  }
})

// Rig math mirrors the app: neck carries neckShare, head lands on the full
// rotation, jaw hinges on local X.
const neck = bones.Neck, head = bones.Head, jaw = bones.Jaw
gltf.scene.updateMatrixWorld(true)
const neckRest = neck.quaternion.clone()
const jawRest = jaw.quaternion.clone()
const torsoWorld = neck.parent.getWorldQuaternion(new THREE.Quaternion())
const torsoWorldInv = torsoWorld.clone().invert()
const headWorldRest = head.getWorldQuaternion(new THREE.Quaternion())
const JAW_MAX = THREE.MathUtils.degToRad(22)
const e = new THREE.Euler(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion()

function applyFrame(t) {
  const f = Math.min(channels.frames.length - 1, Math.max(0, Math.round(t * channels.fps)))
  const [yaw, pitch, roll, jawOpen] = channels.frames[f]
  const s = channels.neckShare
  e.set(pitch * s, yaw * s, roll * s, 'YXZ')
  q1.setFromEuler(e)
  neck.quaternion.copy(torsoWorldInv).multiply(q1).multiply(torsoWorld).multiply(neckRest)
  e.set(pitch, yaw, roll, 'YXZ')
  q1.setFromEuler(e)
  q2.copy(torsoWorld).multiply(neck.quaternion)
  head.quaternion.copy(q2).invert().multiply(q1).multiply(headWorldRest)
  q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), jawOpen * JAW_MAX)
  jaw.quaternion.copy(jawRest).multiply(q1)
}

addEventListener('click', () => { video.muted = false; video.play() }, { once: true })
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => {
  if (!video.paused) applyFrame(video.currentTime)
  controls.update()
  renderer.render(scene, camera)
})
</script>
</body>
</html>
`
