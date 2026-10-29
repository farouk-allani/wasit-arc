/**
 * Globe — custom-shader WebGL globe.
 *
 * Shaders:
 *   1. Earth surface  — ShaderMaterial: day/night blend, city lights, Fresnel rim, specular
 *   2. Atmosphere     — ShaderMaterial: BackSide additive glow, warm on sun side
 *   3. Metal band     — procedural BufferGeometry with twist+swell, MeshStandardMaterial
 *   4. Trade arcs     — ShaderMaterial with fade-at-ends via vUv.x
 *
 * Guardrails kept from previous version:
 *   - WebGL detection + prefers-reduced-motion fallback to static <img>
 *   - devicePixelRatio capped at 2
 *   - animation paused on tab-hidden (visibilitychange) and scroll-out-of-view
 *   - renderer disposed on unmount
 *   - three.js in its own rollup chunk (vite.config.ts manualChunks)
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// ── Constants ─────────────────────────────────────────────────────────────────
const ROUTES: [number, number, number, number][] = [
  [ 31.2,  121.5,  51.9,   4.5],  // Shanghai → Rotterdam
  [ 25.0,   55.1,  53.5,   9.9],  // Jebel Ali → Hamburg
  [ 35.7,   -5.8, -23.9, -46.3],  // Tangier → Santos
  [ 22.3,  114.2,  51.5,  -0.1],  // Hong Kong → London Gateway
]

const ENDPOINTS = ROUTES.flatMap(r => [
  [r[0], r[1]] as [number, number],
  [r[2], r[3]] as [number, number],
])

// SUN direction: upper-right, slightly toward camera
const SUN_DIR = new THREE.Vector3(0.6, 0.4, 0.7).normalize()

// ── GLSL: Earth surface ───────────────────────────────────────────────────────
const EARTH_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW  = normalize(normalMatrix * normal);
    vViewDir  = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const EARTH_FRAG = /* glsl */`
  uniform sampler2D uDayMap;
  uniform sampler2D uLightsMap;
  uniform vec3      uSun;
  uniform vec3      uNightTint;
  uniform vec3      uWarm;
  uniform vec3      uRim;
  uniform vec3      uCity;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    vec3 normal  = normalize(vNormalW);
    vec3 viewDir = normalize(vViewDir);

    float light    = dot(normal, uSun);
    float limb     = dot(normal, viewDir);
    float daylight = smoothstep(0.3, 0.9, light) * smoothstep(0.25, 0.8, limb);

    vec3 relief = texture2D(uDayMap, vUv).rgb;
    vec3 color  = mix(relief * uNightTint, relief * uWarm * 0.45, daylight);

    // City lights — red channel of the lights map, fade in on dark side
    float city = smoothstep(0.22, 0.85, texture2D(uLightsMap, vUv).r);
    color += uCity * city * mix(2.6, 0.6, daylight);

    // Fresnel rim glow
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    color += uRim  * fresnel * 0.45;
    color += uWarm * pow(max(light, 0.0), 3.0) * fresnel * 1.6;

    // Specular highlight
    vec3 h = normalize(uSun + viewDir);
    color += uWarm * pow(max(dot(normal, h), 0.0), 60.0) * 0.25;

    gl_FragColor = vec4(color, 1.0);
  }
`

// ── GLSL: Atmosphere ──────────────────────────────────────────────────────────
const ATMO_VERT = /* glsl */`
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW  = normalize(normalMatrix * normal);
    vViewDir  = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ATMO_FRAG = /* glsl */`
  uniform vec3 uCool;
  uniform vec3 uWarm;
  uniform vec3 uSun;

  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    vec3 normal  = normalize(vNormalW);
    vec3 viewDir = normalize(vViewDir);

    float rim  = 1.0 - abs(dot(normal, viewDir));
    float glow = pow(smoothstep(0.0, 0.55, rim), 2.2);
    vec3 color = mix(uCool, uWarm, smoothstep(-0.2, 0.9, dot(-normal, uSun)));

    gl_FragColor = vec4(color * glow, glow);
  }
`

// ── GLSL: Arc lines (fade at both ends) ────────────────────────────────────────
const ARC_VERT = /* glsl */`
  attribute float aT;
  varying   float vT;

  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ARC_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  varying float vT;

  void main() {
    float ends = smoothstep(0.0, 0.07, vT) * smoothstep(1.0, 0.93, vT);
    gl_FragColor = vec4(uColor, uOpacity * ends);
  }
`

// ── Helpers ────────────────────────────────────────────────────────────────────
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

// ── Procedural band geometry ──────────────────────────────────────────────────
function makeBandGeometry(
  radius: number,
  width: number,
  twist: number,
  twistWaves: number,
  swell: number,
  phase: number,
  segments: number,
): THREE.BufferGeometry {
  const positions: number[] = []
  const normals:   number[] = []
  const uvs:       number[] = []
  const indices:   number[] = []

  for (let s = 0; s <= segments; s++) {
    const t    = (s / segments) * Math.PI * 2
    const lean = twist * Math.sin(twistWaves * t + phase)
    const half = (width / 2) * (1 + swell * Math.sin(2 * t + phase * 1.7))

    // Width direction (leans between "up" Y and outward radial XZ)
    const wx = Math.cos(t) * Math.sin(lean)
    const wy = Math.cos(lean)
    const wz = Math.sin(t) * Math.sin(lean)

    // Tangent along the ring (−sin t, 0, cos t) × widthDir gives face normal
    const nx = -Math.cos(t) * wy
    const ny =  Math.cos(t) * wx + Math.sin(t) * wz
    const nz = -Math.sin(t) * wy
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

    for (const k of [-1, 1]) {
      positions.push(
        radius * Math.cos(t) + wx * half * k,
        wy * half * k,
        radius * Math.sin(t) + wz * half * k,
      )
      normals.push(nx / nl, ny / nl, nz / nl)
      uvs.push(s / segments, (k + 1) / 2)
    }
  }

  // Two triangles per segment: indices per strip pair
  for (let s = 0; s < segments; s++) {
    const b = s * 2
    indices.push(b, b + 1, b + 2)
    indices.push(b + 1, b + 3, b + 2)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2))
  geo.setIndex(indices)
  return geo
}

// ── React component ────────────────────────────────────────────────────────────
interface Props {
  fallbackSrc: string
  fallbackSrcSet?: string
  className?: string
  style?: React.CSSProperties
}

export function Globe({ fallbackSrc, fallbackSrcSet, className, style }: Props) {
  const useCanvas = !prefersReducedMotion() && canUseWebGL()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!useCanvas) return
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let animId   = 0
    let paused   = false

    const el = container
    const W = el.clientWidth  || 460
    const H = el.clientHeight || 460

    // ── Renderer ────────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    // ── Scene + camera ───────────────────────────────────────────────────────────
    const scene  = new THREE.Scene()
    // z=4.3 → visible half-height ≈ tan(21°)×4.3 ≈ 1.65 world units, clear margin around ring r=1.52
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100)
    camera.position.z = 4.3
    const clock = new THREE.Clock()

    // ── Lights (for MeshStandardMaterial on the band) ───────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.4))
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.2)
    keyLight.position.copy(SUN_DIR).multiplyScalar(5)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x8aafce, 0.6)
    fillLight.position.set(-3, -1, -2)
    scene.add(fillLight)

    // ── Textures ─────────────────────────────────────────────────────────────────
    const loader    = new THREE.TextureLoader()
    const dayTex    = loader.load('/hero/earth-day.webp')
    const lightsTex = loader.load('/hero/earth-night.webp')
    dayTex.colorSpace    = THREE.SRGBColorSpace
    lightsTex.colorSpace = THREE.SRGBColorSpace

    // ── Earth surface shader ──────────────────────────────────────────────────────
    const earthMat = new THREE.ShaderMaterial({
      vertexShader:   EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        uDayMap:    { value: dayTex },
        uLightsMap: { value: lightsTex },
        uSun:       { value: SUN_DIR },
        uNightTint: { value: new THREE.Color('#16293f') },
        uWarm:      { value: new THREE.Color('#ddb886') },
        uRim:       { value: new THREE.Color('#b4bfcf') },
        uCity:      { value: new THREE.Color('#ffcf8f') },
      },
    })
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), earthMat)
    scene.add(globe)

    // ── Atmosphere shader ─────────────────────────────────────────────────────────
    const atmoMat = new THREE.ShaderMaterial({
      vertexShader:   ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        uCool: { value: new THREE.Color('#5b8fc7') },
        uWarm: { value: new THREE.Color('#ddb886') },
        uSun:  { value: SUN_DIR },
      },
      transparent: true,
      depthWrite:  false,
      side:        THREE.BackSide,
      blending:    THREE.AdditiveBlending,
    })
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.025, 64, 64), atmoMat))

    // ── Procedural twisted-band ribbon ────────────────────────────────────────────
    const bandGeo = makeBandGeometry(
      1.32,   // radius
      0.17,   // width
      0.9,    // twist
      2,      // twistWaves
      0.25,   // swell
      0.6,    // phase
      320,    // segments
    )
    const bandMat = new THREE.MeshStandardMaterial({
      color:      new THREE.Color('#ddb886'),
      metalness:  0.9,
      roughness:  0.25,
      side:       THREE.DoubleSide,
      transparent: true,
      opacity:    0.85,
    })
    const band = new THREE.Mesh(bandGeo, bandMat)
    // Tilt like a planet ring — roughly horizontal, ~24° toward viewer
    band.rotation.x = Math.PI / 2 - 0.42
    band.rotation.z = 0.18
    scene.add(band)

    // ── Thin orbit rings ──────────────────────────────────────────────────────────
    const ORBIT_CONFIGS: [number, number, number][] = [
      [1.55,  Math.PI / 3,       0],
      [1.72, -Math.PI / 6, Math.PI / 5],
    ]
    ORBIT_CONFIGS.forEach(([radius, rotX, rotZ]) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: new THREE.Color('#b4bfcf'),
          transparent: true,
          opacity: 0.09,
          depthWrite: false,
        }),
      )
      line.rotation.x = rotX
      line.rotation.z = rotZ
      scene.add(line)
    })

    // ── Trade route arcs with fade-at-ends shader ─────────────────────────────────
    const routeGroup = new THREE.Group()
    scene.add(routeGroup)

    const pulseT = ROUTES.map(() => Math.random())
    type PulseData = { routeIdx: number; arcPts: THREE.BufferAttribute }
    const pulseDots: THREE.Mesh[] = []

    function buildArc(
      lat0: number, lng0: number,
      lat1: number, lng1: number,
      segments: number,
      color: string,
    ): THREE.Line {
      const p0  = latLngToVec3(lat0, lng0, 1.01)
      const p1  = latLngToVec3(lat1, lng1, 1.01)
      const mid = p0.clone().add(p1).normalize().multiplyScalar(1.18)

      const positions: number[] = []
      const tAttr:     number[] = []

      for (let s = 0; s <= segments; s++) {
        const u  = s / segments
        const pt = new THREE.Vector3()
          .addScaledVector(p0,  (1 - u) * (1 - u))
          .addScaledVector(mid, 2 * u * (1 - u))
          .addScaledVector(p1,  u * u)
        positions.push(pt.x, pt.y, pt.z)
        tAttr.push(u)
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('aT',       new THREE.Float32BufferAttribute(tAttr, 1))

      const mat = new THREE.ShaderMaterial({
        vertexShader:   ARC_VERT,
        fragmentShader: ARC_FRAG,
        uniforms: {
          uColor:   { value: new THREE.Color(color) },
          uOpacity: { value: 0.22 },
        },
        transparent: true,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
      })

      return new THREE.Line(geo, mat)
    }

    ROUTES.forEach((r, idx) => {
      const color = idx % 2 === 0 ? '#ddb886' : '#b4bfcf'
      const arc   = buildArc(r[0], r[1], r[2], r[3], 80, color)
      routeGroup.add(arc)

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.010, 8, 8),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      )
      dot.userData = {
        routeIdx: idx,
        arcPts: arc.geometry.attributes.position as THREE.BufferAttribute,
      }
      routeGroup.add(dot)
      pulseDots.push(dot)
    })

    // ── Endpoint glowing points ───────────────────────────────────────────────────
    ENDPOINTS.forEach(([lat, lng]) => {
      const pos = latLngToVec3(lat, lng, 1.012)

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.013, 8, 8),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#ddb886'),
          transparent: true,
          opacity: 0.80,
          depthWrite: false,
        }),
      )
      dot.position.copy(pos)
      routeGroup.add(dot)

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.030, 8, 8),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color('#ddb886'),
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
        }),
      )
      halo.position.copy(pos)
      routeGroup.add(halo)
    })

    // ── Resize ────────────────────────────────────────────────────────────────────
    function onResize() {
      const W2 = el.clientWidth
      const H2 = el.clientHeight
      renderer.setSize(W2, H2)
      camera.aspect = W2 / H2
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // ── Visibility + scroll pause ─────────────────────────────────────────────────
    function onVis() { paused = document.hidden }
    document.addEventListener('visibilitychange', onVis)

    const observer = new IntersectionObserver(
      ([e]) => { paused = !e.isIntersecting },
      { threshold: 0 },
    )
    observer.observe(el)

    // ── Render loop ───────────────────────────────────────────────────────────────
    const PULSE_SPEED = 0.18

    function render() {
      if (disposed) return
      animId = requestAnimationFrame(render)
      if (paused) return

      const dt = clock.getDelta()

      globe.rotation.y    += 0.04 * dt
      routeGroup.rotation.y = globe.rotation.y

      // Band rotates about its own tilted axis
      band.rotation.y = globe.rotation.y * 0.5

      pulseDots.forEach((dot) => {
        const { routeIdx, arcPts } = dot.userData as PulseData
        pulseT[routeIdx] = (pulseT[routeIdx] + PULSE_SPEED * dt) % 1
        const i = Math.floor(pulseT[routeIdx] * (arcPts.count - 1))
        dot.position.set(arcPts.getX(i), arcPts.getY(i), arcPts.getZ(i))
      })

      renderer.render(scene, camera)
    }
    render()

    // ── Cleanup ───────────────────────────────────────────────────────────────────
    return () => {
      disposed = true
      cancelAnimationFrame(animId)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      renderer.dispose()
      renderer.domElement.parentNode?.removeChild(renderer.domElement)
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
