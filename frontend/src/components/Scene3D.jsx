import React, { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../store.js'

function TrajectoryRaw({ points }) {
  const vectors = useMemo(() => points.map(p => new THREE.Vector3(p.x, p.y, p.z)), [points])

  // Current ball marker (last point)
  const last = points.length ? points[points.length - 1] : null

  return (
    <group>
      {/* Connect points with straight segments (no smoothing) */}
      <Line points={vectors} lineWidth={2} color="#facc15" />

      {/* Point cloud */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={vectors.length}
            array={new Float32Array(vectors.flatMap(v => [v.x, v.y, v.z]))}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial size={0.06} color="#ef4444" sizeAttenuation />
      </points>

      {last && (
        <mesh position={[last.x, last.y, last.z]}>
          <sphereGeometry args={[0.10, 16, 16]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" />
        </mesh>
      )}
    </group>
  )
}

function CourtRef() {
  // simple court reference: grid + net plane
  return (
    <group>
      <Grid args={[14, 14]} cellSize={1} sectionSize={2} fadeDistance={25} fadeStrength={1} />
      {/* Net: x=0 plane-ish as a thin box */}
      <mesh position={[0, 0, 0.78]}>
        <boxGeometry args={[0.02, 14, 1.56]} />
        <meshStandardMaterial color="#0ea5e9" opacity={0.35} transparent />
      </mesh>
    </group>
  )
}

export default function Scene3D() {
  const selection = useAppStore(s => s.selection)
  const fps = useAppStore(s => s.fps)
  const trajMap = useAppStore(s => s.trajByFrame)
  const getVisible = useAppStore(s => s.getVisiblePointsFor3D)
  const currentTime = useAppStore(s => s.currentTime)

  const points = useMemo(() => {
    // If selection exists, prefer selection range; else show +/- window around currentTime
    const inTime = selection.inTime, outTime = selection.outTime
    if (inTime != null && outTime != null) {
      const s = Math.max(0, Math.floor(Math.min(inTime, outTime) * fps))
      const e = Math.max(0, Math.ceil(Math.max(inTime, outTime) * fps))
      const arr = []
      for (let f = s; f <= e; f++) {
        const p = trajMap.get(f)
        if (p) arr.push(p)
      }
      return arr
    }
    return getVisible(3.0)
  }, [selection.inTime, selection.outTime, fps, trajMap, currentTime])

  return (
    <div className="w-full h-full bg-zinc-950">
      <Canvas camera={{ position: [6, 6, 6], fov: 55 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1.0} />
        <CourtRef />
        {/* <TrajectoryRaw points={points} /> */}
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
