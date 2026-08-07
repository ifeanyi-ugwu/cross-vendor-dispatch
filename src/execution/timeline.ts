/**
 * Turns a plan into the custody record it would produce if everything went as
 * planned, and answers what is left to do when it does not.
 *
 * Kept apart from the planner because a plan is a claim and these are events.
 * The distinction matters when replanning: what has already been collected is
 * a fact the next plan has to accept, not a decision it may revisit.
 */
import type { Plan, VendorOrder } from '../domain/types.ts'
import { holderOf, type CustodyEvent } from './custody.ts'

/**
 * The custody events a plan implies, in time order.
 *
 * Collection is recorded at the moment the goods change hands rather than when
 * the courier arrives, since a courier waiting at a counter is not yet holding
 * anything.
 */
export function eventsFor(plan: Plan, serviceSeconds: number): CustodyEvent[] {
  const events: CustodyEvent[] = []
  const collected = new Set<string>()

  for (const leg of plan.legs) {
    if (leg.kind !== 'collect') continue
    // A collect leg's cargo is everything aboard afterwards; the new item is
    // whatever was not aboard before.
    for (const vendorId of leg.cargo) {
      if (collected.has(vendorId)) continue
      collected.add(vendorId)
      events.push({
        at: Math.max(leg.arriveAt, 0) + serviceSeconds * 1000 + leg.idleSeconds * 1000,
        type: 'collected',
        vendorId,
        courierId: leg.courierId,
      })
    }
  }

  for (const handover of plan.handovers) {
    for (const vendorId of handover.cargo) {
      events.push({
        at: handover.occursAt - 1,
        type: 'handover:offered',
        vendorId,
        from: handover.fromCourierId,
        to: handover.toCourierId,
      })
      events.push({
        at: handover.occursAt,
        type: 'handover:accepted',
        vendorId,
        from: handover.fromCourierId,
        to: handover.toCourierId,
      })
    }
  }

  for (const leg of plan.legs) {
    if (leg.kind !== 'deliver') continue
    for (const vendorId of leg.cargo) {
      events.push({ at: leg.arriveAt, type: 'delivered', vendorId, courierId: leg.courierId })
    }
  }

  return events.sort((a, b) => a.at - b.at)
}

/** Events that had already happened by a given moment. */
export function before(events: CustodyEvent[], moment: number): CustodyEvent[] {
  return events.filter((event) => event.at <= moment)
}

export type Remaining = {
  /** Still at the vendor, so still freely plannable. */
  uncollected: VendorOrder[]
  /** Already in a courier's hands. Which courier is a fact now, not a choice —
   *  a replan may route them differently but cannot give their load to someone
   *  else without a handover. */
  carried: Map<string, VendorOrder[]>
  delivered: VendorOrder[]
}

export function remainingWork(orders: VendorOrder[], events: CustodyEvent[]): Remaining {
  const uncollected: VendorOrder[] = []
  const carried = new Map<string, VendorOrder[]>()
  const delivered: VendorOrder[] = []

  for (const order of orders) {
    const holder = holderOf(events, order.vendorId)
    if (holder.kind === 'vendor') uncollected.push(order)
    else if (holder.kind === 'customer') delivered.push(order)
    else {
      const load = carried.get(holder.courierId) ?? []
      load.push(order)
      carried.set(holder.courierId, load)
    }
  }

  return { uncollected, carried, delivered }
}
