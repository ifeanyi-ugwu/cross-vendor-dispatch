/**
 * What the basket costs the person waiting for it.
 *
 * Everything else here divides cost between vendors. This is the other side of
 * that: today a customer ordering from two shops pays two delivery fees, waits
 * for two arrivals and answers the door twice, because the platform prices per
 * vendor-order. A shared delivery is one fee and one arrival, and the gap
 * between those two numbers is the entire argument.
 */
import type { Basket, Plan } from '../domain/types.ts'
import { DEFAULT_COST, operatingCost, type CostModel } from './evaluate.ts'

export type FeeModel = {
  /** Charged for any delivery, however short. */
  minimum: number
  /** Multiple of what the delivery costs to run. A fee below its own operating
   *  cost loses money on the basket, so this is what keeps a shared delivery
   *  from being priced as a giveaway. */
  markup: number
}

export const DEFAULT_FEES: FeeModel = { minimum: 8, markup: 1.25 }

export type CustomerBill = {
  /** Sum of the per-vendor fees, which is what the basket costs today. */
  today: number
  /** One fee for one delivery. */
  shared: number
  saved: number
  savedShare: number
  /** Negative when the shared plan arrives later than the last separate one,
   *  which happens and should not be hidden. */
  arrivesEarlierMs: number
  deliveriesToday: number
}

/**
 * Costs each courier's work separately. Under `separate` every courier serves
 * exactly one vendor, so this is the price of each order standing alone —
 * today's bill, line by line.
 */
function perCourierCost(plan: Plan, model: CostModel): number[] {
  const byCourier = new Map<string, Plan['legs']>()
  for (const leg of plan.legs) {
    const legs = byCourier.get(leg.courierId) ?? []
    legs.push(leg)
    byCourier.set(leg.courierId, legs)
  }

  return [...byCourier.values()].map((legs) =>
    operatingCost({ ...plan, legs, courierSeconds: courierSecondsOf(legs) }, model),
  )
}

function courierSecondsOf(legs: Plan['legs']): number {
  return legs.reduce(
    (sum, leg) => sum + (leg.arriveAt - leg.departAt) / 1000 + leg.idleSeconds,
    0,
  )
}

const fee = (cost: number, model: FeeModel) => Math.max(model.minimum, cost * model.markup)

export function customerBill(
  separate: Plan,
  chosen: Plan,
  basket: Basket,
  fees: FeeModel = DEFAULT_FEES,
  costs: CostModel = DEFAULT_COST,
): CustomerBill {
  const perDelivery = perCourierCost(separate, costs)
  const today = perDelivery.reduce((sum, cost) => sum + fee(cost, fees), 0)
  const shared = fee(operatingCost(chosen, costs), fees)

  return {
    today,
    shared,
    saved: today - shared,
    savedShare: today === 0 ? 0 : (today - shared) / today,
    arrivesEarlierMs: separate.completeAt - chosen.completeAt,
    deliveriesToday: basket.orders.length,
  }
}
