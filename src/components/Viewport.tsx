import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'

/**
 * Placeholder head proxy until the real generic head mesh lands in Phase 1:
 * a cranium sphere plus a jaw box, roughly human-head proportions (~24cm tall).
 */
function PlaceholderHead() {
  return (
    <group position={[0, 1.55, 0]}>
      <mesh position={[0, 0.02, 0]}>
        <sphereGeometry args={[0.11, 32, 24]} />
        <meshStandardMaterial color="#8f7a6a" roughness={0.85} />
      </mesh>
      <mesh position={[0, -0.07, 0.02]}>
        <boxGeometry args={[0.13, 0.1, 0.12]} />
        <meshStandardMaterial color="#8f7a6a" roughness={0.85} />
      </mesh>
      {/* neck stub */}
      <mesh position={[0, -0.16, -0.01]}>
        <cylinderGeometry args={[0.05, 0.06, 0.12, 20]} />
        <meshStandardMaterial color="#8f7a6a" roughness={0.85} />
      </mesh>
    </group>
  )
}

export function Viewport() {
  return (
    <>
      <div className="viewport-hint">Placeholder head — real mesh lands in Phase 1</div>
      <Canvas camera={{ position: [0.35, 1.65, 0.55], fov: 40 }}>
        <color attach="background" args={['#161616']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2, 3, 2]} intensity={1.4} />
        <directionalLight position={[-2, 1.5, -1]} intensity={0.3} />
        <PlaceholderHead />
        <Grid
          position={[0, 0, 0]}
          args={[10, 10]}
          cellColor="#2b2b2b"
          sectionColor="#3a3a3a"
          fadeDistance={8}
          infiniteGrid
        />
        <OrbitControls target={[0, 1.55, 0]} enableDamping makeDefault />
      </Canvas>
    </>
  )
}
