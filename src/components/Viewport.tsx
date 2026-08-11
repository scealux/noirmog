import { Component, Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { HeadBust } from './HeadBust'
import { DevDebugBridge } from './DevDebugBridge'
import { useTaskStore } from '../state/taskStore'
import { viewportHandle } from '../lib/viewportHandle'
import { ProjectionGizmos } from './ProjectionGizmos'

class ViewportErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null }

  static getDerivedStateFromError(err: unknown) {
    return { message: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(err: unknown) {
    useTaskStore
      .getState()
      .log('error', 'Viewport', `Failed to load head mesh: ${err instanceof Error ? err.message : err}`)
  }

  render() {
    if (this.state.message) {
      return (
        <div className="viewport-error" role="alert">
          Could not load the head mesh: {this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}

export function Viewport() {
  return (
    <ViewportErrorBoundary>
      <Canvas
        camera={{ position: [0.28, 0.45, 0.95], fov: 40 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          viewportHandle.canvas = gl.domElement
        }}
      >
        <color attach="background" args={['#161616']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={1.3} />
        <directionalLight position={[-2, 1.5, -1]} intensity={0.35} />
        <Suspense fallback={null}>
          <HeadBust />
          <ProjectionGizmos />
        </Suspense>
        <Grid
          position={[0, -0.09, 0]}
          args={[10, 10]}
          cellSize={0.1}
          sectionSize={0.5}
          cellColor="#2b2b2b"
          sectionColor="#3a3a3a"
          fadeDistance={4}
          infiniteGrid
        />
        <OrbitControls target={[0, 0.32, 0]} enableDamping makeDefault />
        {import.meta.env.DEV && <DevDebugBridge />}
      </Canvas>
    </ViewportErrorBoundary>
  )
}
