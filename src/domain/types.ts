/**
 * A basket that spans vendors is normally billed and delivered as several
 * independent orders. These types treat the basket as the unit of work instead,
 * so a plan can collect from several vendors and still arrive once.
 *
 * All times are absolute epoch milliseconds. Durations are seconds.
 */

export type LatLng = { lat: number; lng: number }

export type Place = LatLng & {
  id: string
  label: string
}

/** Goods that tolerate delay differently. Handover costs minutes, and minutes
 *  cost more for a hot meal than for a phone charger. */
export type Temperature = 'ambient' | 'chilled' | 'hot'

export type Vehicle = 'bike' | 'car' | 'van'

export type Vendor = Place & {
  /** Minutes between an order landing and the goods being collectable. The
   *  spread across vendors is what usually decides whether consolidating is
   *  worth it — one kitchen twenty minutes behind another strands a courier. */
  prepMinutes: number
}

/** One vendor's share of a basket. */
export type VendorOrder = {
  vendorId: string
  vendor: Vendor
  /** Goods value, used only to contrast fair allocation against the naive
   *  "split it by what they spent" rule. */
  value: number
  temperature: Temperature
  /** When this vendor's goods can actually be picked up. */
  readyAt: number
}

export type Basket = {
  id: string
  customer: Place
  orders: VendorOrder[]
  placedAt: number
}

export type Courier = Place & {
  name: string
  vehicle: Vehicle
  /** When this courier becomes free; not every courier is idle right now. */
  availableAt: number
}

/**
 * A meeting point where custody moves between couriers. Restricted to a curated
 * list rather than any coordinate: a point optimal on paper but in the middle
 * of a junction is useless, because two people have to stop, park, find each
 * other and move goods.
 */
export type MeetingPoint = Place & {
  /** Why this spot works — shown in the UI, and the reason the set is curated
   *  by hand rather than generated. */
  note: string
}

export type LegKind = 'collect' | 'transfer' | 'deliver'

export type Leg = {
  courierId: string
  kind: LegKind
  from: Place
  to: Place
  /** Vendor ids whose goods are aboard for this leg. */
  cargo: string[]
  departAt: number
  arriveAt: number
  /** Time spent stationary before departing — waiting on a kitchen, or on the
   *  other courier to arrive. Paid for, and invisible unless measured. */
  idleSeconds: number
}

export type Handover = {
  at: MeetingPoint
  fromCourierId: string
  toCourierId: string
  cargo: string[]
  occursAt: number
}

export type StrategyName =
  /** One courier per vendor, each driving straight to the customer. The status
   *  quo: n deliveries, n fees. */
  | 'separate'
  /** One courier collects from every vendor in turn, then delivers once. */
  | 'sequential'
  /** Couriers collect in parallel, meet, and one carries everything onward. */
  | 'rendezvous'

export type Plan = {
  strategy: StrategyName
  legs: Leg[]
  handovers: Handover[]
  /** When the customer has the whole basket — for `separate`, the last arrival. */
  completeAt: number
  /** Total paid courier time across every courier involved. */
  courierSeconds: number
  /** Of which, time spent stationary. */
  idleSeconds: number
  /** Per vendor: seconds between goods being collected and reaching the
   *  customer. Drives the freshness penalty. */
  carriageSeconds: Record<string, number>
}

export type PlanRejection = {
  strategy: StrategyName
  reason: string
}

export type PlanAttempt = Plan | PlanRejection

export function isPlan(attempt: PlanAttempt): attempt is Plan {
  return 'legs' in attempt
}
