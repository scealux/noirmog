import { PipelineError, runTask } from './runTask'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Phase 0 verification: a fake pipeline that exercises granular progress,
 * sub-task labels, per-stage bars, and log lines.
 */
export async function runDemoTask(): Promise<void> {
  await runTask(
    'Demo pipeline',
    [
      { id: 'decode', label: 'Decoding video', weight: 1 },
      { id: 'track', label: 'Tracking frames', weight: 3 },
      { id: 'warp', label: 'Warping to UV space', weight: 2 },
    ],
    async (ctx) => {
      const decode = ctx.stage('decode')
      for (let i = 0; i <= 20; i++) {
        decode.set(i / 20, `Reading chunk ${i}/20`)
        await sleep(60)
      }
      decode.done()

      const totalFrames = 240
      const track = ctx.stage('track')
      for (let f = 0; f <= totalFrames; f += 4) {
        track.set(f / totalFrames, `Tracking frames: ${f}/${totalFrames}`)
        if (f === 120) ctx.log('warn', 'Low landmark confidence on frame 120 (demo warning)')
        await sleep(25)
      }
      track.done()

      const warp = ctx.stage('warp')
      for (let f = 0; f <= totalFrames; f += 8) {
        warp.set(f / totalFrames, `Warping frames: ${f}/${totalFrames}`)
        await sleep(30)
      }
      warp.done()
    },
  )
}

/** Phase 0 verification: a task that fails mid-stage with context and a hint. */
export async function runFailingDemoTask(): Promise<void> {
  try {
    await runTask(
      'Demo pipeline (forced failure)',
      [
        { id: 'decode', label: 'Decoding video', weight: 1 },
        { id: 'track', label: 'Tracking frames', weight: 3 },
      ],
      async (ctx) => {
        const decode = ctx.stage('decode')
        for (let i = 0; i <= 10; i++) {
          decode.set(i / 10, `Reading chunk ${i}/10`)
          await sleep(50)
        }
        decode.done()

        const track = ctx.stage('track')
        for (let f = 0; f <= 90; f += 3) {
          track.set(f / 240, `Tracking frames: ${f}/240`)
          await sleep(25)
        }
        throw new PipelineError(
          'No face detected at frame 90 (demo error)',
          'Check that the face is visible and evenly lit, then re-run tracking.',
        )
      },
    )
  } catch {
    // Expected: the task system has already surfaced it.
  }
}
