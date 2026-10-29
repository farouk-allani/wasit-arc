/**
 * Globe coordinates: unit sphere, y up, longitude 0 at +x, east toward -z (three.js is
 * right-handed with the camera looking down -z). Matches SphereGeometry's uv layout, so hubs land
 * on the right spot of the Earth maps.
 */

export type Vec3 = readonly [x: number, y: number, z: number];

const DEG = Math.PI / 180;

export function toLatLon([x, y, z]: Vec3): { lat: number; lon: number } {
  return { lat: Math.asin(y) / DEG, lon: Math.atan2(-z, x) / DEG };
}

export function fromLatLon(lat: number, lon: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda)];
}
