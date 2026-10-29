import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Timer,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
// NASA Visible Earth (public domain): Blue Marble relief, Black Marble 2016 city lights
import earthDay from "./earth-day.webp";
import earthLights from "./earth-night.webp";
import { fromLatLon } from "./geo";
import { ribbonGeometry, type RibbonShape } from "./ribbon";
import * as glsl from "./shaders";

/** Trade hubs in the corridors the PRD names (Gulf, Türkiye, Africa); illustration only. */
const HUBS = {
  dubai: [25.2, 55.27],
  jeddah: [21.49, 39.19],
  istanbul: [41.01, 28.98],
  cairo: [30.04, 31.24],
  algiers: [36.75, 3.06],
  casablanca: [33.57, -7.59],
  lagos: [6.45, 3.39],
  mombasa: [-4.04, 39.67],
  johannesburg: [-26.2, 28.05],
} as const satisfies Record<string, readonly [number, number]>;

type Hub = keyof typeof HUBS;

const ROUTES: [Hub, Hub][] = [
  ["istanbul", "algiers"],
  ["dubai", "lagos"],
  ["dubai", "mombasa"],
  ["istanbul", "casablanca"],
  ["jeddah", "algiers"],
  ["cairo", "johannesburg"],
  ["istanbul", "dubai"],
  ["lagos", "casablanca"],
];

// One wide champagne band across the front of the globe, as in Farouk's landing mockup
const RIBBONS: (RibbonShape & { tilt: [number, number, number]; spin: number })[] = [
  {
    radius: 1.15,
    width: 0.24,
    twist: 0.2,
    twistWaves: 1,
    swell: 0.08,
    phase: 0.4,
    tilt: [0.16, 0, 0.36],
    spin: 0.06,
  },
];

// Faint orbits of light around the band, tilted apart from it: [radius, tilt, spark offset]
const ORBITS: [number, [number, number, number], number][] = [
  [1.27, [-0.95, 0, 0.5], 0],
  [1.33, [1.05, 0, -0.35], 0.5],
];

// Centre of the view: lat 18°N, lon 28°E puts North Africa, Türkiye and the Gulf in front
const VIEW_LAT = 18;
const VIEW_LON = 28;
const SUN = new Vector3(1, 0.42, 0.62).normalize();
const CAMERA_Z = 5.3;

export interface GlobeOptions {
  reducedMotion: boolean;
  onFirstFrame?: () => void;
  /** A texture failed to load: the caller shows its still fallback instead. */
  onError?: (error: unknown) => void;
}

export interface Globe {
  destroy(): void;
}

/**
 * Renders the landing globe into `container` (sized by CSS). Pauses while off screen or in a
 * hidden tab; under reduced motion it draws one still frame. Throws when WebGL is unavailable.
 */
export function createGlobe(container: HTMLElement, options: GlobeOptions): Globe {
  const renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, CAMERA_Z);

  const time = { value: 0 };

  // Tilt brings the view latitude to the centre; spin (animated) brings the view longitude there
  const tilt = new Group();
  tilt.rotation.x = (VIEW_LAT * Math.PI) / 180;
  const spin = new Group();
  const baseSpin = (-(90 + VIEW_LON) * Math.PI) / 180;
  spin.rotation.y = baseSpin;
  tilt.add(spin);
  scene.add(tilt);

  // Nothing is drawn until both maps have arrived, so the globe never fades in blank
  let pending = 2;
  const loader = new TextureLoader();
  const loadMap = (url: string) => {
    const map = loader.load(
      url,
      () => {
        if (--pending === 0 && still) render();
      },
      undefined,
      (error) => options.onError?.(error),
    );
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return map;
  };
  const dayMap = loadMap(earthDay);
  dayMap.colorSpace = SRGBColorSpace;
  const lightsMap = loadMap(earthLights);

  const sphere = new SphereGeometry(1, 96, 64);
  spin.add(
    new Mesh(
      sphere,
      new ShaderMaterial({
        vertexShader: glsl.surface.vertex,
        fragmentShader: glsl.surface.fragment,
        uniforms: {
          uDayMap: { value: dayMap },
          uLightsMap: { value: lightsMap },
          uSun: { value: SUN },
          uNightTint: { value: new Color("#38598a") },
          uRim: { value: new Color("#3b67a6") },
          uWarm: { value: new Color("#f1b56e") },
          uCity: { value: new Color("#ffc46e") },
        },
      }),
    ),
  );

  spin.add(hubPoints(pixelRatio, time));
  ROUTES.forEach(([from, to], i) =>
    spin.add(arcMesh(HUBS[from], HUBS[to], i / ROUTES.length, time)),
  );

  const halo = new Mesh(
    sphere,
    new ShaderMaterial({
      vertexShader: glsl.atmosphere.vertex,
      fragmentShader: glsl.atmosphere.fragment,
      uniforms: {
        uCool: { value: new Color("#3d73c4") },
        uWarm: { value: new Color("#f0a860") },
        uSun: { value: SUN },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(1.16);
  scene.add(halo);

  const ribbons = RIBBONS.map((shape) => {
    const holder = new Group();
    holder.rotation.set(...shape.tilt);
    const band = new Mesh(
      ribbonGeometry(shape),
      new ShaderMaterial({
        vertexShader: glsl.ribbon.vertex,
        fragmentShader: glsl.ribbon.fragment,
        uniforms: {
          uTime: time,
          uSun: { value: SUN },
          uGold: { value: new Color("#f2c27a") },
          uFloor: { value: new Color("#1a1208") },
          uPale: { value: new Color("#fff1d6") },
          uSunColor: { value: new Color("#ffcf96") },
        },
        side: DoubleSide,
      }),
    );
    holder.add(band);
    tilt.add(holder);
    return { band, speed: shape.spin };
  });
  for (const [radius, rotation, offset] of ORBITS)
    tilt.add(orbitMesh(radius, rotation, offset, time));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    // Keep the whole globe and its ribbons in frame on narrow (portrait) containers
    camera.position.z = w < h ? CAMERA_Z * (h / w) * 0.92 : CAMERA_Z;
    camera.updateProjectionMatrix();
    if (still) render();
  };

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  };

  // Still frame under reduced motion, or once the device proves too slow to animate smoothly
  let still = options.reducedMotion;
  const SAMPLE_FRAMES = 45;
  const frames = { warmup: 0, samples: [] as number[], judged: false };

  const timer = new Timer();
  let firstFrame = true;
  const render = () => {
    if (pending > 0) return;
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame?.();
    }
  };

  const tick = () => {
    timer.update();
    // Frames without the maps draw nothing and must not count toward the speed check
    if (pending > 0) return;
    const raw = timer.getDelta();
    if (frameBudgetBlown(raw)) return;
    const dt = Math.min(raw, 0.1);
    const t = timer.getElapsed();
    time.value = t;
    // Sway around the corridor instead of turning away from it; ease toward the pointer
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    spin.rotation.y = baseSpin + Math.sin(t * 0.07) * 0.42 + pointer.x * 0.18;
    tilt.rotation.x = (VIEW_LAT * Math.PI) / 180 + pointer.y * 0.08;
    for (const ribbon of ribbons) ribbon.band.rotation.y += ribbon.speed * dt;
    render();
  };

  // Skip shader warm-up, then take the median of 45 frames (immune to a few long frames while
  // the page boots). Slower than ~22 fps means software rendering or a struggling GPU, where a
  // still globe beats a stuttering page.
  const frameBudgetBlown = (seconds: number) => {
    if (frames.judged) return false;
    if (frames.warmup < 15) {
      frames.warmup++;
      return false;
    }
    frames.samples.push(seconds);
    if (frames.samples.length < SAMPLE_FRAMES) return false;
    frames.judged = true;
    const median = frames.samples.sort((a, b) => a - b)[SAMPLE_FRAMES >> 1] ?? 0;
    if (median < 0.045) return false;
    still = true;
    console.info(`Globe: ${Math.round(median * 1000)} ms per frame, showing a still frame`);
    window.removeEventListener("pointermove", onPointer);
    syncLoop();
    return true;
  };

  let visible = true;
  let running = false;
  const syncLoop = () => {
    const run = visible && !document.hidden && !still;
    if (run && !running) {
      // Pauses must not count as slow frames
      timer.reset();
      if (!frames.judged) Object.assign(frames, { warmup: 0, samples: [] });
    }
    running = run;
    renderer.setAnimationLoop(run ? tick : null);
  };
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    syncLoop();
  });
  intersection.observe(container);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  document.addEventListener("visibilitychange", syncLoop);
  if (!options.reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });

  resize();
  if (options.reducedMotion) render();
  syncLoop();

  return {
    destroy() {
      renderer.setAnimationLoop(null);
      intersection.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", syncLoop);
      window.removeEventListener("pointermove", onPointer);
      disposeScene(scene);
      dayMap.dispose();
      lightsMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

function hubPoints(pixelRatio: number, time: { value: number }) {
  const hubs = Object.values(HUBS);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array(hubs.flatMap(([lat, lon]) => fromLatLon(lat, lon).map((c) => c * 1.006))),
      3,
    ),
  );
  geometry.setAttribute(
    "aSeed",
    new BufferAttribute(new Float32Array(hubs.map((_, i) => i / hubs.length)), 1),
  );
  return new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: glsl.hub.vertex,
      fragmentShader: glsl.hub.fragment,
      uniforms: {
        uSize: { value: 26 },
        uPixelRatio: { value: pixelRatio },
        uTime: time,
        uColor: { value: new Color("#f5bf72") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

/** Great-circle arc between two hubs, lifted off the surface in proportion to its length. */
function arcMesh(
  from: readonly [number, number],
  to: readonly [number, number],
  offset: number,
  time: { value: number },
) {
  const a = new Vector3(...fromLatLon(...from));
  const b = new Vector3(...fromLatLon(...to));
  const angle = a.angleTo(b);
  const lift = 0.06 + angle * 0.22;
  const points: Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = slerp(a, b, angle, t);
    points.push(p.multiplyScalar(1.004 + lift * Math.sin(Math.PI * t)));
  }
  return new Mesh(
    new TubeGeometry(new CatmullRomCurve3(points), 96, 0.007, 6, false),
    new ShaderMaterial({
      vertexShader: glsl.arc.vertex,
      fragmentShader: glsl.arc.fragment,
      uniforms: {
        uTime: time,
        uOffset: { value: offset },
        uColor: { value: new Color("#d99a4c") },
        uHead: { value: new Color("#ffd391") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

function slerp(a: Vector3, b: Vector3, angle: number, t: number): Vector3 {
  const s = Math.sin(angle);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * angle) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * angle) / s));
}

function disposeScene(scene: Scene) {
  scene.traverse((object) => {
    if (object instanceof Mesh || object instanceof Points) {
      (object.geometry as BufferGeometry).dispose();
      (object.material as Material).dispose();
    }
  });
}

/** A thin closed ring of light at `radius`, rotated by `rotation`. */
function orbitMesh(
  radius: number,
  rotation: [number, number, number],
  offset: number,
  time: { value: number },
) {
  const points: Vector3[] = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    points.push(new Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
  }
  const mesh = new Mesh(
    new TubeGeometry(new CatmullRomCurve3(points, true), 256, 0.0035, 6, true),
    new ShaderMaterial({
      vertexShader: glsl.orbit.vertex,
      fragmentShader: glsl.orbit.fragment,
      uniforms: {
        uTime: time,
        uOffset: { value: offset },
        uColor: { value: new Color("#ffd8a0") },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.rotation.set(...rotation);
  return mesh;
}
