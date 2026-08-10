import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

declare global {
  interface Window {
    __noirmogDebug?: {
      /** Render one frame synchronously and return the canvas as a data URL. */
      snapshot: () => string
    }
  }
}

/**
 * Dev-only: lets tooling force a synchronous render and read back the canvas,
 * because hidden/headless tabs never composite WebGL frames.
 */
export function DevDebugBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__noirmogDebug = {
      snapshot: () => {
        gl.render(scene, camera)
        return gl.domElement.toDataURL('image/png')
      },
    }
    return () => {
      delete window.__noirmogDebug
    }
  }, [gl, scene, camera])

  return null
}
