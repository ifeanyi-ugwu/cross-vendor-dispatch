import type { Basket, Plan, PlanAttempt } from '../domain/types.ts'
import { isPlan } from '../domain/types.ts'

/**
 * Illustrative figures in Qatari riyal. They are not measured, but the shape
 * matters more than the magnitudes: courier time is the platform's real cost,
 * and goods that spoil convert delay directly into a worse product.
 */
export type CostModel = {
  perCourierMinute: number
  /** Charged once per courier involved — allocation, insurance, the fixed
   *  overhead of putting one more person on the job. */
  perCourierEngaged: number
}

export type QualityModel = {
  /** Riyal lost per minute a vendor's goods spend in transit, by temperature. */
  decayPerMinute: Record<'ambient' | 'chilled' | 'hot', number>
  /** Riyal per minute the customer waits from placing the basket. */
  latencyPerMinute: number
}

export const DEFAULT_COST: CostModel = {
  perCourierMinute: 0.85,
  perCourierEngaged: 3.0,
}

export const DEFAULT_QUALITY: QualityModel = {
  decayPerMinute: { ambient: 0.02, chilled: 0.12, hot: 0.35 },
  latencyPerMinute: 0.15,
}

function couriersEngaged(plan: Plan): number {
  return new Set(plan.legs.map((leg) => leg.courierId)).size
}

/**
 * What the delivery costs to run. Kept separate from the quality terms because
 * this is the number that gets divided between vendors — a vendor should not be
 * billed for the customer's impatience.
 */
export function operatingCost(plan: Plan, model: CostModel = DEFAULT_COST): number {
  return (
    (plan.courierSeconds / 60) * model.perCourierMinute +
    couriersEngaged(plan) * model.perCourierEngaged
  )
}

export function freshnessPenalty(
  plan: Plan,
  basket: Basket,
  model: QualityModel = DEFAULT_QUALITY,
): number {
  return basket.orders.reduce((total, order) => {
    const minutes = (plan.carriageSeconds[order.vendorId] ?? 0) / 60
    return total + minutes * model.decayPerMinute[order.temperature]
  }, 0)
}

export function latencyPenalty(
  plan: Plan,
  basket: Basket,
  model: QualityModel = DEFAULT_QUALITY,
): number {
  return ((plan.completeAt - basket.placedAt) / 60_000) * model.latencyPerMinute
}

export type Scored = {
  plan: Plan
  operating: number
  freshness: number
  latency: number
  total: number
}

/**
 * One number to rank plans by. Consolidation that saves courier time but leaves
 * a hot meal in a bag for an extra twenty minutes should lose, and only a
 * combined objective can express that.
 */
export function score(
  plan: Plan,
  basket: Basket,
  cost: CostModel = DEFAULT_COST,
  quality: QualityModel = DEFAULT_QUALITY,
): Scored {
  const operating = operatingCost(plan, cost)
  const freshness = freshnessPenalty(plan, basket, quality)
  const latency = latencyPenalty(plan, basket, quality)
  return { plan, operating, freshness, latency, total: operating + freshness + latency }
}

/**
 * The selection criterion, bound to one basket. Handed to the planner so each
 * strategy chooses among its own candidates by the same measure used to compare
 * strategies against each other.
 */
export function objectiveFor(
  basket: Basket,
  cost: CostModel = DEFAULT_COST,
  quality: QualityModel = DEFAULT_QUALITY,
): (plan: Plan) => number {
  return (plan) => score(plan, basket, cost, quality).total
}

export function rank(
  attempts: PlanAttempt[],
  basket: Basket,
  cost: CostModel = DEFAULT_COST,
  quality: QualityModel = DEFAULT_QUALITY,
): Scored[] {
  return attempts
    .filter(isPlan)
    .map((plan) => score(plan, basket, cost, quality))
    .sort((a, b) => a.total - b.total)
}
