/**
 * A field study to sit beside the controlled one.
 *
 * `sweep.ts` places vendors on a circle and varies one thing at a time, which
 * is the right way to isolate what spread and prep skew each do — but the
 * geometry is invented, and the travel times under it are straight-line
 * estimates that run short on long trips and long on short ones.
 *
 * This runs every pair of real Doha vendors to every customer area on measured
 * road times. It cannot separate the variables, and it is not meant to. It
 * answers the different question of how often consolidation is worth reaching
 * for over the geometry a city actually has.
 */
import type { Basket, StrategyName, Temperature } from '../domain/types.ts'
import { COURIERS, CUSTOMER_AREAS, MEETING_POINTS, VENDORS } from '../fixtures/doha.ts'
import { DEFAULT_CONFIG } from '../planner/courierRun.ts'
import { objectiveFor, rank } from '../planner/evaluate.ts'
import { planAll } from '../planner/strategies.ts'
import { routedEta } from '../routing/matrix.ts'

export type FieldCase = {
  vendors: [string, string]
  customerId: string
  temperature: Temperature
  winner: StrategyName
  totals: Partial<Record<StrategyName, number>>
  /** What the winning plan saves against sending a courier per vendor. */
  savedAgainstSeparate: number
}

export function runFieldStudy(temperatures: Temperature[] = ['ambient', 'hot']): FieldCase[] {
  const config = { ...DEFAULT_CONFIG, eta: routedEta }
  const cases: FieldCase[] = []

  for (const temperature of temperatures) {
    for (let i = 0; i < VENDORS.length; i += 1) {
      for (let j = i + 1; j < VENDORS.length; j += 1) {
        for (const customer of CUSTOMER_AREAS) {
          const pair = [VENDORS[i], VENDORS[j]]
          const basket: Basket = {
            id: `${VENDORS[i].id}+${VENDORS[j].id}@${customer.id}`,
            placedAt: 0,
            customer: { ...customer },
            orders: pair.map((vendor) => ({
              vendorId: vendor.id,
              vendor,
              value: 60 + vendor.prepMinutes * 4,
              temperature,
              readyAt: vendor.prepMinutes * 60_000,
            })),
          }

          const scored = rank(
            planAll({
              basket,
              couriers: COURIERS,
              meetingPoints: MEETING_POINTS,
              config,
              objective: objectiveFor(basket),
            }),
            basket,
          )
          if (scored.length === 0) continue

          const totals: Partial<Record<StrategyName, number>> = {}
          for (const entry of scored) totals[entry.plan.strategy] = entry.total

          const separate = totals.separate
          cases.push({
            vendors: [VENDORS[i].id, VENDORS[j].id],
            customerId: customer.id,
            temperature,
            winner: scored[0].plan.strategy,
            totals,
            savedAgainstSeparate: separate === undefined ? 0 : separate - scored[0].total,
          })
        }
      }
    }
  }

  return cases
}

export type FieldSummary = {
  cases: number
  winRate: Record<StrategyName, number>
  /** Share of baskets where combining beat a courier per vendor. */
  consolidationWins: number
  /** Median saving across the baskets where it did, in riyal. */
  medianSaving: number
  /** Median saving as a share of what separate deliveries would have cost. */
  medianSavingShare: number
}

export function summarise(cases: FieldCase[]): FieldSummary {
  const counts: Record<StrategyName, number> = { separate: 0, sequential: 0, rendezvous: 0 }
  for (const item of cases) counts[item.winner] += 1

  const wins = cases.filter((item) => item.winner !== 'separate')
  const savings = wins.map((item) => item.savedAgainstSeparate).sort((a, b) => a - b)
  const shares = wins
    .map((item) => (item.totals.separate ? item.savedAgainstSeparate / item.totals.separate : 0))
    .sort((a, b) => a - b)

  const median = (values: number[]) => (values.length ? values[Math.floor(values.length / 2)] : 0)
  const total = cases.length || 1

  return {
    cases: cases.length,
    winRate: {
      separate: counts.separate / total,
      sequential: counts.sequential / total,
      rendezvous: counts.rendezvous / total,
    },
    consolidationWins: wins.length / total,
    medianSaving: median(savings),
    medianSavingShare: median(shares),
  }
}
