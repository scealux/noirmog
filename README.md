# NoirMog

A browser-based face/motion capture tool inspired by LA Noire's facial animation. Instead of
chasing photoreal skin, NoirMog tracks a real video of a person's face, stabilizes it, and
projects it as a live video texture onto a rigged 3D head that animates along with the
performance — a deliberately-slightly-uncanny "digital animated bust." Think of it as the
one-webcam indie version of MotionScan.

**Live app:** https://scealux.github.io/noirmog/ · 100% client-side, no backend.

## Using it

The workflow is a strict 1-2-3, shown in the top bar:

1. **Adjust Base Mesh** — optionally upload a front photo. Facial landmarks are auto-detected
   (drag the amber points to correct them) and coarse sliders (face width/length, jaw width,
   head depth) morph the generic head toward your subject. No photo? The default head is fine.
2. **Capture Performance** — upload a video or record from your webcam (≤ 2 min; keep your
   head still-ish and evenly lit). Hit *Track performance* to run per-frame face tracking.
   Then trim the take, tune *Face Fit & Blend* (texture size/position, edge feather), and
   *Capture Edit* (head-motion scale, jaw scale, smoothing). Double-click any slider to reset.
3. **Edit & Export** — override the auto-sampled skin tone if needed, then export.

Every processing step reports granular progress, and a timestamped log console (toggle it in
the status bar or the settings menu) records everything, including errors with what-to-try
hints.

## Exports

| Export | What you get |
| --- | --- |
| GLB + channels + viewer | Rigged head `.glb`, per-frame channel curves `.json`, and a standalone Three.js `viewer.html` |
| UV texture video | The stabilized face texture as `.webm` with audio — the raw pipeline asset |
| Rendered bust video | A recording of the 3D viewport with audio |
| GLB with baked frames | Texture frames baked into the GLB (for size comparison; large) |

Video exports record in real time — keep the tab visible while they run. To use the viewer,
put its files (`.glb`, `-uv-texture.webm`, `-channels.json`, `-viewer.html`) in one folder and
serve it statically (e.g. `npx serve`); browsers block module scripts over `file://`.

**FBX:** there is no good browser-side FBX writer, so export GLB and convert in Blender:
*File → Import → glTF 2.0*, then *File → Export → FBX*. One step, nothing else required.

## Development

Requires Node ≥ 20.

```bash
npm install
npm run dev
```

Stack (deliberately minimal): Vite + React + TypeScript, React Three Fiber (+ drei), Zustand,
and MediaPipe Face Landmarker (`@mediapipe/tasks-vision`, vendored into `public/mediapipe/`
so the app works offline). Pushes to `main` deploy to GitHub Pages via Actions.

`PLAN.md` is the living source of truth for project state, decisions, and the roadmap.

## How the core trick works

MediaPipe gives 478 face landmarks, 52 blendshape scores, and a head-pose matrix per frame.
Each landmark gets a **fixed** destination in the head's UV layout (computed once by
raycasting MediaPipe's canonical face onto the head mesh and reading the authored UVs). Every
video frame is then GPU-warped by landmark triangles to those fixed destinations — because the
destinations never move, head motion cancels out *by construction*, and the result is already
laid out in UV space. That texture drives a rigged head (neck/head bones carry the tracked
rotation, a jaw bone opens with the `jawOpen` blendshape), feathered at the edges into a
sampled skin tone.
