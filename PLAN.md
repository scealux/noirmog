# NoirMog — Living Plan

Browser-based face/motion capture: track a real video of a face, stabilize it with the
MediaPipe facial transformation matrix, and project it as a live video texture onto an
animated 3D head mesh. 100% client-side, static-site deployable.

Source of truth for project state between sessions. See `NOIRMOG_PROMPT.md` (kickoff doc)
for the full spec.

## Phases

### Phase 0 — Scaffold & UX Backbone
- [x] Vite + React + TS scaffold with three/R3F/drei/zustand/@mediapipe/tasks-vision installed
- [x] Progress + logging system FIRST: zustand task store (stages, sub-task detail labels,
      weighted overall progress, error routing with context/hint), `runTask` helper
- [x] Dark DCC-style UI shell: top bar with persistent 1-2-3 stepper, side panel, status bar
- [x] Collapsible log console (timestamped, level-filtered), toggleable from settings menu
- [x] R3F viewport with placeholder head proxy + grid + orbit controls
- [x] Verify: demo task shows granular progress + logs; forced error surfaces with stage/context
      (verified in-browser 2026-08-10: per-stage bars + sub-task labels, warn/success/error log
      lines, error card with failing stage + hint, status-bar live summary)

### Phase 1 — Core Visual Proof (tracked, stabilized, talking bust)
- [ ] Generic head mesh with clean face UV region loaded in viewport
- [ ] Upload video → per-frame MediaPipe Face Landmarker with frame-count progress
- [ ] Stabilize via facial transformation matrix (counter-transform = software head-mount)
- [ ] Warp stabilized face into head UV layout → stabilized UV face texture video
- [ ] Head rotation + jaw-open channels driving mesh during playback, synced with audio

### Phase 2 — Capture Pipeline & Robustness
- [ ] Step 2 UX: file upload + bare getUserMedia recorder
- [ ] Responsive processing (chunked/yielding or worker), tracking-loss handling (log + hold last good)
- [ ] Audio sync across trims and varied source framerates/resolutions
- [ ] Verify with a real moving-head webcam clip

### Phase 3 — Base Mesh Fitting (Step 1)
- [ ] Front + side photo upload (both optional), auto landmarks → draggable points + coarse sliders
- [ ] Morph generic head; no photos → default head passes through
- [ ] Verify morphed head works through Phase 2 pipeline

### Phase 4 — Edit & Export (Step 3)
- [ ] Trim/cut performance range
- [ ] Neck/head blend: auto-sampled skin color default, picker override, feathered blend zone
- [ ] Exports: (1) GLB + side-by-side MP4 + viewer snippet, (2) GLB baked frame-sequence texture,
      (3) stabilized UV texture MP4 alone, (4) rendered MP4 of the bust via MediaRecorder
- [ ] Verify GLB+MP4 in bundled viewer; rendered MP4 matches preview

### Phase 5 — Polish Pass
- [ ] Settings menu final pass, error-message quality, empty/loading states
- [ ] README with usage + Blender glTF→FBX conversion note

## Decisions & Deviations
- 2026-08-10: Dev machine had no system Node; using existing user-local install at
  `~/.local/node` (v24.18.0). Not a project decision, but scripts assume Node ≥ 20.
- 2026-08-10: Accent color: single restrained amber (`#d9a441`) — fits the noir theme,
  used sparingly per the Blender/Figma direction.
- 2026-08-10: Task system: tasks are sequential-stage based with weighted stages;
  per-stage `detail` string carries sub-task labels ("Tracking frames: 342/900").
  Pipeline errors carry `{ message, hint }` (`PipelineError`) so the UI can always show
  what stage failed and what to try.
- 2026-08-10: Observed during verification: browsers freeze/throttle timers in backgrounded
  tabs, which stalls setTimeout-driven work. Reinforces the Phase 2 plan to run heavy
  processing in a worker (workers are not frozen with the tab).

## Deferred
### v2
- Simple de-lighting (color normalization) — will be an inserted stage in the texture pipeline
- Keyframe correction UI for bad tracking frames
- Mesh tweak from first video frames when no photos given
- Live tracking overlay during recording
- Stabilization quality modes
- OBJ export if demanded

### v3
- ML-based de-lighting (leave interface seam)
- Animation curve editing (smooth/exaggerate channels)
- Clips > 2 min via chunked processing
- Multiple base head presets
- Expanded blendshape driver channels (brows, eyelids, …) — channel system designed for this

### Architecture seams to protect
- Driver channel system: named float channels sampled per frame → mesh influence
- Texture pipeline: ordered stages so de-lighting slots in
- Export system: each format is its own module

## Assets
- Base head mesh: TBD in Phase 1 — prefer CC0 or procedural; record source here.
