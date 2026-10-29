import { BufferAttribute, BufferGeometry } from "three";

export interface RibbonShape {
  /** Distance of the band's centre line from the globe centre (globe radius is 1). */
  radius: number;
  width: number;
  /** How far the band leans out of its plane, in radians, and how often it does per loop. */
  twist: number;
  twistWaves: number;
  /** ± fraction of `width` the band swells and narrows by. */
  swell: number;
  phase: number;
}

/**
 * A closed metal band around the globe, like the bands of the brand mark. The band twists and
 * swells along its loop, so spinning it about its own axis reads as motion, not a static ring.
 */
export function ribbonGeometry(shape: RibbonShape, segments = 320): BufferGeometry {
  const { radius, width, twist, twistWaves, swell, phase } = shape;
  const count = (segments + 1) * 2;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);

  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // Width direction: "up", leaned toward the outward radial direction by the twist angle
    const lean = twist * Math.sin(twistWaves * t + phase);
    const wx = cos * Math.sin(lean);
    const wy = Math.cos(lean);
    const wz = sin * Math.sin(lean);
    const half = (width / 2) * (1 + swell * Math.sin(2 * t + phase * 1.7));
    // Face normal = tangent × width direction, tangent = (-sin, 0, cos)
    const nx = -cos * wy;
    const ny = cos * wx + sin * wz;
    const nz = -sin * wy;

    for (const [k, side] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const i = s * 2 + k;
      position[i * 3] = radius * cos + wx * half * side;
      position[i * 3 + 1] = wy * half * side;
      position[i * 3 + 2] = radius * sin + wz * half * side;
      normal.set([nx, ny, nz], i * 3);
      uv.set([s / segments, k], i * 2);
    }
  }

  const index: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}
