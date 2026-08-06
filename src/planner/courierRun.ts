import type { Courier, Leg, Place, VendorOrder } from '../domain/types.ts'
import type { EtaProvider } from '../routing/eta.ts'

export type PlannerConfig = {
  eta: EtaProvider
  /** Seconds spent at a vendor counter collecting goods. */
  serviceSeconds: number
  /** Seconds to move goods from one courier to another, including finding each
   *  other. This overhead is what makes a rendezvous lose on short trips. */
  handoverSeconds: number
  /** Seconds spent at the customer's door. */
  dropoffSeconds: number
}

export const DEFAULT_CONFIG: Omit<PlannerConfig, 'eta'> = {
  serviceSeconds: 120,
  handoverSeconds: 90,
  dropoffSeconds: 120,
}

export type CollectionRun = {
  legs: Leg[]
  /** When the courier is loaded and leaving the last vendor. */
  finishedAt: number
  idleSeconds: number
  /** Vendor id to the moment its goods were collected. */
  collectedAt: Record<string, number>
  /**
   * Vendor id to the moment its goods were made, which is what freshness is
   * measured from. A schedulable kitchen produces as the courier arrives; one
   * that cannot be held back produces as soon as it is able and the goods sit
   * until someone comes.
   */
  madeAt: Record<string, number>
  at: Place
  cargo: string[]
}

/**
 * Walks one courier through a fixed sequence of vendors.
 *
 * Arriving before a kitchen is ready does not let the courier leave early — the
 * wait is recorded as idle time rather than hidden, because it is time the
 * platform pays for and the main reason a tempting-looking consolidation turns
 * out worse than two separate trips.
 */
export function runCollection(
  courier: Courier,
  orders: VendorOrder[],
  config: PlannerConfig,
  startAt: number = courier.availableAt,
): CollectionRun {
  const first = simulateCollection(courier, orders, config, startAt)
  if (orders.length === 0) return first

  // Sending a courier out to stand at a counter for twenty minutes is paid
  // time for nothing. Shifting departure by the smallest wait in the run
  // removes that wait entirely and shortens every other one, and since at
  // least one stop then has no wait left, a single pass is enough.
  const slack = Math.min(...first.legs.map((leg) => leg.idleSeconds))
  if (slack <= 0) return first

  return simulateCollection(courier, orders, config, startAt + slack * 1000)
}

function simulateCollection(
  courier: Courier,
  orders: VendorOrder[],
  config: PlannerConfig,
  startAt: number,
): CollectionRun {
  const legs: Leg[] = []
  const collectedAt: Record<string, number> = {}
  const madeAt: Record<string, number> = {}
  const cargo: string[] = []

  let clock = startAt
  let at: Place = courier
  let idleSeconds = 0

  for (const order of orders) {
    const travel = config.eta.seconds(at, order.vendor, courier.vehicle)
    const departAt = clock
    const arriveAt = clock + travel * 1000

    const waitSeconds = Math.max(0, (order.readyAt - arriveAt) / 1000)
    idleSeconds += waitSeconds

    clock = Math.max(arriveAt, order.readyAt) + config.serviceSeconds * 1000
    cargo.push(order.vendorId)
    collectedAt[order.vendorId] = clock
    // A kitchen that can be held back produces to meet the courier; one that
    // cannot has been sitting since it was ready.
    madeAt[order.vendorId] = order.vendor.schedulable
      ? Math.max(order.readyAt, arriveAt)
      : order.readyAt

    legs.push({
      courierId: courier.id,
      kind: 'collect',
      from: at,
      to: order.vendor,
      cargo: [...cargo],
      departAt,
      arriveAt,
      idleSeconds: waitSeconds,
    })

    at = order.vendor
  }

  return { legs, finishedAt: clock, idleSeconds, collectedAt, madeAt, at, cargo }
}

/** Adds the final hop to the customer's door. */
export function deliverLeg(
  courier: Courier,
  from: Place,
  customer: Place,
  cargo: string[],
  departAt: number,
  config: PlannerConfig,
): { leg: Leg; completeAt: number } {
  const travel = config.eta.seconds(from, customer, courier.vehicle)
  const arriveAt = departAt + travel * 1000

  return {
    leg: {
      courierId: courier.id,
      kind: 'deliver',
      from,
      to: customer,
      cargo,
      departAt,
      arriveAt,
      idleSeconds: 0,
    },
    completeAt: arriveAt + config.dropoffSeconds * 1000,
  }
}

/** All orderings of a small set. Vendor counts stay in single digits, so the
 *  factorial growth is bounded well before it matters. */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const result: T[][] = []
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)]
    for (const tail of permutations(rest)) result.push([items[index], ...tail])
  }
  return result
}

/** Every way to split a set into two non-empty groups, without counting a
 *  split and its mirror image twice. */
export function twoWaySplits<T>(items: T[]): Array<[T[], T[]]> {
  const splits: Array<[T[], T[]]> = []
  const total = 1 << items.length
  // Start at 1 and stop below half: bitmask 0 leaves a group empty, and the
  // upper half repeats the lower half with the groups swapped.
  for (let mask = 1; mask < total / 2; mask += 1) {
    const left: T[] = []
    const right: T[] = []
    items.forEach((item, index) => ((mask >> index) & 1 ? left : right).push(item))
    if (left.length && right.length) splits.push([left, right])
  }
  return splits
}
