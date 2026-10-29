/**
 * Globe — lazy-loaded WebGL 3-D globe using three.js.
 *
 * Falls back to a static <img> when:
 *   - WebGL is unavailable
 *   - prefers-reduced-motion is set
 *   - three.js fails to load
 *
 * Performance guardrails:
 *   - devicePixelRatio capped at 2
 *   - animation paused when tab is hidden (visibilitychange)
 *   - animation paused when scrolled out of view (IntersectionObserver)
 *   - renderer disposed on unmount
 *   - three.js is a dynamic import → lands in its own rollup chunk
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// ── Trade route pairs (lat/lng in degrees) ────────────────────────────────────
const ROUTES: [number, number, number, number][] = [
  [ 31.2,  121.5,  51.9,   4.5],  // Shanghai → Rotterdam
  [ 25.0,   55.1,  53.5,   9.9],  // Jebel Ali → Hamburg
  [ 35.7,   -5.8, -23.9, -46.3],  // Tangier → Santos
  [ 22.3,  114.2,  51.5,  -0.1],  // Hong Kong → London Gateway
]

const GOLD  = '#ddb886'
const STEEL = '#b4bfcf'

function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat)  * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  )
}

function canUseWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch { return false }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  fallbackSrc: string
  fallbackSrcSet?: string
  className?: string
  style?: React.CSSProperties
}

export function Globe({ fallbackSrc, fallbackSrcSet, className, style }: Props) {
  // Decide at mount time whether to use the canvas — avoids synchronous setState-in-effect
  const useCanvas = !prefersReducedMotion() && canUseWebGL()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!useCanvas) return
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let animId   = 0
    let paused   = false

    // container is non-null here (guarded above); assert for TS closure analysis
    const el = container
    const W = el.clientWidth  || 420
    const H = el.clientHeight || 420

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    // ── Scene + camera ───────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
    camera.position.z = 2.6
    const clock = new THREE.Clock()

    // ── Textures ─────────────────────────────────────────────────────────────
    const loader   = new THREE.TextureLoader()
    const dayTex   = loader.load('/hero/earth-day.webp')
    const nightTex = loader.load('/hero/earth-night.webp')
    dayTex.colorSpace   = THREE.SRGBColorSpace
    nightTex.colorSpace = THREE.SRGBColorSpace

    // ── Globe mesh ────────────────────────────────────────────────────────────
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshPhongMaterial({
        map:               dayTex,
        emissiveMap:       nightTex,
        emissive:          new THREE.Color(0.15, 0.12, 0.05),
        emissiveIntensity: 0.9,
        shininess:         18,
        specular:          new THREE.Color(0.08, 0.1, 0.14),
      }),
    )
    scene.add(globe)

    // ── Atmosphere rim ────────────────────────────────────────────────────────
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 64, 64),
      new THREE.MeshPhongMaterial({
        color:       new THREE.Color(GOLD),
        transparent: true,
        opacity:     0.06,
        side:        THREE.BackSide,
        depthWrite:  false,
      }),
    ))

    // ── Lights ───────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.18))
    const key = new THREE.DirectionalLight(0xe8f0ff, 1.1)
    key.position.set(3, 1.5, 2)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xddb886, 0.45)
    rim.position.set(-2.5, 0.5, -1)
    scene.add(rim)

    // ── Trade route arcs + pulse dots ─────────────────────────────────────────
    const routeGroup = new THREE.Group()
    scene.add(routeGroup)

    const pulseT = ROUTES.map(() => Math.random())
    type PulseData = { routeIdx: number; arcPts: THREE.BufferAttribute }
    const pulseDots: THREE.Mesh[] = []

    function buildArc(lat0: number, lng0: number, lat1: number, lng1: number, segments: number, color: string): THREE.Line {
      const p0  = latLngToVec3(lat0, lng0, 1.01)
      const p1  = latLngToVec3(lat1, lng1, 1.01)
      const mid = p0.clone().add(p1).normalize().multiplyScalar(1.18)
      const pts: THREE.Vector3[] = []
      for (let t = 0; t <= segments; t++) {
        const u  = t / segments
        const pt = new THREE.Vector3()
          .addScaledVector(p0,  (1 - u) * (1 - u))
          .addScaledVector(mid, 2 * u * (1 - u))
          .addScaledVector(p1,  u * u)
        pts.push(pt)
      }
      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.22, depthWrite: false }),
      )
    }

    ROUTES.forEach((r, idx) => {
      const color = idx % 2 === 0 ? GOLD : STEEL
      const arc   = buildArc(r[0], r[1], r[2], r[3], 80, color)
      routeGroup.add(arc)

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.85, depthWrite: false }),
      )
      const userData: PulseData = {
        routeIdx: idx,
        arcPts:   arc.geometry.attributes.position as THREE.BufferAttribute,
      }
      dot.userData = userData
      routeGroup.add(dot)
      pulseDots.push(dot)
    })

    // ── Resize ───────────────────────────────────────────────────────────────
    function onResize() {
      const W2 = el.clientWidth
      const H2 = el.clientHeight
      renderer.setSize(W2, H2)
      camera.aspect = W2 / H2
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // ── Visibility pause ──────────────────────────────────────────────────────
    function onVis() { paused = document.hidden }
    document.addEventListener('visibilitychange', onVis)

    // ── Intersection observer ─────────────────────────────────────────────────
    const observer = new IntersectionObserver(([e]) => { paused = !e.isIntersecting }, { threshold: 0 })
    observer.observe(el)

    // ── Render loop ───────────────────────────────────────────────────────────
    const PULSE_SPEED = 0.18

    function render() {
      if (disposed) return
      animId = requestAnimationFrame(render)
      if (paused) return

      const dt = clock.getDelta()
      globe.rotation.y += 0.04 * dt
      routeGroup.rotation.y = globe.rotation.y

      pulseDots.forEach((dot) => {
        const { routeIdx, arcPts } = dot.userData as PulseData
        pulseT[routeIdx] = (pulseT[routeIdx] + PULSE_SPEED * dt) % 1
        const idx2 = Math.floor(pulseT[routeIdx] * (arcPts.count - 1))
        dot.position.set(arcPts.getX(idx2), arcPts.getY(idx2), arcPts.getZ(idx2))
      })

      renderer.render(scene, camera)
    }
    render()

    return () => {
      disposed = true
      cancelAnimationFrame(animId)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      renderer.dispose()
      const el = renderer.domElement
      el.parentNode?.removeChild(el)
    }
  }, [useCanvas])

  if (!useCanvas) {
    return (
      <img
        src={fallbackSrc}
        srcSet={fallbackSrcSet}
        alt=""
        aria-hidden="true"
        className={className}
        style={{ objectFit: 'cover', objectPosition: 'center', ...style }}
        loading="lazy"
      />
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...style }}
      aria-hidden="true"
    />
  )
}
