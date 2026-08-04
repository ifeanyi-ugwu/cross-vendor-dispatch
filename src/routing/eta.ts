import { haversineMetres } from '../domain/geo.ts'
import type { LatLng, Vehicle } from '../domain/types.ts'

/**
 * Everything the planner needs to know about the road network. Kept to one
 * method so the straight-line estimate here can be swapped for a matrix
 * precomputed from real routing without the planner noticing.
 */
export type EtaProvider = {
  readonly name: string
  /** Travel time in seconds. */
  seconds(from: LatLng, to: LatLng, vehicle: Vehicle): number
}

/** Effective door-to-door speeds in metres per second, already discounted for
 *  traffic lights, parking and the walk to a doorway. */
const SPEED: Record<Vehicle, number> = {
  bike: 5.0,
  car: 8.9,
  van: 7.8,
}

/**
 * Straight-line distance inflated by a circuity factor, standing in for road
 * distance. Real street networks run 1.2–1.4x longer than the crow flies in
 * most cities; this is the single number that a routing matrix replaces, and it
 * is wrong in exactly the places that matter — anywhere a river, a bay or a
 * motorway junction forces a detour.
 */
const CIRCUITY = 1.35

export const straightLineEta: EtaProvider = {
  name: 'straight-line',
  seconds(from, to, vehicle) {
    return (haversineMetres(from, to) * CIRCUITY) / SPEED[vehicle]
  },
}

/**
 * Looks travel times up in a precomputed matrix, falling back to the estimate
 * above for any pair that was not precomputed. Built from a real routing engine
 * offline so the browser needs no routing service at run time.
 */
export function matrixEta(
  durations: Record<string, number>,
  keyOf: (point: LatLng) => string,
  fallback: EtaProvider = straightLineEta,
): EtaProvider {
  return {
    name: 'routing-matrix',
    seconds(from, to, vehicle) {
      const direct = durations[`${keyOf(from)}|${keyOf(to)}`]
      if (direct === undefined) return fallback.seconds(from, to, vehicle)
      // The matrix is built for a car; other vehicles scale off it.
      return direct * (SPEED.car / SPEED[vehicle])
    },
  }
}
