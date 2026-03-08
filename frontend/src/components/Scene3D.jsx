import React, { useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore } from '../store.js'

function AnimatedTrajectory({ points }) {
  const currentTime = useAppStore(s => s.currentTime)
  const fps = useAppStore(s => s.fps) || 60
  
  const { pathVectors, trailVectors, ballPos } = useMemo(() => {
    if (!points || points.length < 2) return { pathVectors: [], trailVectors: [], ballPos: null };

    const pathVectors = [];
    const trailVectors = [];
    let ballPos = null;

    const trailSec = 0.8; // 流星拖尾長度 0.8秒
    
    // 根據之前使用者的座標轉換: (x, -y, -z)
    const toThree = (p) => new THREE.Vector3(p.x, -p.y, -p.z);
    
    for (let i = 0; i < points.length; i++) {
        pathVectors.push(toThree(points[i]));
    }
    
    const exactFrame = currentTime * fps;
    const pLen = points.length;
    
    // 找出目前時間在軌跡陣列中的哪兩個點之間
    let idx = -1;
    for(let i=0; i<pLen; i++){
        if(points[i].frame <= exactFrame) idx = i;
        else break;
    }
    
    if (idx !== -1) {
        if (idx === pLen - 1) {
            ballPos = toThree(points[idx]);
        } else {
            const p1 = points[idx];
            const p2 = points[idx+1];
            const diff = p2.frame - p1.frame;
            const t = diff === 0 ? 0 : (exactFrame - p1.frame) / diff;
            const v1 = toThree(p1);
            const v2 = toThree(p2);
            ballPos = v1.clone().lerp(v2, t);
        }
    } else if (pLen > 0) {
        if(exactFrame < points[0].frame) ballPos = toThree(points[0]);
    }
    
    // 建立拖尾陣列
    for(let i=0; i<pLen; i++) {
        const pTime = points[i].frame / fps;
        if (pTime <= currentTime && pTime >= currentTime - trailSec) {
            trailVectors.push(toThree(points[i]));
        }
    }
    if (ballPos) trailVectors.push(ballPos); // 保證拖尾最後點黏在現在的球上

    return { pathVectors, trailVectors, ballPos };
  }, [points, currentTime, fps]);

  if (pathVectors.length < 2) return null;

  return (
    <group>
      {/* 完整軌跡預測線 (較淡) */}
      <Line points={pathVectors} lineWidth={1.5} color="#6b7280" opacity={0.3} transparent />

      {/* 現在軌跡拖尾 (發光黃色) */}
      {trailVectors.length > 1 && (
         <Line points={trailVectors} lineWidth={3.5} color="#fcd34d" />
      )}

      {/* 羽球本體及光暈 */}
      {ballPos && (
        <mesh position={[ballPos.x, ballPos.y, ballPos.z]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#fbbf24" emissiveIntensity={1.2} />
          <pointLight distance={3} intensity={3} color="#fcd34d" />
        </mesh>
      )}
    </group>
  );
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
    if (!playing) return;

    let nextTime = currentTime + delta * playbackRate;

    if (selection.inTime != null && selection.outTime != null) {
      if (nextTime > selection.outTime) {
        nextTime = selection.inTime;
      }
      if (nextTime < selection.inTime) {
        nextTime = selection.inTime;
      }
    } else if (durationSec && nextTime >= durationSec) {
      nextTime = durationSec;
      setPlaying(false);
    }
      setCurrentTime(nextTime);
  });
  
  return null;
}

function CourtRef() {
  // Badminton court dimensions in meters (approximate standard size)
  const courtWidth = 6.1;
  const courtLength = 13.4;
  const netHeight = 1.55;

  return (
    <group>
      {/* <Grid args={[20, 20]} cellSize={1} sectionSize={2} fadeDistance={25} fadeStrength={1} /> */}
      
      {/* Court Floor */}
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, courtLength]} />
        <meshStandardMaterial color="#166534" /> {/* Dark green color */}
      </mesh>

      {/* Court Lines */}
      {/* Outer bounds */}
      <lineSegments>
        <edgesGeometry>
          <planeGeometry args={[courtWidth, courtLength]} />
        </edgesGeometry>
        <lineBasicMaterial color="white" linewidth={2} />
      </lineSegments>

      {/* Center line (Half court) */}
      <lineSegments>
        <edgesGeometry>
          <planeGeometry args={[0, courtLength]} />
        </edgesGeometry>
        <lineBasicMaterial color="white" linewidth={2} />
      </lineSegments>

      {/* Short service lines (1.98m from net) */}
      <mesh position={[0, 0.01, 1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[0, 0.01, -1.98]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      {/* Doubles long service line (0.76m from back boundary) */}
      <mesh position={[0, 0.01, courtLength / 2 - 0.76]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[0, 0.01, -(courtLength / 2 - 0.76)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[courtWidth, 0.04]} />
        <meshBasicMaterial color="white" />
      </mesh>

      {/* Singles sideline (0.46m from outer sideline) */}
      <mesh position={[courtWidth / 2 - 0.46, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>
      <mesh position={[-(courtWidth / 2 - 0.46), 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, courtLength]} />
        <meshBasicMaterial color="white" />
      </mesh>

      {/* Net */}
      <mesh position={[0, netHeight / 2, 0]}>
        <boxGeometry args={[courtWidth + 0.5, netHeight, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" opacity={0.6} transparent />
      </mesh>
      
      {/* Net Posts */}
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

  const points = useMemo(() => {
    // If selection exists, prefer selection range
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
    
    // 若未選取，找出當前或下一個 rally，一次把整段預覽線先畫出來
    const curFrame = currentTime * fps;
    let targetRally = null;
    
    const sortedRallies = [...rallies].sort((a, b) => a.start_frame - b.start_frame);
    for (const r of sortedRallies) {
       if (curFrame <= r.end_frame) {
          targetRally = r;
          break;
       }
    }
    
    if (targetRally) {
       const s = targetRally.start_frame;
       const e = targetRally.end_frame;
       const arr = []
       for (let f = s; f <= e; f++) {
         const p = trajMap.get(f)
         if (p) arr.push(p)
       }
       return arr;
    }

    return []
  }, [selection.inTime, selection.outTime, fps, trajMap, currentTime, rallies])

  return (
    <div className="w-full h-full relative bg-zinc-950 overflow-hidden">
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
