import type {
  Basket,
  Courier,
  Handover,
  Leg,
  MeetingPoint,
  Plan,
  PlanAttempt,
  VendorOrder,
} from '../domain/types.ts'
import {
  deliverLeg,
  permutations,
  runCollection,
  twoWaySplits,
  type CollectionRun,
  type PlannerConfig,
} from './courierRun.ts'

export type PlanningInput = {
  basket: Basket
  couriers: Courier[]
  meetingPoints: MeetingPoint[]
  config: PlannerConfig
  /**
   * How a strategy picks among its own candidates. Required rather than
   * defaulted, because a strategy that internally chases the earliest arrival
   * while being compared on cost will select a plan nobody asked for — a
   * meeting point that shaves a minute off delivery by leaving a courier
   * standing for half an hour looks excellent by one measure and absurd by the
   * other. Same function here as in the final ranking.
   */
  objective: (plan: Plan) => number
}

function totalCourierSeconds(legs: Leg[]): number {
  return legs.reduce(
    (sum, leg) => sum + (leg.arriveAt - leg.departAt) / 1000 + leg.idleSeconds,
    0,
  )
}

function carriage(madeAt: Record<string, number>, completeAt: number) {
  return Object.fromEntries(
    Object.entries(madeAt).map(([vendorId, at]) => [vendorId, (completeAt - at) / 1000]),
  )
}

/** Couriers nearest a point, cheapest first, excluding any already committed. */
function nearestCouriers(
  input: PlanningInput,
  to: VendorOrder,
  exclude: Set<string>,
  limit = 3,
): Courier[] {
  return input.couriers
    .filter((courier) => !exclude.has(courier.id))
    .map((courier) => ({
      courier,
      // Rank by when they could actually be there, not how far away they are.
      // A courier round the corner who is busy for forty minutes is worse than
      // one across town who is free now.
      cost:
        courier.availableAt +
        input.config.eta.seconds(courier, to.vendor, courier.vehicle) * 1000,
    }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, limit)
    .map((entry) => entry.courier)
}

/**
 * The status quo: one courier per vendor, each driving to the customer alone.
 * The basket arrives in pieces and every vendor carries a whole delivery.
 */
export function planSeparate(input: PlanningInput): PlanAttempt {
  const { basket } = input
  if (input.couriers.length < basket.orders.length) {
    return {
      strategy: 'separate',
      reason: `needs ${basket.orders.length} couriers, ${input.couriers.length} free`,
    }
  }

  const legs: Leg[] = []
  const collectedAt: Record<string, number> = {}
  const carriageSeconds: Record<string, number> = {}
  const committed = new Set<string>()
  let completeAt = 0

  for (const order of basket.orders) {
    const [courier] = nearestCouriers(input, order, committed, 1)
    if (!courier) return { strategy: 'separate', reason: 'ran out of couriers' }
    committed.add(courier.id)

    const run = runCollection(courier, [order], input.config)
    const delivery = deliverLeg(
      courier,
      run.at,
      basket.customer,
      run.cargo,
      run.finishedAt,
      input.config,
    )

    legs.push(...run.legs, delivery.leg)
    Object.assign(collectedAt, run.collectedAt)
    carriageSeconds[order.vendorId] =
      (delivery.completeAt - run.madeAt[order.vendorId]) / 1000
    completeAt = Math.max(completeAt, delivery.completeAt)
  }

  return {
    strategy: 'separate',
    legs,
    handovers: [],
    completeAt,
    courierSeconds: totalCourierSeconds(legs),
    idleSeconds: legs.reduce((sum, leg) => sum + leg.idleSeconds, 0),
    carriageSeconds,
  }
}

/**
 * One courier collects from every vendor in turn, then delivers once. What the
 * large platforms ship, and the right answer whenever the vendors sit close
 * together and their kitchens finish at roughly the same time.
 */
export function planSequential(input: PlanningInput): PlanAttempt {
  const { basket } = input
  if (input.couriers.length === 0) {
    return { strategy: 'sequential', reason: 'no couriers free' }
  }

  let best: Plan | null = null

  for (const courier of input.couriers) {
    for (const ordering of permutations(basket.orders)) {
      const run = runCollection(courier, ordering, input.config)
      const delivery = deliverLeg(
        courier,
        run.at,
        basket.customer,
        run.cargo,
        run.finishedAt,
        input.config,
      )
      const legs = [...run.legs, delivery.leg]

      const candidate: Plan = {
        strategy: 'sequential',
        legs,
        handovers: [],
        completeAt: delivery.completeAt,
        courierSeconds: totalCourierSeconds(legs),
        idleSeconds: run.idleSeconds,
        carriageSeconds: carriage(run.madeAt, delivery.completeAt),
      }

      if (!best || input.objective(candidate) < input.objective(best)) best = candidate
    }
  }

  return best ?? { strategy: 'sequential', reason: 'no viable ordering' }
}

type Side = { courier: Courier; ordering: VendorOrder[]; run: CollectionRun }

/**
 * Every way one courier could collect a group of vendors.
 *
 * Returned in full rather than reduced to a best, because "best" is not
 * decidable here: the collection that finishes earliest may finish somewhere
 * awkward for the handover, and which meeting point is reachable is not known
 * until both sides and the point are considered together. Choosing early is
 * what made adjacent scenarios flip between plans for no visible reason.
 */
function collectionCandidates(
  input: PlanningInput,
  orders: VendorOrder[],
  exclude: Set<string>,
): Side[] {
  const candidates: Side[] = []

  for (const courier of nearestCouriers(input, orders[0], exclude)) {
    for (const ordering of permutations(orders)) {
      candidates.push({ courier, ordering, run: runCollection(courier, ordering, input.config) })
    }
  }

  return candidates
}

/** Re-runs a side's collection starting later, so it reaches the meeting point
 *  as the other side does instead of arriving early and waiting. */
function shiftedBy(side: Side, delayMs: number, input: PlanningInput): Side {
  if (delayMs <= 0) return side
  return {
    ...side,
    run: runCollection(
      side.courier,
      side.ordering,
      input.config,
      side.courier.availableAt + delayMs,
    ),
  }
}

/**
 * Couriers collect in parallel and meet once, after which a single courier
 * carries the whole basket onward.
 *
 * The handover cannot happen until the later of the two arrives, so the score
 * turns on how well the two collection runs align in time rather than on
 * distance alone. Meeting points come from a curated list because two people
 * have to stop, park and find each other — the arithmetically optimal spot is
 * frequently a junction nobody can wait at.
 */
export function planRendezvous(input: PlanningInput): PlanAttempt {
  const { basket, config } = input

  if (basket.orders.length < 2) {
    return { strategy: 'rendezvous', reason: 'only one vendor, nothing to combine' }
  }
  if (input.couriers.length < 2) {
    return { strategy: 'rendezvous', reason: 'needs 2 couriers' }
  }
  if (input.meetingPoints.length === 0) {
    return { strategy: 'rendezvous', reason: 'no meeting points defined' }
  }

  let best: Plan | null = null

  // A vendor is a meeting point in its own right. Whichever courier collects
  // there has to stop anyway, so a handover that happens during that stop costs
  // them no extra travel at all.
  const candidatePoints: MeetingPoint[] = [
    ...input.meetingPoints,
    ...basket.orders.map((order) => ({ ...order.vendor, note: 'handover while collecting' })),
  ]

  for (const [leftOrders, rightOrders] of twoWaySplits(basket.orders)) {
    // Courier, visit order and meeting point are chosen together. Fixing the
    // couriers first and the point afterwards means committing to a pair before
    // knowing where they have to converge.
    for (const leftBase of collectionCandidates(input, leftOrders, new Set())) {
    for (const rightBase of collectionCandidates(input, rightOrders, new Set([leftBase.courier.id]))) {
    for (const point of candidatePoints) {
      const arrivalAt = (side: Side) =>
        side.run.finishedAt + config.eta.seconds(side.run.at, point, side.courier.vehicle) * 1000

      // Both must be present before anything changes hands, so the earlier one
      // simply starts later. Its kitchens then cook nearer to collection, which
      // costs nothing and delivers fresher goods — the wait is removed rather
      // than moved from the vendor counter to the roadside.
      const meetAt = Math.max(arrivalAt(leftBase), arrivalAt(rightBase))
      const left = shiftedBy(leftBase, meetAt - arrivalAt(leftBase), input)
      const right = shiftedBy(rightBase, meetAt - arrivalAt(rightBase), input)

      const legToPoint = (side: Side) => {
        const travel = config.eta.seconds(side.run.at, point, side.courier.vehicle)
        return {
          departAt: side.run.finishedAt,
          arriveAt: side.run.finishedAt + travel * 1000,
        }
      }

      const leftHop = legToPoint(left)
      const rightHop = legToPoint(right)
      const bothPresentAt = Math.max(leftHop.arriveAt, rightHop.arriveAt)
      const handoverDoneAt = bothPresentAt + config.handoverSeconds * 1000

      // Any remainder is a wait the shift could not absorb, and it is paid time.
      const leftIdle = (bothPresentAt - leftHop.arriveAt) / 1000
      const rightIdle = (bothPresentAt - rightHop.arriveAt) / 1000

      for (const carrier of [left, right]) {
        const donor = carrier === left ? right : left
        const carrierHop = carrier === left ? leftHop : rightHop
        const donorHop = carrier === left ? rightHop : leftHop
        const cargo = [...left.run.cargo, ...right.run.cargo]

        const transferLegs: Leg[] = [
          {
            courierId: carrier.courier.id,
            kind: 'transfer',
            from: carrier.run.at,
            to: point,
            cargo: carrier.run.cargo,
            departAt: carrierHop.departAt,
            arriveAt: carrierHop.arriveAt,
            idleSeconds: carrier === left ? leftIdle : rightIdle,
          },
          {
            courierId: donor.courier.id,
            kind: 'transfer',
            from: donor.run.at,
            to: point,
            cargo: donor.run.cargo,
            departAt: donorHop.departAt,
            arriveAt: donorHop.arriveAt,
            idleSeconds: carrier === left ? rightIdle : leftIdle,
          },
        ]

        const delivery = deliverLeg(
          carrier.courier,
          point,
          basket.customer,
          cargo,
          handoverDoneAt,
          config,
        )

        const legs = [
          ...left.run.legs,
          ...right.run.legs,
          ...transferLegs,
          delivery.leg,
        ]

        const handover: Handover = {
          at: point,
          fromCourierId: donor.courier.id,
          toCourierId: carrier.courier.id,
          cargo: donor.run.cargo,
          occursAt: handoverDoneAt,
        }

        const candidate: Plan = {
          strategy: 'rendezvous',
          legs,
          handovers: [handover],
          completeAt: delivery.completeAt,
          courierSeconds: totalCourierSeconds(legs),
          idleSeconds:
            left.run.idleSeconds + right.run.idleSeconds + leftIdle + rightIdle,
          carriageSeconds: carriage(
            { ...left.run.madeAt, ...right.run.madeAt },
            delivery.completeAt,
          ),
        }

        if (!best || input.objective(candidate) < input.objective(best)) best = candidate
      }
    }
    }
    }
  }

  return best ?? { strategy: 'rendezvous', reason: 'no viable meeting point' }
}

export function planAll(input: PlanningInput): PlanAttempt[] {
  return [planSeparate(input), planSequential(input), planRendezvous(input)]
}
