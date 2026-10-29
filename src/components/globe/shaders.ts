// GLSL for the landing globe. Colors arrive as linear THREE.Color uniforms; every fragment shader
// ends with three's tone-mapping and color-space chunks so it matches the standard materials.

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/**
 * The Earth at dusk: NASA Blue Marble relief, dimmed and cooled on the night side, with Black
 * Marble city lights glowing where the sun has set. Warm rim toward the sunset, blue limb.
 */
export const surface = {
  vertex: /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPosW = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragment: /* glsl */ `
    uniform sampler2D uDayMap;
    uniform sampler2D uLightsMap;
    uniform vec3 uSun;
    uniform vec3 uNightTint;
    uniform vec3 uRim;
    uniform vec3 uWarm;
    uniform vec3 uCity;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;

    void main() {
      vec3 n = normalize(vNormalW);
      vec3 v = normalize(cameraPosition - vPosW);
      float light = dot(n, uSun);
      // Mostly night: the sunset reaches only the limb on the sun's side
      float limb = 1.0 - max(dot(n, v), 0.0);
      float daylight = smoothstep(0.3, 0.9, light) * smoothstep(0.25, 0.8, limb);

      vec3 relief = texture2D(uDayMap, vUv).rgb;
      vec3 color = mix(relief * uNightTint, relief * uWarm * 0.45, daylight);

      // Black Marble also shows moonlit deserts; keep only the bright city lights
      float city = smoothstep(0.22, 0.85, texture2D(uLightsMap, vUv).r);
      color += uCity * city * mix(2.6, 0.6, daylight);

      float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      color += uRim * fresnel * 0.45;
      color += uWarm * pow(max(light, 0.0), 3.0) * fresnel * 1.6;
      vec3 h = normalize(uSun + v);
      color += uWarm * pow(max(dot(n, h), 0.0), 60.0) * 0.25;

      gl_FragColor = vec4(color, 1.0);
      ${OUTPUT}
    }
  `,
};

/** Soft atmosphere on a back-facing shell: strongest at the limb, zero at its outer edge. */
export const atmosphere = {
  vertex: /* glsl */ `
    varying vec3 vNormalV;
    varying vec3 vNormalW;
    void main() {
      vNormalV = normalize(normalMatrix * normal);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform vec3 uCool;
    uniform vec3 uWarm;
    uniform vec3 uSun;
    varying vec3 vNormalV;
    varying vec3 vNormalW;
    void main() {
      float rim = clamp(-vNormalV.z, 0.0, 1.0);
      float glow = pow(smoothstep(0.0, 0.55, rim), 2.2);
      vec3 color = mix(uCool, uWarm, smoothstep(-0.2, 0.9, dot(-vNormalW, uSun)));
      gl_FragColor = vec4(color * glow, glow);
      ${OUTPUT}
    }
  `,
};

/** Trade arc: a faint path with a bright pulse travelling from origin to destination. */
export const arc = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform float uOffset;
    uniform vec3 uColor;
    uniform vec3 uHead;
    varying vec2 vUv;
    void main() {
      float head = fract(uTime * 0.16 + uOffset) * 1.3 - 0.15;
      float d = vUv.x - head;
      float pulse = smoothstep(-0.18, 0.0, d) * (1.0 - smoothstep(0.0, 0.012, d));
      float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
      vec3 color = mix(uColor, uHead, pulse);
      gl_FragColor = vec4(color, (0.3 + 0.7 * pulse) * ends);
      ${OUTPUT}
    }
  `,
};

/** Hub marker: a steady core with a ring that keeps expanding and fading. */
export const hub = {
  vertex: /* glsl */ `
    attribute float aSeed;
    uniform float uSize;
    uniform float uPixelRatio;
    varying float vSeed;
    varying float vFacing;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec4 mv = viewMatrix * world;
      vFacing = smoothstep(0.05, 0.35, dot(normalize(world.xyz), normalize(cameraPosition - world.xyz)));
      vSeed = aSeed;
      gl_PointSize = uSize * uPixelRatio * (6.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying float vSeed;
    varying float vFacing;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float core = smoothstep(0.24, 0.08, d);
      float t = fract(uTime * 0.45 + vSeed);
      float ring = smoothstep(0.07, 0.0, abs(d - t)) * (1.0 - t);
      gl_FragColor = vec4(uColor, (core + ring * 0.8) * vFacing);
      ${OUTPUT}
    }
  `,
};

/**
 * Polished gold band. Reflects an analytic studio (navy floor, warm horizon, pale overhead
 * softbox, the sunset) instead of a baked environment, so it reads as metal on every GPU.
 * Bright rolled edges and an engraved line follow the band; a glint travels along it.
 */
export const ribbon = {
  vertex: /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPosW = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uSun;
    uniform vec3 uGold;
    uniform vec3 uFloor;
    uniform vec3 uPale;
    uniform vec3 uSunColor;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;

    vec3 studio(vec3 r) {
      vec3 c = mix(uFloor, vec3(0.5), smoothstep(-0.7, 0.1, r.y));
      c = mix(c, vec3(0.95), smoothstep(0.25, 0.8, r.y));
      // Broad fill from the viewer's side, so the stretch facing the camera stays bright
      c += vec3(0.85) * smoothstep(-0.1, 0.9, r.z);
      c += vec3(0.7) * smoothstep(0.75, 0.95, dot(r, normalize(vec3(-0.55, 0.3, 0.78))));
      c += uSunColor * (pow(max(dot(r, uSun), 0.0), 18.0) * 2.5 + pow(max(dot(r, uSun), 0.0), 3.0) * 0.4);
      return c;
    }

    void main() {
      // The band's geometry normals point at the globe; shade with the side facing the viewer
      vec3 v = normalize(cameraPosition - vPosW);
      vec3 outward = -normalize(vNormalW);
      float facing = dot(outward, v);
      vec3 n = facing >= 0.0 ? outward : -outward;
      float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
      vec3 tint = mix(uGold, uPale, fresnel);
      vec3 color = studio(reflect(-v, n)) * tint;

      // Rolled edges catch the light; an engraved line runs just inside each edge
      float edge = min(vUv.y, 1.0 - vUv.y);
      color += uGold * (1.0 - smoothstep(0.0, 0.05, edge)) * 0.8;
      color *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.012, abs(edge - 0.13)));

      float glint = fract(vUv.x - uTime * 0.035) - 0.5;
      color += uGold * exp(-glint * glint * 900.0) * 0.9;

      // The inner face sits in the globe's shadow
      if (facing < 0.0) color *= 0.45;
      gl_FragColor = vec4(color, 1.0);
      ${OUTPUT}
    }
  `,
};

/** Thin orbit of light around the globe, with a few sparks running along it. */
export const orbit = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform float uOffset;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float spark = 0.0;
      for (int i = 0; i < 3; i++) {
        float d = fract(vUv.x * 2.0 - uTime * 0.05 + uOffset + float(i) * 0.37) - 0.5;
        spark = max(spark, exp(-d * d * 400.0));
      }
      gl_FragColor = vec4(uColor, 0.07 + 0.93 * spark);
      ${OUTPUT}
    }
  `,
};
