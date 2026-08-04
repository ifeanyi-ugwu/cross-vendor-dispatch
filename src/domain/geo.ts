import type { LatLng } from './types.ts'

const EARTH_RADIUS_METRES = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Great-circle distance. Straight-line, so it ignores water, one-way systems
 *  and the fact that Doha Bay has no bridge across it. */
export function haversineMetres(from: LatLng, to: LatLng): number {
  const fromLat = toRadians(from.lat)
  const toLat = toRadians(to.lat)
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLng = toRadians(to.lng - from.lng)

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Projects onto a flat plane for drawing. Longitude is scaled by cos(latitude)
 * so the map keeps its proportions; at Doha's latitude a degree of longitude is
 * about a tenth shorter than a degree of latitude, and ignoring that visibly
 * stretches the city sideways.
 */
export function project(point: LatLng, origin: LatLng): { x: number; y: number } {
  return {
    x: (point.lng - origin.lng) * Math.cos(toRadians(origin.lat)),
    y: origin.lat - point.lat,
  }
}
