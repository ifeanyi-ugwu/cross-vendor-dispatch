/**
 * Runs a plan against a world that does not cooperate.
 *
 * Every figure elsewhere assumes the plan happens. Kitchens run late, couriers
 * get stuck, and a handover is the most breakable plan of the three because it
 * needs two people to converge. What makes replanning different from planning
 * is that it starts from custody: goods already collected are with whoever
 * collected them, and no amount of recalculation puts them back on a shelf.
 */
import type { Basket, Courier, Plan, VendorOrder } from '../domain/types.ts'

import { deliverLeg } from '../planner/courierRun.ts'
import { objectiveFor, rank } from '../planner/evaluate.ts'
import { planAll, type PlanningInput } from '../planner/strategies.ts'
import { custodyViolations, type CustodyEvent } from './custody.ts'
import { before, eventsFor, remainingWork } from './timeline.ts'

export type Disruption =
  /** A vendor announces it will be later than promised. */
  | { at: number; type: 'kitchen:late'; vendorId: string; byMinutes: number }
  /** A courier is held up and everything they have left to do slips. */
  | { at: number; type: 'courier:delayed'; courierId: string; byMinutes: number }

export type ExecutionSetup = Omit<PlanningInput, 'objective'> & {
  disruptions: Disruption[]
}

export type Execution = {
  /** Every plan the run committed to, first to last. */
  plans: Plan[]
  events: CustodyEvent[]
  replans: number
  completeAt: number
  /** How much later than the original plan promised. */
  slipMs: number
  violations: ReturnType<typeof custodyViolations>
}

function choose(basket: Basket, couriers: Courier[], base: Omit<PlanningInput, 'objective' | 'basket' | 'couriers'>): Plan | null {
  const input: PlanningInput = { ...base, basket, couriers, objective: objectiveFor(basket) }
  const best = rank(planAll(input), basket)[0]
  return best?.plan ?? null
}

/** Moves a courier to where they will be once the current leg finishes. */
function positionAt(plan: Plan, courierId: string, moment: number, fallback: Courier): Courier {
  const done = plan.legs
    .filter((leg) => leg.courierId === courierId && leg.arriveAt <= moment)
    .sort((a, b) => a.arriveAt - b.arriveAt)
    .at(-1)

  if (!done) return fallback
  return { ...fallback, lat: done.to.lat, lng: done.to.lng, availableAt: done.arriveAt }
}

/**
 * Plans what is left. Couriers already carrying deliver what they hold; the
 * rest is planned freshly among whoever is free.
 *
 * A carrier is not offered back to the general pool. Handing their load to
 * someone else mid-route is a handover, which is a different operation with its
 * own meeting point and its own risk, not something a replan should do quietly.
 */
function replanRemainder(
  basket: Basket,
  couriers: Courier[],
  current: Plan,
  events: CustodyEvent[],
  now: number,
  base: Omit<PlanningInput, 'objective' | 'basket' | 'couriers'>,
): Plan | null {
  const remaining = remainingWork(basket.orders, events)
  if (remaining.uncollected.length === 0 && remaining.carried.size === 0) return null

  const legs: Plan['legs'] = []
  const handovers: Plan['handovers'] = []
  const carriageSeconds: Record<string, number> = { ...current.carriageSeconds }
  let completeAt = now
  const committed = new Set<string>()

  for (const [courierId, load] of remaining.carried) {
    const courier = couriers.find((candidate) => candidate.id === courierId)
    if (!courier) continue
    committed.add(courierId)

    const at = positionAt(current, courierId, now, courier)
    const delivery = deliverLeg(
      at,
      { id: at.id, label: at.label, lat: at.lat, lng: at.lng },
      basket.customer,
      load.map((order) => order.vendorId),
      Math.max(now, at.availableAt),
      base.config,
    )
    legs.push(delivery.leg)
    completeAt = Math.max(completeAt, delivery.completeAt)
  }

  if (remaining.uncollected.length > 0) {
    const free = couriers
      .filter((courier) => !committed.has(courier.id))
      .map((courier) => positionAt(current, courier.id, now, { ...courier, availableAt: now }))

    const subset: Basket = { ...basket, orders: remaining.uncollected }
    const plan = choose(subset, free, base)
    if (!plan) return null

    legs.push(...plan.legs)
    handovers.push(...plan.handovers)
    Object.assign(carriageSeconds, plan.carriageSeconds)
    completeAt = Math.max(completeAt, plan.completeAt)
  }

  return {
    strategy: current.strategy,
    legs,
    handovers,
    completeAt,
    courierSeconds: legs.reduce(
      (sum, leg) => sum + (leg.arriveAt - leg.departAt) / 1000 + leg.idleSeconds,
      0,
    ),
    idleSeconds: legs.reduce((sum, leg) => sum + leg.idleSeconds, 0),
    carriageSeconds,
  }
}

function applied(basket: Basket, disruption: Disruption): Basket {
  if (disruption.type !== 'kitchen:late') return basket
  return {
    ...basket,
    orders: basket.orders.map((order): VendorOrder =>
      order.vendorId === disruption.vendorId
        ? { ...order, readyAt: order.readyAt + disruption.byMinutes * 60_000 }
        : order,
    ),
  }
}

function delayCouriers(couriers: Courier[], disruption: Disruption): Courier[] {
  if (disruption.type !== 'courier:delayed') return couriers
  return couriers.map((courier) =>
    courier.id === disruption.courierId
      ? { ...courier, availableAt: courier.availableAt + disruption.byMinutes * 60_000 }
      : courier,
  )
}

export function execute(setup: ExecutionSetup): Execution {
  const base = { meetingPoints: setup.meetingPoints, config: setup.config }
  let basket = setup.basket
  let couriers = setup.couriers

  const first = choose(basket, couriers, base)
  if (!first) {
    return { plans: [], events: [], replans: 0, completeAt: 0, slipMs: 0, violations: [] }
  }

  const plans = [first]
  let current = first
  let events: CustodyEvent[] = []
  let replans = 0

  for (const disruption of [...setup.disruptions].sort((a, b) => a.at - b.at)) {
    // Freeze what had happened by the time the news arrived. Everything after
    // it is now a claim about a world that has changed.
    events = before(eventsFor(current, setup.config.serviceSeconds), disruption.at)

    basket = applied(basket, disruption)
    couriers = delayCouriers(couriers, disruption)

    const revised = replanRemainder(basket, couriers, current, events, disruption.at, base)
    if (!revised) continue

    current = revised
    plans.push(revised)
    replans += 1
  }

  const tail = eventsFor(current, setup.config.serviceSeconds).filter(
    (event) => !events.some((seen) => seen.type === event.type && seen.vendorId === event.vendorId),
  )
  const all = [...events, ...tail].sort((a, b) => a.at - b.at)

  return {
    plans,
    events: all,
    replans,
    completeAt: current.completeAt,
    slipMs: current.completeAt - first.completeAt,
    violations: custodyViolations(all, setup.basket.orders),
  }
}

