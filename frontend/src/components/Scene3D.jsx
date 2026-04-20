import React, { useMemo, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../store.js'

function AnimatedTrajectory({ points }) {
  const currentTime = useAppStore(s => s.currentTime)
  const fps = useAppStore(s => s.fps) || 60
  const selectedTrajFrames = useAppStore(s => s.selectedTrajFrames) || []
  const toggleTrajFrameSelection = useAppStore(s => s.toggleTrajFrameSelection)
  const repairMode = useAppStore(s => s.repairMode)

  const { pathVectors, trailVectors, ballPos } = useMemo(() => {
    if (!points || points.length < 2) return { pathVectors: [], trailVectors: [], ballPos: null }

    const pathVectors = []
    const trailVectors = []
    let ballPos = null

    const trailSec = 0.8
    const toThree = (p) => new THREE.Vector3(p.x, -p.y, -p.z)

    for (let i = 0; i < points.length; i++) {
      pathVectors.push(toThree(points[i]))
    }

    const exactFrame = currentTime * fps
    const pLen = points.length

    let idx = -1
    for (let i = 0; i < pLen; i++) {
      if (points[i].frame <= exactFrame) idx = i
      else break
    }

    if (idx !== -1) {
      if (idx === pLen - 1) {
        ballPos = toThree(points[idx])
      } else {
        const p1 = points[idx]
        const p2 = points[idx + 1]
        const diff = p2.frame - p1.frame
        const t = diff === 0 ? 0 : (exactFrame - p1.frame) / diff
        const v1 = toThree(p1)
        const v2 = toThree(p2)
        ballPos = v1.clone().lerp(v2, t)
      }
    } else if (pLen > 0 && exactFrame < points[0].frame) {
      ballPos = toThree(points[0])
    }

    for (let i = 0; i < pLen; i++) {
      const pTime = points[i].frame / fps
      if (pTime <= currentTime && pTime >= currentTime - trailSec) {
        trailVectors.push(toThree(points[i]))
      }
    }
    if (ballPos) trailVectors.push(ballPos)

    return { pathVectors, trailVectors, ballPos }
  }, [points, currentTime, fps])

  if (pathVectors.length < 2) return null

  return (
    <group>
      <Line points={pathVectors} lineWidth={1.5} color="#6b7280" opacity={0.3} transparent />

      {trailVectors.length > 1 && (
        <Line points={trailVectors} lineWidth={3.5} color="#fcd34d" />
      )}

      {ballPos && (
        <mesh position={[ballPos.x, ballPos.y, ballPos.z]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#fbbf24" emissiveIntensity={1.2} />
          <pointLight distance={3} intensity={3} color="#fcd34d" />
        </mesh>
      )}

      {repairMode && points.map(p => {
        const isSelected = selectedTrajFrames.includes(p.frame)
        const radius = isSelected ? 0.06 : 0.02
        const color = isSelected ? '#08597e' : '#94a3b8'
        const opacity = isSelected ? 1.0 : 0.4
        return (
          <mesh
            key={p.frame}
            position={[p.x, -p.y, -p.z]}
            onClick={(e) => {
              e.stopPropagation()
              toggleTrajFrameSelection(p.frame)
            }}
          >
            <sphereGeometry args={[radius, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
        )
      })}
    </group>
  )
}

function PlaybackController() {
  const playing = useAppStore(s => s.playing)
  const setPlaying = useAppStore(s => s.setPlaying)
  const playbackRate = useAppStore(s => s.playbackRate)
  const currentTime = useAppStore(s => s.currentTime)
  const setCurrentTime = useAppStore(s => s.setCurrentTime)
  const selection = useAppStore(s => s.selection)
  const durationSec = useAppStore(s => s.durationSec)

  useFrame((state, delta) => {
    if (!playing) return

    let nextTime = currentTime + delta * playbackRate

    if (selection.inTime != null && selection.outTime != null) {
      if (nextTime > selection.outTime) nextTime = selection.inTime
      if (nextTime < selection.inTime) nextTime = selection.inTime
    } else if (durationSec && nextTime >= durationSec) {
      nextTime = durationSec
      setPlaying(false)
    }

    setCurrentTime(nextTime)
  })

  return null
}

function CourtRef() {
  const courtWidth = 6.1
  const courtLength = 13.4
  const netHeight = 1.55

  return (
    <group>
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, courtLength]} />
        <meshStandardMaterial color="#166534" />
      </mesh>

      <lineSegments>
        <edgesGeometry>
          <planeGeometry args={[courtWidth, courtLength]} />
        </edgesGeometry>
        <lineBasicMaterial color="white" linewidth={2} />
      </lineSegments>

      <lineSegments>
        <edgesGeometry>
          <planeGeometry args={[0, courtLength]} />
        </edgesGeometry>
        <lineBasicMaterial color="white" linewidth={2} />
      </lineSegments>

      <mesh position={[0, 0.01, 1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[0, 0.01, -1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, 0.01, courtLength / 2 - 0.76]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[0, 0.01, -(courtLength / 2 - 0.76)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[courtWidth / 2 - 0.46, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[-(courtWidth / 2 - 0.46), 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>

      <mesh position={[0, netHeight / 2, 0]}>
        <boxGeometry args={[courtWidth + 0.5, netHeight, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" opacity={0.6} transparent />
      </mesh>

      <mesh position={[courtWidth / 2 + 0.25, netHeight / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, netHeight]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
      <mesh position={[-(courtWidth / 2 + 0.25), netHeight / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, netHeight]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
    </group>
  )
}

export default function Scene3D() {
  const selection = useAppStore(s => s.selection)
  const fps = useAppStore(s => s.fps) || 60
  const trajMap = useAppStore(s => s.trajByFrame)
  const rallies = useAppStore(s => s.rallies) || []
  const currentTime = useAppStore(s => s.currentTime)
  const matchId = useAppStore(s => s.matchId)
  const selectedTrajFrames = useAppStore(s => s.selectedTrajFrames)
  const clearTrajSelection = useAppStore(s => s.clearTrajSelection)
  const repairMode = useAppStore(s => s.repairMode)
  const setRepairMode = useAppStore(s => s.setRepairMode)
  const upsertTrajPoints = useAppStore(s => s.upsertTrajPoints)
  const [repairing, setRepairing] = useState(false)

  const handleRepair = async () => {
    if (selectedTrajFrames.length !== 2) return
    setRepairing(true)
    try {
      const { api } = await import('../api.js')
      const start_frame = Math.min(...selectedTrajFrames)
      const end_frame = Math.max(...selectedTrajFrames)

      const res = await api.repairTraj(matchId, {
        start_frame,
        end_frame,
      })

      const updatedPts = await api.getTraj(matchId, start_frame, end_frame)
      upsertTrajPoints(updatedPts)

      alert(`修復成功！已更新 ${res.count} 個 frame 的資料。`)
      clearTrajSelection()
      setRepairMode(false)
    } catch (e) {
      console.error(e)
      alert('修復失敗：' + String(e))
    } finally {
      setRepairing(false)
    }
  }

  const points = useMemo(() => {
    const inTime = selection.inTime
    const outTime = selection.outTime
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

    const curFrame = currentTime * fps
    let targetRally = null

    const sortedRallies = [...rallies].sort((a, b) => a.start_frame - b.start_frame)
    for (const rally of sortedRallies) {
      if (curFrame <= rally.end_frame) {
        targetRally = rally
        break
      }
    }

    if (targetRally) {
      const s = targetRally.start_frame
      const e = targetRally.end_frame
      const arr = []
      for (let f = s; f <= e; f++) {
        const p = trajMap.get(f)
        if (p) arr.push(p)
      }
      return arr
    }

    return []
  }, [selection.inTime, selection.outTime, fps, trajMap, currentTime, rallies])

  return (
    <div className="w-full h-full relative bg-zinc-950 overflow-hidden">
      <div className="absolute top-2 right-2 z-20">
        <button
          onClick={() => {
            if (repairMode) clearTrajSelection()
            setRepairMode(!repairMode)
          }}
          className={`px-3 py-1 rounded border text-xs font-semibold shadow ${repairMode ? 'bg-sky-800 border-sky-700 text-sky-100' : 'bg-zinc-900/80 border-zinc-800 text-zinc-200'}`}
        >
          {repairMode ? 'Repair mode on' : 'Repair mode off'}
        </button>
      </div>

      {repairMode && selectedTrajFrames.length > 0 && (
        <div className="absolute top-12 right-2 z-20 bg-zinc-900/80 border border-zinc-800 rounded p-3 text-sm shadow-xl flex flex-col gap-2 w-64 backdrop-blur-md">
          <div className="text-zinc-200 font-semibold mb-1">修復軌跡資料</div>
          <div className="text-zinc-400 text-xs">
            已選取點：{selectedTrajFrames.join(' 和 ')}
            <br />
            請點兩個異常頭尾的軌跡點
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleRepair}
              disabled={selectedTrajFrames.length !== 2 || repairing}
              className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded px-3 py-1 font-medium transition-colors"
            >
              {repairing ? '修復中...' : '執行修復'}
            </button>
            <button
              onClick={clearTrajSelection}
              disabled={repairing}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors"
            >
              清除
            </button>
          </div>
        </div>
      )}

      <Canvas camera={{ position: [8, 5, 8], fov: 55 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
        <CourtRef />
        <AnimatedTrajectory points={points} />
        <PlaybackController />
        <OrbitControls makeDefault target={[0, 0, 0]} />
      </Canvas>
    </div>
  )
}
