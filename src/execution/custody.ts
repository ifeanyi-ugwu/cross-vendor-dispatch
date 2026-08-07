/**
 * Who is holding what, recorded as events rather than fields.
 *
 * A plan is a claim about the future. Execution is a record of the past, and
 * those need different shapes. Once two couriers can hand goods between them,
 * custody is written from two directions over unreliable connections, and the
 * question support will actually be asked — who had this at 14:32 — cannot be
 * answered by a field holding the current value.
 *
 * So custody is the fold, never the store. Nothing here mutates a holder; it
 * appends what happened and derives the rest.
 */
import type { VendorOrder } from '../domain/types.ts'

export type CustodyEvent =
  /** A courier has the goods in hand at the vendor. */
  | { at: number; type: 'collected'; vendorId: string; courierId: string }
  /** One courier offers, the other accepts. Both halves are recorded because
   *  either party alone claiming a transfer is exactly the dispute this exists
   *  to settle. */
  | { at: number; type: 'handover:offered'; vendorId: string; from: string; to: string }
  | { at: number; type: 'handover:accepted'; vendorId: string; from: string; to: string }
  /** The goods reached the customer. */
  | { at: number; type: 'delivered'; vendorId: string; courierId: string }

/** Where a vendor's goods are: still at the shop, with a courier, or arrived. */
export type Holder = { kind: 'vendor' } | { kind: 'courier'; courierId: string } | { kind: 'customer' }

export const AT_VENDOR: Holder = { kind: 'vendor' }
export const WITH_CUSTOMER: Holder = { kind: 'customer' }

/**
 * Folds the log to the current holder. An offered handover does not move
 * anything — custody transfers only once the receiving courier has accepted,
 * so a transfer interrupted halfway leaves the goods with whoever still
 * physically has them.
 */
export function holderOf(events: CustodyEvent[], vendorId: string, upTo = Infinity): Holder {
  let holder: Holder = AT_VENDOR

  for (const event of events) {
    if (event.vendorId !== vendorId || event.at > upTo) continue

    if (event.type === 'collected') holder = { kind: 'courier', courierId: event.courierId }
    if (event.type === 'handover:accepted') holder = { kind: 'courier', courierId: event.to }
    if (event.type === 'delivered') holder = WITH_CUSTOMER
  }

  return holder
}

/** Everything a courier is currently carrying. */
export function cargoOf(events: CustodyEvent[], courierId: string, vendorIds: string[]): string[] {
  return vendorIds.filter((vendorId) => {
    const holder = holderOf(events, vendorId)
    return holder.kind === 'courier' && holder.courierId === courierId
  })
}

export type CustodyViolation = { at: number; rule: string; detail: string }

/**
 * Reads the log for sequences that cannot have happened. Kept separate from
 * appending so a real system could run it over stored history rather than only
 * at the moment of writing — a log that was only ever checked on the way in
 * cannot be audited afterwards.
 */
export function custodyViolations(
  events: CustodyEvent[],
  orders: VendorOrder[],
): CustodyViolation[] {
  const violations: CustodyViolation[] = []
  const holders = new Map<string, Holder>(orders.map((order) => [order.vendorId, AT_VENDOR]))
  const known = new Set(orders.map((order) => order.vendorId))
  const offered = new Set<string>()

  const report = (at: number, rule: string, detail: string) =>
    violations.push({ at, rule, detail })

  let previousAt = -Infinity

  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    if (event.at < previousAt) report(event.at, 'events out of order', event.type)
    previousAt = event.at

    if (!known.has(event.vendorId)) {
      report(event.at, 'event for an order that is not in the basket', event.vendorId)
      continue
    }

    const holder = holders.get(event.vendorId) as Holder

    switch (event.type) {
      case 'collected':
        if (holder.kind !== 'vendor') {
          report(event.at, 'collected goods that had already left the vendor', event.vendorId)
        }
        holders.set(event.vendorId, { kind: 'courier', courierId: event.courierId })
        break

      case 'handover:offered':
        if (holder.kind !== 'courier' || holder.courierId !== event.from) {
          report(event.at, 'handover offered by a courier not holding the goods', event.from)
        }
        offered.add(`${event.vendorId}|${event.from}|${event.to}`)
        break

      case 'handover:accepted': {
        const key = `${event.vendorId}|${event.from}|${event.to}`
        if (!offered.has(key)) {
          report(event.at, 'handover accepted that was never offered', key)
        }
        if (holder.kind !== 'courier' || holder.courierId !== event.from) {
          report(event.at, 'handover from a courier not holding the goods', event.from)
        }
        offered.delete(key)
        holders.set(event.vendorId, { kind: 'courier', courierId: event.to })
        break
      }

      case 'delivered':
        if (holder.kind !== 'courier' || holder.courierId !== event.courierId) {
          report(event.at, 'delivered by a courier not holding the goods', event.courierId)
        }
        holders.set(event.vendorId, WITH_CUSTOMER)
        break
    }
  }

  return violations
}
