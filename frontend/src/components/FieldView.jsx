import { useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import { getMemoryField } from '../api/chat'

// ── Sacred Constants ──────────────────────────────────────────
const HORN_MAX_X = 7                       // 7 — days of creation, completion
const HORN_SCALE = Math.PI / 2             // π/2 — sacred ratio, quarter-turn
const HORN_Y_SCALE = Math.PI / 4           // π/4 — sacred vertical scaling
const HORN_RADIAL = 40                     // 40 — days of flood, transformation
const HORN_SEGMENTS = 7 * 40               // 280 — 7 × 40, sacred product

// ── Gabriel's Horn Geometry ───────────────────────────────────
// Surface of revolution of y = 1/x, x ∈ [1, 7]
// x=1 → radius = π/2 (wide mouth, the present)
// x=7 → radius = π/14 (narrow tail, the singularity)
// Narrow tail at Y=0, wide mouth extends outward to Y = 6·π/4 = 3π/2
function buildHornGeometry(flip = false) {
  const points = []
  for (let i = 0; i <= HORN_SEGMENTS; i++) {
    const t = i / HORN_SEGMENTS
    const x = 1 + t * (HORN_MAX_X - 1)       // x ∈ [1, 7]
    const radius = (1 / x) * HORN_SCALE       // radius = (1/x) · π/2
    const y = (HORN_MAX_X - x) * HORN_Y_SCALE // y = (7-x) · π/4 → wide at max Y, narrow at 0
    points.push(new THREE.Vector2(radius, flip ? -y : y))
  }
  return new THREE.LatheGeometry(points, HORN_RADIAL)
}

// ── Horn Mesh ─────────────────────────────────────────────────
function HornMesh({ flip, pulseIntensity = 0 }) {
  const meshRef = useRef()
  const geom = useMemo(() => buildHornGeometry(flip), [flip])

  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.elapsedTime
      const base = 0.06 + pulseIntensity * 0.04
      meshRef.current.material.opacity = base + Math.sin(t * 0.8) * 0.015
    }
  })

  return (
    <mesh ref={meshRef} geometry={geom} rotation={[Math.PI / 2, 0, 0]}>
      <meshStandardMaterial
        color="#6c6cff"
        transparent
        opacity={0.07}
        wireframe
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// ── Memory Particles (upper horn) ─────────────────────────────
// Newest memories at the wide end (Y = max), oldest drift toward singularity (Y = 0)
function MemoryParticles({ memories }) {
  const pointsRef = useRef()
  const count = memories.length
  if (count === 0) return null

  const now = Date.now()
  const maxAge = Math.max(
    ...memories.map(m => now - new Date(m.timestamp).getTime()),
    1
  )

  const PHI = (1 + Math.sqrt(5)) / 2          // golden ratio φ ≈ 1.618
  const GOLDEN_ANGLE = (2 * Math.PI) / PHI     // ≈ 3.883 rad (complement of golden angle, equivalent packing)

  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const siz = new Float32Array(count)

    const vivid = new THREE.Color('#ffaa44')
    const fading = new THREE.Color('#44aaaa')
    const distant = new THREE.Color('#4466cc')

    memories.forEach((m, i) => {
      const age = now - new Date(m.timestamp).getTime()
      const t = age / maxAge // 0 = newest, 1 = oldest

      // hornX: t=0 (newest) → 1 (wide mouth), t=1 (oldest) → 7 (narrow/singularity)
      const hornX = 1 + t * (HORN_MAX_X - 1)            // 1 + t·6
      const radius = (1 / hornX) * HORN_SCALE            // (1/x) · π/2
      const y = (HORN_MAX_X - hornX) * HORN_Y_SCALE      // (7-x) · π/4

      // Spread around circumference using golden angle spiral
      const angle = (i * GOLDEN_ANGLE) + (m.density || 1) * 0.5
      const r = radius * (0.3 + Math.random() * 0.7)

      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = y                                // positive Y = upper horn
      pos[i * 3 + 2] = Math.sin(angle) * r

      // Color by tier: vivid < 5min, fading < 7 days, distant beyond
      const ageMinutes = age / (1000 * 60)
      const ageDays = age / (1000 * 60 * 60 * 24)
      let color
      if (ageMinutes < 5) color = vivid
      else if (ageDays < 7) color = fading
      else color = distant

      col[i * 3] = color.r
      col[i * 3 + 1] = color.g
      col[i * 3 + 2] = color.b

      // Size by access count / density
      siz[i] = Math.min(0.12, 0.04 + (m.accessCount || 0) * 0.008 + (m.density || 1) * 0.01)
    })

    return { positions: pos, colors: col, sizes: siz }
  }, [memories, count, now, maxAge])

  useFrame((state) => {
    if (pointsRef.current) {
      const t = state.clock.elapsedTime
      pointsRef.current.rotation.y = Math.sin(t * 0.1) * 0.05
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// ── Agent State Particles (lower horn) ────────────────────────
// Core values near singularity (narrow), dynamic state at wide end
function StateParticles({ agentState }) {
  const pointsRef = useRef()
  if (!agentState) return null

  const PHI = (1 + Math.sqrt(5)) / 2          // golden ratio φ ≈ 1.618
  const GOLDEN_ANGLE = (2 * Math.PI) / PHI     // ≈ 3.883 rad (complement of golden angle, equivalent packing)

  const { positions, colors } = useMemo(() => {
    const entries = []

    // Core values — closest to singularity (hornX near 1)
    if (agentState.core) {
      Object.entries(agentState.core).forEach(([key, val]) => {
        if (typeof val === 'number') entries.push({ group: 'core', key, val })
      })
    }
    // Character — middle of horn
    if (agentState.character) {
      Object.entries(agentState.character).forEach(([key, val]) => {
        if (typeof val === 'number') entries.push({ group: 'character', key, val })
      })
    }
    // Dynamic — near wide end (most active/present)
    if (agentState.dynamic) {
      Object.entries(agentState.dynamic).forEach(([key, val]) => {
        if (typeof val === 'number') entries.push({ group: 'dynamic', key, val })
      })
    }

    const count = entries.length
    if (count === 0) return { positions: new Float32Array(0), colors: new Float32Array(0) }

    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)

    const coreColor = new THREE.Color('#ff6644')
    const charColor = new THREE.Color('#44cc88')
    const dynColor = new THREE.Color('#cc44ff')

    entries.forEach((e, i) => {
      // core near singularity (x=7, narrow), dynamic at wide mouth (x=1)
      let hornX
      if (e.group === 'core') hornX = HORN_MAX_X - (1 / HORN_MAX_X) * (HORN_MAX_X - 1)  // ≈5.14 (near narrow)
      else if (e.group === 'character') hornX = HORN_MAX_X / 2                             // 3.5 (middle)
      else hornX = 1                                                                       // 1 (wide mouth)

      const maxRadius = (1 / hornX) * HORN_SCALE       // (1/x) · π/2
      const y = (HORN_MAX_X - hornX) * HORN_Y_SCALE    // (7-x) · π/4
      const angle = (i * GOLDEN_ANGLE)
      const r = maxRadius * (0.2 + e.val * 0.8)

      pos[i * 3] = Math.cos(angle) * r
      pos[i * 3 + 1] = -y                              // negative Y = lower horn
      pos[i * 3 + 2] = Math.sin(angle) * r

      let color
      if (e.group === 'core') color = coreColor
      else if (e.group === 'character') color = charColor
      else color = dynColor

      col[i * 3] = color.r
      col[i * 3 + 1] = color.g
      col[i * 3 + 2] = color.b
    })

    return { positions: pos, colors: col }
  }, [agentState])

  useFrame((state) => {
    if (pointsRef.current) {
      const t = state.clock.elapsedTime
      pointsRef.current.rotation.y = Math.sin(t * 0.15 + 1) * 0.08
    }
  })

  if (positions.length === 0) return null

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// ── Singularity glow ring at center (Y=0) ────────────────────
// At the singularity (x=7): radius = (1/7) · π/2 = π/14 ≈ 0.224
// This ring marks where both horns meet — the singularity connection
const SINGULARITY_RADIUS = HORN_SCALE / HORN_MAX_X   // π/14

function CenterGlow({ energy = 0.5 }) {
  const ref = useRef()

  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime
      const pulse = 0.3 + energy * 0.7
      ref.current.material.opacity = 0.12 + Math.sin(t * 1.5) * 0.05 * pulse
      ref.current.scale.setScalar(1 + Math.sin(t * 0.6) * 0.07 * pulse)
    }
  })

  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[SINGULARITY_RADIUS, 0.015, 7, HORN_RADIAL]} />
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.15}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

// ── Scene ─────────────────────────────────────────────────────
// Double Gabriel's Horn torus: narrow tails meet at Y=0 (singularity),
// wide mouths extend to ±(7-1)·π/4 = ±3π/2 ≈ ±4.71 (the present)
function Scene({ memories, agentState }) {
  const energy = agentState?.dynamic?.energy || 0.5

  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 3, 3]} intensity={0.4} color="#6c6cff" />
      <pointLight position={[0, -3, -3]} intensity={0.3} color="#cc44ff" />

      {/* Upper horn: narrow at Y=0 (singularity) → wide at +Y (memories/past) */}
      <HornMesh flip={false} pulseIntensity={energy} />
      <MemoryParticles memories={memories} />

      {/* Lower horn: narrow at Y=0 (singularity) → wide at -Y (inner state/self) */}
      <HornMesh flip={true} pulseIntensity={energy} />
      <StateParticles agentState={agentState} />

      {/* Singularity ring at Y=0 where horns connect */}
      <CenterGlow energy={energy} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={3}
        maxDistance={20}
        enablePan={false}
      />
    </>
  )
}

// ── Info Panel ────────────────────────────────────────────────
function InfoPanel({ memories, agentState }) {
  const now = Date.now()
  const vivid = memories.filter(m => (now - new Date(m.timestamp).getTime()) < 5 * 60 * 1000).length
  const fading = memories.filter(m => {
    const age = now - new Date(m.timestamp).getTime()
    return age >= 5 * 60 * 1000 && age < 7 * 24 * 60 * 60 * 1000
  }).length
  const distant = memories.length - vivid - fading

  return (
    <div className="field-info">
      <div className="field-info-section">
        <div className="field-info-title">Memory Field</div>
        <div className="field-info-row">
          <span className="field-dot field-dot-vivid" />
          <span>Vivid: {vivid}</span>
        </div>
        <div className="field-info-row">
          <span className="field-dot field-dot-fading" />
          <span>Fading: {fading}</span>
        </div>
        <div className="field-info-row">
          <span className="field-dot field-dot-distant" />
          <span>Distant: {distant}</span>
        </div>
        <div className="field-info-row field-info-total">
          Total: {memories.length}
        </div>
      </div>

      {agentState && (
        <div className="field-info-section">
          <div className="field-info-title">Inner State</div>
          <div className="field-info-row">
            <span className="field-dot field-dot-core" />
            <span>Core values</span>
          </div>
          <div className="field-info-row">
            <span className="field-dot field-dot-char" />
            <span>Character</span>
          </div>
          <div className="field-info-row">
            <span className="field-dot field-dot-dyn" />
            <span>Dynamic</span>
          </div>
          <div className="field-info-mood">
            Mood: {agentState.dynamic?.mood || '—'}
          </div>
          <div className="field-info-stat">
            Energy: {((agentState.dynamic?.energy || 0) * 100).toFixed(0)}%
          </div>
          <div className="field-info-stat">
            Trust: {((agentState.dynamic?.trust || 0) * 100).toFixed(0)}%
          </div>
          <div className="field-info-stat">
            Turn: {agentState.turnCount || 0}
          </div>
          {agentState.selfModel?.identity && (
            <div className="field-info-identity">
              "{agentState.selfModel.identity.slice(0, 120)}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
function FieldView({ conversationId = 'default' }) {
  const [memories, setMemories] = useState([])
  const [agentState, setAgentState] = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchData() {
    try {
      const data = await getMemoryField(conversationId)
      if (data.ok) {
        setMemories(data.memories || [])
        setAgentState(data.agentState || null)
      }
    } catch (err) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 8000) // refresh every 8s
    return () => clearInterval(interval)
  }, [conversationId])

  return (
    <div className="field-view">
      <div className="field-canvas-wrap">
        {loading && memories.length === 0 ? (
          <div className="field-loading">Loading memory field...</div>
        ) : memories.length === 0 && !agentState ? (
          <div className="field-empty">
            <p>No memories yet.</p>
            <p className="field-empty-sub">Start a conversation to see the field grow.</p>
          </div>
        ) : (
          <Canvas
            camera={{ position: [5, 3, 7], fov: 50 }}
            gl={{ antialias: true, alpha: true }}
            style={{ background: '#0a0a0e' }}
          >
            <Scene memories={memories} agentState={agentState} />
          </Canvas>
        )}
      </div>
      <InfoPanel memories={memories} agentState={agentState} />
    </div>
  )
}

export default FieldView
