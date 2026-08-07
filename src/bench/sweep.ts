/**
 * Maps the regime where each strategy wins.
 *
 * Two vendors are placed on a circle around the customer: `spreadDegrees` is
 * the angle between them as seen from the customer, so 0 puts them side by side
 * and 180 puts them on opposite sides. `prepSkewMinutes` is how much later one
 * kitchen finishes than the other.
 *
 * Those two numbers are the whole argument. Consolidation by handover can only
 * save distance when a meeting point exists on both couriers' way to the
 * customer, which needs a narrow angle; and it only beats sending one courier
 * to both vendors when the kitchens finish far enough apart that the single
 * courier would stand waiting.
 */
import type { Basket, Courier, LatLng, Temperature, Vendor } from '../domain/types.ts'
import { MEETING_POINTS } from '../fixtures/doha.ts'
import { DEFAULT_CONFIG } from '../planner/courierRun.ts'
import { leaders, objectiveFor, rank } from '../planner/evaluate.ts'
import { planAll } from '../planner/strategies.ts'
import { straightLineEta } from '../routing/eta.ts'
import type { StrategyName } from '../domain/types.ts'

/** Where the sweep is run. Doha by default, but nothing here depends on it —
 *  pass another origin to check the planner behaves the same elsewhere. */
export const DEFAULT_ORIGIN: LatLng & { id: string; label: string } = {
  id: 'cust',
  label: 'Customer',
  lat: 25.2854,
  lng: 51.531,
}

const KM_PER_DEGREE_LAT = 111.32

/**
 * Places a point a given distance and bearing from the origin.
 *
 * A degree of longitude shrinks towards the poles, so the conversion has to be
 * taken at the origin's own latitude rather than fixed. Hardcoding it turns the
 * circle into an ellipse anywhere else, and the angle the sweep reports stops
 * being the angle it measured.
 */
function onCircle(origin: LatLng, radiusKm: number, bearingDegrees: number): LatLng {
  const radians = (bearingDegrees * Math.PI) / 180
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180)
  return {
    lat: origin.lat + (radiusKm * Math.cos(radians)) / KM_PER_DEGREE_LAT,
    lng: origin.lng + (radiusKm * Math.sin(radians)) / kmPerDegreeLng,
  }
}

export type SweepCell = {
  spreadDegrees: number
  prepSkewMinutes: number
  radiusKm: number
  temperature: Temperature
  schedulable: boolean
  /** Where the two vendors were placed, so a caller can check the geometry it
   *  asked for is the geometry it got. */
  vendorPositions: [LatLng, LatLng]
  winner: StrategyName
  /** Every strategy too close to the winner to be told apart from it. More
   *  than one means the cell is a tie, not a result. */
  tied: StrategyName[]
  totals: Record<StrategyName, number | null>
}

export function sweepCell(
  spreadDegrees: number,
  prepSkewMinutes: number,
  radiusKm: number,
  temperature: Temperature,
  schedulable = false,
  origin: LatLng & { id: string; label: string } = DEFAULT_ORIGIN,
): SweepCell {
  const half = spreadDegrees / 2
  const vendors: Vendor[] = [
    { id: 'v-a', label: 'Vendor A', ...onCircle(origin, radiusKm, -half), prepMinutes: 8, schedulable },
    {
      id: 'v-b',
      label: 'Vendor B',
      ...onCircle(origin, radiusKm, half),
      prepMinutes: 8 + prepSkewMinutes,
      schedulable,
    },
  ]

  const basket: Basket = {
    id: 'sweep',
    placedAt: 0,
    customer: origin,
    orders: vendors.map((vendor) => ({
      vendorId: vendor.id,
      vendor,
      value: 100,
      temperature,
      readyAt: vendor.prepMinutes * 60_000,
    })),
  }

  // Couriers sit beside each vendor, so courier positioning does not colour the
  // comparison — the geometry under test is vendor-to-customer, not
  // courier-to-vendor.
  const couriers: Courier[] = vendors.flatMap((vendor, index) => [
    {
      id: `c-${index}a`,
      name: `Courier ${index}a`,
      label: `Courier ${index}a`,
      vehicle: 'car' as const,
      lat: vendor.lat,
      lng: vendor.lng,
      availableAt: 0,
    },
  ])

  const config = { ...DEFAULT_CONFIG, eta: straightLineEta }
  const scored = rank(
    planAll({ basket, couriers, meetingPoints: MEETING_POINTS, config, objective: objectiveFor(basket) }),
    basket,
  )

  const totals: Record<StrategyName, number | null> = {
    separate: null,
    sequential: null,
    rendezvous: null,
  }
  for (const entry of scored) totals[entry.plan.strategy] = entry.total

  return {
    spreadDegrees,
    prepSkewMinutes,
    radiusKm,
    temperature,
    schedulable,
    vendorPositions: [
      { lat: vendors[0].lat, lng: vendors[0].lng },
      { lat: vendors[1].lat, lng: vendors[1].lng },
    ],
    winner: scored[0].plan.strategy,
    tied: leaders(scored).map((entry) => entry.plan.strategy),
    totals,
  }
}

export function sweep(options: {
  spreads: number[]
  skews: number[]
  radii: number[]
  temperatures: Temperature[]
  schedulable?: boolean[]
}): SweepCell[] {
  const cells: SweepCell[] = []
  for (const schedulable of options.schedulable ?? [false]) {
    for (const temperature of options.temperatures) {
      for (const radiusKm of options.radii) {
        for (const spreadDegrees of options.spreads) {
          for (const prepSkewMinutes of options.skews) {
            cells.push(
              sweepCell(spreadDegrees, prepSkewMinutes, radiusKm, temperature, schedulable),
            )
          }
        }
      }
    }
  }
  return cells
}

/** Cells where more than one strategy is within the indifference band, so the
 *  reported winner is an artefact of rounding rather than a finding. */
export function contestedShare(cells: SweepCell[]): number {
  if (cells.length === 0) return 0
  return cells.filter((cell) => cell.tied.length > 1).length / cells.length
}

export function winRates(cells: SweepCell[]): Record<StrategyName, number> {
  const counts: Record<StrategyName, number> = { separate: 0, sequential: 0, rendezvous: 0 }
  for (const cell of cells) counts[cell.winner] += 1
  const total = cells.length || 1
  return {
    separate: counts.separate / total,
    sequential: counts.sequential / total,
    rendezvous: counts.rendezvous / total,
  }
}
